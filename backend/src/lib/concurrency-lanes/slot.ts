// backend/src/lib/concurrency-lanes/slot.ts — a call takes a slot of its lane
// (or does not) according to the hold it runs under. Used by the runtime
// funnels (provider egress, the LLM router), the plugin toolkit and the
// coordinators (pipelines, directors).
//
//   leaf / not-limited hold → run, no acquire (the slot is already held, or
//                             the work is deliberately not limited);
//   run / coordinator hold  → every call acquires its OWN slot at the FRONT of
//                             the lane for the hold's line, waiting up to the
//                             queue timeout, then runs under a nested leaf
//                             hold; a coordinator holds no slot of its own, so
//                             nothing is shared between its calls;
//   no hold, or a hold scope
//   that already ended      → admitOutsideAnyHold (today: ungated and counted).
//
// Each call enters the gate under its own entry id (`<jobId>:call:<uuid>`),
// never the hold's job id: the gate keeps one lease per entry id per line.
// ensureConcurrencySlot (the funnel form, which holds a slot for the rest of
// its scope) is refused under a run or coordinator hold: there it would turn
// one call's slot into a slot held by the coordinator.
//
// A wait listens for wake messages for its entry (one subscriber per process,
// started on the first wait) and re-checks every 5 s. With enforcement off the
// gate grants at once, so nothing waits and no subscriber or timer is created.
//
// Fails open: when the gate cannot be reached (no answer within its call
// timeout, or any other Redis error) the call runs ungated and counted (by job
// type, and the failure by class), and its entry is withdrawn best-effort. A
// lane problem never fails the job.
import { randomUUID } from "node:crypto"
import { LANE_LEASE_TTL_MS, LaneGateTimeoutError, type ConcurrencyGate, type WakeTarget } from "./gate.js"
import { EnsureUnderCoordinatorError, LaneWaitAbortedError, LaneWaitTimeoutError } from "./errors.js"
import {
  addHeldWaitMs, countFailOpen, countUngated, currentHoldScope, keepLeaseAlive, loadConcurrencyGate, logLaneRateLimited,
  releaseQuietly, runHolding, warnLaneRateLimited, type ConcurrencyHold, type HoldScope,
} from "./hold.js"
import type { LeafLane } from "./leaf-lanes.js"
import { laneSettings, laneSizesFor } from "./sizes.js"
import type { LaneEntryMeta, WaitInfo } from "./types.js"

export interface SlotRequest {
  lane: LeafLane
  /** The primary provider the call counts against (its platform ceiling); null for none. */
  provider: string | null
  jobType: string
  model?: string | null
  /** Ends a wait still in progress (LaneWaitAbortedError). Never ends a call that already runs. */
  signal?: AbortSignal
  /** Told where the call stands on every check while it waits. */
  onWaiting?: (wait: WaitInfo) => void
}

/** A waiting call re-checks its place this often, besides on wake messages. */
export const SLOT_RECHECK_MS = 5_000

const MINUTE_MS = 60_000

// ------------------------------------------------------------------- wakes

/** Entry id → wakes its waiting call. Only this process's waiting calls. */
const waiters = new Map<string, () => void>()
let stopSubscriber: (() => void) | null = null
let subscriberStarting: Promise<void> | null = null

/** Start this process's subscriber for in-process waits, once. A failure leaves the 5-s re-check. */
function ensureWakeSubscriber(): void {
  if (stopSubscriber || subscriberStarting) return
  subscriberStarting = import("./wake-subscriber.js")
    .then(({ startLaneWakeSubscriber }) => {
      stopSubscriber = startLaneWakeSubscriber(["inline"], async (targets: WakeTarget[]) => {
        for (const t of targets) waiters.get(t.jobId)?.()
      })
    })
    .catch((err: unknown) => { warnLaneRateLimited("could not start the in-process wake subscriber", err) })
    .finally(() => { subscriberStarting = null })
}

/** Resolve on a wake for `entryId`, after `ms`, or on abort — whichever comes first. Leaves no timer. */
function waitForTurn(entryId: string, ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve) => {
    // Already aborted: its abort event has fired, so a listener would never run.
    if (signal?.aborted) {
      resolve()
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = () => {
      clearTimeout(timer)
      waiters.delete(entryId)
      signal?.removeEventListener("abort", done)
      resolve()
    }
    timer = setTimeout(done, Math.max(0, ms))
    timer.unref?.()
    waiters.set(entryId, done)
    signal?.addEventListener("abort", done, { once: true })
  })
}

/** For tests: forget every waiter and stop the subscriber. */
export function resetConcurrencySlotsForTests(): void {
  waiters.clear()
  stopSubscriber?.()
  stopSubscriber = null
  subscriberStarting = null
}

// ------------------------------------------------------------------ admit

type Admission = { leaseId: string; meta: LaneEntryMeta } | { leaseId: null }

/**
 * Take a front-of-lane slot for one call under a run or coordinator hold,
 * waiting for it up to the queue timeout. The wait ends early (withdrawn,
 * LaneWaitAbortedError) only on the caller's signal; a wait still in progress
 * when the hold's scope ends goes on.
 * The time waited is added to the job's in-handler wait whatever the outcome.
 */
async function admitUnderHold(scope: HoldScope, req: SlotRequest): Promise<Admission> {
  const { hold } = scope
  const entryId = `${hold.jobId ?? "scope"}:call:${randomUUID()}`
  const meta: LaneEntryMeta = {
    jobId: entryId,
    userId: hold.userId,
    payer: hold.payer,
    lane: req.lane,
    provider: req.provider,
    source: null,
    sourceDetail: null,
    jobType: req.jobType,
    model: req.model ?? null,
    queue: "inline",
    bullJobId: null,
  }
  const { signal } = req
  const started = Date.now()
  let gate: ConcurrencyGate | null = null
  let waited = false
  const withdraw = async () => {
    if (!gate) return
    await gate.withdraw(entryId).catch((err: unknown) => { warnLaneRateLimited("could not withdraw a waiting call", err) })
  }
  const abortIfAsked = async () => {
    if (!signal?.aborted) return
    await withdraw()
    throw new LaneWaitAbortedError()
  }
  try {
    await abortIfAsked()
    gate = await loadConcurrencyGate()
    const { queueTimeoutMs } = await laneSettings()
    const deadline = started + queueTimeoutMs
    for (;;) {
      const sizes = await laneSizesFor({ userId: hold.userId, payer: hold.payer, tier: hold.tier })
      await abortIfAsked()
      const r = await gate.acquire({ meta, size: sizes[req.lane], mode: "front", leaseTtlMs: LANE_LEASE_TTL_MS })
      if (r.granted) return { leaseId: r.leaseId, meta }
      waited = true
      try {
        req.onWaiting?.(r.wait)
      } catch (err) {
        warnLaneRateLimited("a waiting call's onWaiting threw", err)
      }
      const now = Date.now()
      if (now >= deadline) {
        await withdraw()
        throw new LaneWaitTimeoutError({ reason: "timeout", waitedMs: now - started, timeoutMinutes: Math.round(queueTimeoutMs / MINUTE_MS) })
      }
      ensureWakeSubscriber()
      await waitForTurn(entryId, Math.min(SLOT_RECHECK_MS, deadline - now), signal)
      await abortIfAsked()
    }
  } catch (err) {
    if (err instanceof LaneWaitTimeoutError || err instanceof LaneWaitAbortedError) throw err
    // The gate did not answer (or failed): run ungated rather than fail the job.
    if (err instanceof LaneGateTimeoutError) {
      countFailOpen("gate-timeout")
      warnLaneRateLimited("the concurrency gate did not answer in time, running the call ungated", err)
    } else {
      countFailOpen("gate-error")
      logLaneRateLimited("error", "the concurrency gate failed, running the call ungated", err)
    }
    countUngated(req.jobType)
    void withdraw()
    return { leaseId: null }
  } finally {
    if (waited) addHeldWaitMs(Date.now() - started)
  }
}

/**
 * Work that runs under no hold at all. Today it always runs ungated and
 * counted; the request scope replaces this one function, so a route's own
 * calls take a live slot for the rest of the request.
 */
async function admitOutsideAnyHold(req: SlotRequest): Promise<void> {
  countUngated(req.jobType)
}

/** The hold a call runs under once admitted (its caller's is a run or coordinator hold). */
const leafOf = (hold: ConcurrencyHold, lane: LeafLane, leaseId: string | null): ConcurrencyHold =>
  ({ ...hold, role: "leaf", lane, leaseId })

// ---------------------------------------------------------------- public

/**
 * Run `fn` holding a slot of `req.lane` for exactly its duration (see the
 * module comment for when it acquires). A slot it takes is kept alive while
 * `fn` runs and released when `fn` settles — `completed` or `failed` — even
 * when `fn` throws; a failed release never hides `fn`'s result.
 */
export async function withConcurrencySlot<T>(req: SlotRequest, fn: () => Promise<T>): Promise<T> {
  const scope = currentHoldScope()
  if (!scope || scope.closed) {
    await admitOutsideAnyHold(req)
    return fn()
  }
  const { hold } = scope
  if (hold.role === "leaf" || hold.role === "not-limited") return fn()
  const admission = await admitUnderHold(scope, req)
  if (admission.leaseId === null) return runHolding(leafOf(hold, req.lane, null), fn)
  const keep = keepLeaseAlive(admission.leaseId, admission.meta)
  let outcome: "completed" | "failed" = "failed"
  try {
    const result = await runHolding(leafOf(hold, req.lane, admission.leaseId), fn)
    outcome = "completed"
    return result
  } finally {
    keep.stop()
    await releaseQuietly(admission.leaseId, outcome)
  }
}

/**
 * The funnel form: make sure the current scope holds a slot of `req.lane` for
 * the rest of the scope.
 *   - Under a leaf or not-limited hold: nothing to do.
 *   - Under a run or coordinator hold: refused (EnsureUnderCoordinatorError) —
 *     a coordinator holds no slot; each of its calls takes its own through
 *     withConcurrencySlot.
 *   - With no hold, or in a hold scope that already ended (detached work): the
 *     no-hold path, which never leaves a lease behind.
 */
export async function ensureConcurrencySlot(req: SlotRequest): Promise<void> {
  const scope = currentHoldScope()
  if (!scope || scope.closed) {
    await admitOutsideAnyHold(req)
    return
  }
  const { role } = scope.hold
  if (role === "leaf" || role === "not-limited") return
  throw new EnsureUnderCoordinatorError(role)
}
