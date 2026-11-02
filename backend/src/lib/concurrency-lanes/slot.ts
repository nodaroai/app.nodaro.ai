// backend/src/lib/concurrency-lanes/slot.ts — a call takes a slot of its lane
// (or does not) according to the hold it runs under. Used by the runtime
// funnels (provider egress, the LLM router, the Replicate and fal SDK clients),
// the plugin toolkit and the coordinators (pipelines, directors).
//
//   leaf / not-limited hold → run, no acquire (the slot is already held, or
//                             the work is deliberately not limited);
//   run / coordinator hold  → every call acquires its OWN slot at the FRONT of
//                             the lane for the hold's line, waiting up to the
//                             queue timeout, then runs under a nested leaf
//                             hold; a coordinator holds no slot of its own, so
//                             nothing is shared between its calls;
//   request hold            → a request (request-scope.ts) that holds no slot
//                             yet: the first call takes one for the REST OF
//                             THE REQUEST (the request's wrapper releases it),
//                             and the scope then holds it as a leaf hold, so
//                             every later call reuses it. A live request takes
//                             it fresh and waits up to the live-wait limit,
//                             capped by its transport's ceiling (LaneBusyError
//                             past it); a request a job made in-process under a
//                             run or coordinator hold takes it at the front of
//                             the job's line under the queue timeout;
//   no hold, or a scope
//   that already ended      → ungated and counted (crons, boot, detached work).
//
// Each call enters the gate under its own entry id (`<jobId>:call:<uuid>`, a
// live request's `live:<uuid>`), never the hold's job id: the gate keeps one
// lease per entry id per line. ensureConcurrencySlot (the funnel form, which
// holds a slot for the rest of its scope) is refused under a run or
// coordinator hold: there it would turn one call's slot into a slot held by
// the coordinator. A funnel therefore wraps its call in withConcurrencySlot,
// which does the right thing under every hold.
//
// A wait listens for wake messages for its entry (one subscriber per process,
// started on the first wait) and re-checks every 5 s. With enforcement off the
// gate grants at once, so nothing waits and no subscriber or timer is created.
//
// While limits cannot be turned on in this release (LANES_ENFORCEMENT_AVAILABLE
// false, a code constant read synchronously), nothing here waits for the gate
// at all: a take is fired, never awaited (the slot is counted, not waited for),
// and the call runs at once under the lease id the take asked for. Its release
// chains on that take: it frees exactly the lease the take landed, once —
// whenever the take lands — and nothing when the take failed. Nothing
// lane-related may delay, refuse or fail a call while limits are locked; a
// Redis that hangs then costs the calls nothing.
//
// Fails open: when the gate cannot be reached (no answer within its call
// timeout, or any other Redis error) the call runs ungated and counted (by job
// type, and the failure by class), and its entry is withdrawn best-effort. A
// lane problem never fails the job.
import { randomUUID } from "node:crypto"
import { LANE_LEASE_TTL_MS, LaneGateTimeoutError, type ConcurrencyGate, type ReleaseOutcome, type WakeTarget } from "./gate.js"
import { EnsureUnderCoordinatorError, LaneBusyError, LaneWaitAbortedError, LaneWaitTimeoutError } from "./errors.js"
import { creditCoordinatorWait } from "./coordinator-wait.js"
import { countLiveWaitExpiry } from "./history-hooks.js"
import {
  countFailOpen, countUngated, currentHoldScope, keepLeaseAlive, loadConcurrencyGate, logLaneRateLimited,
  onHoldScopeClose, outsideHoldScopes, releaseQuietly, runHolding, warnLaneRateLimited, type ConcurrencyHold, type HoldScope, type RequestSlotState,
} from "./hold.js"
import type { LeafLane } from "./leaf-lanes.js"
import { LANES_ENFORCEMENT_AVAILABLE } from "./enforcement-available.js"
import { LIVE_WAIT_CEILINGS_S } from "./live-ceilings.js"
import { laneSettings, laneSizesFor, type LaneSettings } from "./sizes.js"
import type { LaneEntryMeta, LaneQueueName, PayerKey, WaitInfo } from "./types.js"

export interface SlotRequest {
  lane: LeafLane
  /** The primary provider the call counts against (its platform ceiling); null for none. */
  provider: string | null
  jobType: string
  model?: string | null
  /**
   * The caller's signal: an aborted one refuses the call before it asks for a
   * slot, and ends a wait in progress (LaneWaitAbortedError). Never ends a
   * call that already runs.
   */
  signal?: AbortSignal
  /**
   * Ends only a wait already in progress (LaneWaitAbortedError) — never a call
   * the gate grants at once, so with enforcement off it changes nothing. For a
   * caller whose own abort must surface its own way (an LLM stream's).
   */
  waitSignal?: AbortSignal
  /**
   * The call's own nested funnel calls are part of it (a structured LLM call's
   * attempts): when it runs under no hold, it is counted once, not once more
   * for each of them.
   */
  coversNested?: boolean
  /** Told where the call stands on every check while it waits. */
  onWaiting?: (wait: WaitInfo) => void
  /**
   * Never wait: a slot not granted at once ends the take with LaneBusyError
   * (the entry withdrawn). With enforcement off every slot is granted at once,
   * so this changes nothing there.
   */
  noWait?: boolean
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
  // Outside any hold scope: the subscriber's connection lives for the
  // process, and must not carry the scope of the call that started it.
  subscriberStarting = outsideHoldScopes(() => import("./wake-subscriber.js"))
    .then(({ startLaneWakeSubscriber }) => {
      stopSubscriber = outsideHoldScopes(() => startLaneWakeSubscriber(["inline", "live"], async (targets: WakeTarget[]) => {
        for (const t of targets) waiters.get(t.jobId)?.()
      }))
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

/** One entry's way into its line: who, how, and how long it may wait. */
interface EntryRequest {
  line: { userId: string; payer: PayerKey; tier: string | null }
  entryId: string
  /** The id the lease is created under; the gate makes one when absent. */
  leaseId?: string
  queue: LaneQueueName
  mode: "fresh" | "front"
  req: SlotRequest
  /** Refuses the entry before it asks, and ends a wait in progress. */
  signal: AbortSignal | undefined
  /** Ends only a wait already in progress: never checked before an acquire that may be granted at once. */
  waitSignal: AbortSignal | undefined
  /** How long the entry may wait, from the lane settings. */
  limitMs(settings: LaneSettings): number
  /** The error a wait that ran its limit ends in (thrown after the entry is withdrawn). */
  expired(waitedMs: number, settings: LaneSettings): Error
  /** Add the time waited to the current job's in-handler wait (a coordinator's call). */
  creditsWait: boolean
  /** When true, the wait stops at its next check: the entry is withdrawn and the call runs ungated. */
  abandoned?(): boolean
}

/** The errors a wait ends in by design; anything else is the gate failing (fail open). */
const isFinalWaitError = (err: unknown): boolean =>
  err instanceof LaneWaitTimeoutError || err instanceof LaneWaitAbortedError || err instanceof LaneBusyError

/**
 * Take a slot for one entry, waiting for it up to its limit. The wait ends
 * early (withdrawn, LaneWaitAbortedError) only on the caller's signal or, once
 * the entry is waiting, its wait signal.
 * With `creditsWait`, the time waited is added to the job's in-handler wait
 * (and to its row's `lane_wait_ms`, coordinator-wait.ts) as it goes — on
 * every re-check, so a long wait already counts while it lasts — whatever the
 * outcome.
 */
async function admitEntry(e: EntryRequest): Promise<Admission> {
  const { req, signal, waitSignal, entryId } = e
  /** What ends a wait in progress: either signal. */
  const waitEnders = [signal, waitSignal].filter((x): x is AbortSignal => x !== undefined)
  const endsWait = waitEnders.length > 1 ? AbortSignal.any(waitEnders) : waitEnders[0]
  const meta: LaneEntryMeta = {
    jobId: entryId,
    userId: e.line.userId,
    payer: e.line.payer,
    lane: req.lane,
    provider: req.provider,
    source: null,
    sourceDetail: null,
    jobType: req.jobType,
    model: req.model ?? null,
    queue: e.queue,
    bullJobId: null,
  }
  const started = Date.now()
  let gate: ConcurrencyGate | null = null
  let waited = false
  /** The wait is credited up to here. */
  let creditedTo = started
  const creditWait = () => {
    if (!e.creditsWait) return
    const now = Date.now()
    creditCoordinatorWait(creditedTo, now)
    creditedTo = now
  }
  const withdraw = async () => {
    if (!gate) return
    await gate.withdraw(entryId).catch((err: unknown) => { warnLaneRateLimited("could not withdraw a waiting call", err) })
  }
  const abortIfAsked = async () => {
    if (!signal?.aborted) return
    await withdraw()
    throw new LaneWaitAbortedError()
  }
  /** Inside a wait only: the caller's signal or the wait signal ends it. */
  const endWaitIfAsked = async () => {
    if (!endsWait?.aborted) return
    await withdraw()
    throw new LaneWaitAbortedError()
  }
  try {
    await abortIfAsked()
    gate = await loadConcurrencyGate()
    const settings = await laneSettings()
    const deadline = started + e.limitMs(settings)
    for (;;) {
      const sizes = await laneSizesFor(e.line)
      await abortIfAsked()
      const r = await gate.acquire({ meta, size: sizes[req.lane], mode: e.mode, leaseTtlMs: LANE_LEASE_TTL_MS, ...(e.leaseId ? { leaseId: e.leaseId } : {}) })
      if (r.granted) return { leaseId: r.leaseId, meta }
      if (req.noWait) {
        await withdraw()
        throw new LaneBusyError()
      }
      waited = true
      creditWait()
      try {
        req.onWaiting?.(r.wait)
      } catch (err) {
        warnLaneRateLimited("a waiting call's onWaiting threw", err)
      }
      const now = Date.now()
      if (now >= deadline) {
        await withdraw()
        throw e.expired(now - started, settings)
      }
      if (e.abandoned?.()) {
        await withdraw()
        countUngated(req.jobType)
        return { leaseId: null }
      }
      await endWaitIfAsked()
      ensureWakeSubscriber()
      await waitForTurn(entryId, Math.min(SLOT_RECHECK_MS, deadline - now), endsWait)
      creditWait()
      await endWaitIfAsked()
    }
  } catch (err) {
    if (isFinalWaitError(err)) throw err
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
    if (waited) creditWait()
  }
}

/** A queue timeout: the job's wait ran out. */
const queueTimeout = (waitedMs: number, settings: LaneSettings): Error =>
  new LaneWaitTimeoutError({ reason: "timeout", waitedMs, timeoutMinutes: Math.round(settings.queueTimeoutMs / MINUTE_MS) })

/**
 * The entry of one call under a run or coordinator hold: a front-of-lane slot
 * of the hold's line, waiting for it up to the queue timeout. A wait still in
 * progress when the hold's scope ends goes on.
 */
function callEntry(hold: ConcurrencyHold, req: SlotRequest): EntryRequest {
  return {
    line: hold,
    entryId: `${hold.jobId ?? "scope"}:call:${randomUUID()}`,
    queue: "inline",
    mode: "front",
    req,
    signal: req.signal,
    waitSignal: req.waitSignal,
    limitMs: (settings) => settings.queueTimeoutMs,
    expired: queueTimeout,
    creditsWait: true,
  }
}

/**
 * True while concurrency limits cannot be turned on in this release: every
 * take is then measured without being waited for (see the module comment).
 * A code constant, read synchronously — never the stored switch, whose read
 * is itself a Redis call.
 */
export function lanesMeasureOnly(): boolean {
  return !LANES_ENFORCEMENT_AVAILABLE
}

/** A slot a call holds: the lease it runs under (null: none, ungated), and how it is freed. */
interface TakenSlot {
  readonly leaseId: string | null
  /** Free the slot and stop renewing it. Never throws; calling it again changes nothing. */
  release(outcome: ReleaseOutcome): Promise<void>
}

/** A slot the gate granted (awaited): kept alive until it is released. */
function grantedSlot(admission: Admission): TakenSlot {
  if (admission.leaseId === null) return { leaseId: null, release: async () => {} }
  const { leaseId } = admission
  const keep = keepLeaseAlive(leaseId, admission.meta)
  let released: Promise<void> | null = null
  return {
    leaseId,
    release: (outcome) => (released ??= (async () => {
      keep.stop()
      await releaseQuietly(leaseId, outcome)
    })()),
  }
}

/** A take fired while limits are locked (fireWithoutWaiting). */
export interface FiredTake<A> {
  /** What the take landed — or, should it fail, what the failure stands for. Never rejects. */
  readonly landed: Promise<A>
  /** Free what the take landed, once, whenever it lands. Never waits for the gate; calling it again changes nothing. */
  release(outcome: ReleaseOutcome): Promise<void>
}

/**
 * The one shape of a take measured without waiting (limits locked), shared
 * by a call's slot (takeWithoutWaiting) and a worker's pickup admission
 * (worker-admit.ts): fire `take`, never await it; a take that fails becomes
 * `failed(err)` (counted as ungated by the caller); the release is asked at
 * most once, chains on the take and frees exactly what it landed (`free`),
 * whenever it lands. `take` is handed `releasing()`, true from the moment a
 * release is asked: a take that lands after it must start no renewals for
 * what it landed, which is about to be freed.
 */
export function fireWithoutWaiting<A>(
  take: (releasing: () => boolean) => Promise<A>,
  failed: (err: unknown) => A,
  free: (landed: A, outcome: ReleaseOutcome) => Promise<void>,
): FiredTake<A> {
  let releasing = false
  const landed = take(() => releasing).catch(failed)
  let released: Promise<void> | null = null
  return {
    landed,
    release: (outcome) => {
      if (!released) {
        releasing = true
        released = landed.then((a) => free(a, outcome))
      }
      // Never waits for the gate: the release lands whenever the take does.
      return Promise.resolve()
    },
  }
}

/**
 * Fire the take of `e` and answer at once (limits locked: measured, never
 * waited for — fireWithoutWaiting). The slot names the lease id the take
 * asked for, so the call can run under it before the gate answers. Its
 * release frees the lease the take landed — once, whenever the take lands —
 * and nothing when the take failed (the call was then counted as ungated).
 * The lease is renewed from when the take lands until it is released, never
 * when the release came first. The take never waits in line: a slot the gate
 * would not grant at once (it always does while limits are off) is withdrawn
 * and counted as ungated.
 */
function takeWithoutWaiting(e: EntryRequest): TakenSlot {
  const leaseId = randomUUID()
  let keep: { stop(): void } | null = null
  const fired = fireWithoutWaiting<Admission>(
    // No signal: a caller that goes away after this point is still counted.
    (releasing) => admitEntry({ ...e, leaseId, signal: undefined, waitSignal: undefined, req: { ...e.req, noWait: true } })
      .then((a) => {
        if (a.leaseId !== null && !releasing()) keep = keepLeaseAlive(a.leaseId, a.meta)
        return a
      }),
    (err) => {
      // A final wait error (the gate would not grant at once): the call ran anyway, uncounted by the gate.
      if (!(err instanceof LaneBusyError)) warnLaneRateLimited("a measured take failed", err)
      countUngated(e.req.jobType)
      return { leaseId: null }
    },
    async (a, outcome) => {
      keep?.stop()
      // The lease the take actually landed: never the id it asked for, which may not exist.
      if (a.leaseId !== null) await releaseQuietly(a.leaseId, outcome)
    },
  )
  return { leaseId, release: fired.release }
}

/** Refuse a call whose caller already gave up, before it asks for a slot (the one refusal before a take). */
function refuseIfAborted(req: SlotRequest): void {
  if (req.signal?.aborted) throw new LaneWaitAbortedError()
}

/** Take the slot of one call under a run or coordinator hold: waited for, or (limits locked) measured without waiting. */
async function takeCallSlot(hold: ConcurrencyHold, req: SlotRequest): Promise<TakenSlot> {
  if (lanesMeasureOnly()) {
    refuseIfAborted(req)
    return takeWithoutWaiting(callEntry(hold, req))
  }
  return grantedSlot(await admitEntry(callEntry(hold, req)))
}

/** How long a live request on `transport` may wait: the live-wait limit, capped by the transport's ceiling. */
export function liveWaitLimitMs(settings: LaneSettings, transport: "json" | "sse" | "mcp"): number {
  return Math.min(settings.liveWaitLimitMs, LIVE_WAIT_CEILINGS_S[transport] * 1_000)
}

/**
 * Take the slot of a request scope (its hold is `request`). Once per request:
 * a call that asks while a take is in progress waits for that take, and every
 * call after it runs under the leaf hold the scope then has.
 */
export async function takeRequestSlot(scope: HoldScope, req: SlotRequest): Promise<void> {
  const state = scope.request
  if (!state || state.ended) {
    countUngated(req.jobType)
    return
  }
  if (scope.hold.role !== "request") return
  if (lanesMeasureOnly()) {
    takeRequestSlotWithoutWaiting(scope, state, req)
    return
  }
  if (!state.pending) {
    const p = admitRequest(scope, state, req).finally(() => {
      if (state.pending === p) state.pending = null
    })
    state.pending = p
  }
  await state.pending
}

/** The entry of a request scope's slot: a job's in-process request's front slot, or a live request's. */
function requestEntry(hold: ConcurrencyHold, state: RequestSlotState, req: SlotRequest): EntryRequest {
  const { transport, coordinator } = state
  // The client leaving ends only a wait in progress: a call the gate grants
  // at once is never refused for it (with enforcement off, none ever is).
  const signal = req.signal
  const waitSignal = req.waitSignal && state.signal ? AbortSignal.any([req.waitSignal, state.signal]) : (req.waitSignal ?? state.signal)
  if (coordinator || !transport) {
    // A job's in-process request: a front slot of the job's line, under the queue timeout.
    return {
      line: hold,
      entryId: `${hold.jobId ?? "scope"}:call:${randomUUID()}`,
      queue: "inline",
      mode: "front",
      req,
      signal,
      waitSignal,
      limitMs: (settings) => settings.queueTimeoutMs,
      expired: queueTimeout,
      creditsWait: true,
      abandoned: () => state.ended,
    }
  }
  return {
    line: hold,
    entryId: `live:${randomUUID()}`,
    queue: "live",
    mode: "fresh",
    req,
    signal,
    waitSignal,
    limitMs: (settings) => liveWaitLimitMs(settings, transport),
    expired: (waitedMs) => {
      countLiveWaitExpiry({ userId: hold.userId, payer: hold.payer, waitedMs })
      return new LaneBusyError()
    },
    creditsWait: false,
    abandoned: () => state.ended,
  }
}

/**
 * Limits locked: the request takes its slot without waiting (takeWithoutWaiting)
 * and holds it at once, as a leaf, for the rest of the request — its release
 * (releaseRequestSlot) chains on the take.
 */
function takeRequestSlotWithoutWaiting(scope: HoldScope, state: RequestSlotState, req: SlotRequest): void {
  const hold = scope.hold
  refuseIfAborted(req)
  // A request nobody is signed in to has no line: counted, never gated.
  if (!hold.userId) {
    countUngated(req.jobType)
    return
  }
  const slot = takeWithoutWaiting(requestEntry(hold, state, req))
  state.lease = { leaseId: slot.leaseId!, lane: req.lane, release: slot.release }
  scope.hold = { ...hold, role: "leaf", lane: req.lane, leaseId: slot.leaseId }
}

async function admitRequest(scope: HoldScope, state: RequestSlotState, req: SlotRequest): Promise<void> {
  const hold = scope.hold
  // A request nobody is signed in to has no line: counted, never gated.
  if (!hold.userId) {
    countUngated(req.jobType)
    return
  }
  const admission = await admitEntry(requestEntry(hold, state, req))
  if (admission.leaseId === null) {
    // Ran ungated (counted): the request's later calls run under it the same way.
    if (!state.ended) scope.hold = { ...hold, role: "leaf", lane: req.lane, leaseId: null }
    return
  }
  if (state.ended) {
    // The request settled while this take waited: nothing is left to hold the slot for.
    await releaseQuietly(admission.leaseId, "completed")
    return
  }
  const slot = grantedSlot(admission)
  state.lease = { leaseId: admission.leaseId, lane: req.lane, release: slot.release }
  scope.hold = { ...hold, role: "leaf", lane: req.lane, leaseId: admission.leaseId }
}

/**
 * Free the slot a request scope holds and make the scope a `request` hold
 * again (a later call takes a new one). With `end`, the scope also ends:
 * nothing new is taken under it, and a take still in progress is released
 * when it lands. Never throws; calling it again changes nothing.
 */
export async function releaseRequestSlot(scope: HoldScope, outcome: ReleaseOutcome, opts: { end?: boolean } = {}): Promise<void> {
  const state = scope.request
  if (!state) return
  if (opts.end) {
    state.ended = true
    scope.closed = true
  }
  const lease = state.lease
  if (!lease) return
  state.lease = null
  if (!state.ended) scope.hold = { ...scope.hold, role: "request", lane: null, leaseId: null }
  await lease.release(outcome)
}

/**
 * The pass-through hold a call that ran ungated under no hold gives its
 * nested calls (`coversNested`): they are part of it, already counted.
 */
const ungatedLeaf = (lane: LeafLane): ConcurrencyHold =>
  ({ role: "leaf", lane, userId: "", payer: "user:", tier: null, jobId: null, leaseId: null, passThrough: true })

/** The hold a call runs under once admitted (its caller's is a run or coordinator hold). */
const leafOf = (hold: ConcurrencyHold, lane: LeafLane, leaseId: string | null): ConcurrencyHold =>
  ({ ...hold, role: "leaf", lane, leaseId })

// ---------------------------------------------------------------- public

/**
 * Run `fn` holding a slot of `req.lane` for exactly its duration (see the
 * module comment for when it acquires) — inside a request that holds none
 * yet, for the rest of the request. A slot it takes is kept alive while `fn`
 * runs and released when `fn` settles — `completed` or `failed` — even when
 * `fn` throws; a failed release never hides `fn`'s result. This is the form
 * every funnel uses: it is right under every hold.
 */
export async function withConcurrencySlot<T>(req: SlotRequest, fn: () => Promise<T>): Promise<T> {
  const scope = currentHoldScope()
  if (!scope || scope.closed) {
    countUngated(req.jobType)
    return req.coversNested ? runHolding(ungatedLeaf(req.lane), fn) : fn()
  }
  const { hold } = scope
  if (hold.role === "leaf" || hold.role === "not-limited") return fn()
  if (hold.role === "request") {
    await takeRequestSlot(scope, req)
    return fn()
  }
  const slot = await takeCallSlot(hold, req)
  let outcome: "completed" | "failed" = "failed"
  try {
    const result = await runHolding(leafOf(hold, req.lane, slot.leaseId), fn)
    outcome = "completed"
    return result
  } finally {
    await slot.release(outcome)
  }
}

/**
 * Make sure the current scope holds a slot of `req.lane` for the rest of the
 * scope.
 *   - Under a leaf or not-limited hold: nothing to do.
 *   - In a request that holds no slot yet: take one, for the rest of the request.
 *   - Under a run or coordinator hold: refused (EnsureUnderCoordinatorError) —
 *     a coordinator holds no slot; each of its calls takes its own through
 *     withConcurrencySlot.
 *   - With no hold, or in a scope that already ended (detached work): counted
 *     as ungated, never a lease left behind.
 */
export async function ensureConcurrencySlot(req: SlotRequest): Promise<void> {
  const scope = currentHoldScope()
  if (!scope || scope.closed) {
    countUngated(req.jobType)
    return
  }
  const { role } = scope.hold
  if (role === "leaf" || role === "not-limited") return
  if (role === "request") {
    await takeRequestSlot(scope, req)
    return
  }
  throw new EnsureUnderCoordinatorError(role)
}

// ------------------------------------------------------- slots taken ahead
//
// A call whose slot must be granted BEFORE something it does first — a
// metered side hold (lib/llm-side-hold.ts) is reserved and stamped by the
// plugin before it calls the LLM, and the side-hold sweep counts its grace
// from those stamps, so the wait must come before the hold exists — takes its
// slot ahead (takeSlotAhead). The slot is kept on the JOB (the in-handler
// wait object every nested scope of one job shares, hold.ts newHoldScope),
// not on the one scope object it was taken in, so a call of the same job in a
// nested scope still finds it. Only a call that says it is the one the slot
// was taken for (withSlotTakenAheadOr) runs in it — the oldest idle one —
// instead of taking a second. The slot is freed when its owner releases it
// AND no call is running in it (a release while one runs waits for that call
// to end), or when the scope it was taken in ends, whichever comes first.

/** A slot taken ahead of the call it is for. */
export interface SlotTakenAhead {
  /**
   * Free the slot — at once, or when the call running in it ends. Never
   * throws; calling it again changes nothing.
   */
  release(outcome: ReleaseOutcome): Promise<void>
}

interface AheadSlot {
  readonly lane: LeafLane
  /** The hold a call runs under in this slot: a leaf of the caller's line (its lease null when the gate failed open). */
  readonly hold: ConcurrencyHold
  /** A call is running in it. */
  busy: boolean
  /** Its owner asked to free it (no call may claim it any more); the outcome to release with. */
  closing: ReleaseOutcome | null
  /** Frees it at the gate, once. */
  free(outcome: ReleaseOutcome): Promise<void>
}

/** The slots taken ahead for each job (keyed by its shared in-handler wait), oldest first. */
const aheadByJob = new WeakMap<HoldScope["wait"], AheadSlot[]>()

const NOTHING_AHEAD: SlotTakenAhead = { release: async () => {} }

/**
 * Take a slot of `req.lane` now, for a call of the same job that comes later
 * (see above). Under a run or coordinator hold this waits for it as a call
 * would (front of the line, the queue timeout; a wait that ends throws as the
 * call would have). Anywhere else nothing is taken here — under a leaf or
 * not-limited hold nothing would be, in a request the request's slot is taken
 * now and held for the rest of it, and with no hold the call is counted when
 * it runs — and the handle frees nothing.
 */
export async function takeSlotAhead(req: SlotRequest): Promise<SlotTakenAhead> {
  const scope = currentHoldScope()
  if (!scope || scope.closed) return NOTHING_AHEAD
  const { hold } = scope
  if (hold.role === "leaf" || hold.role === "not-limited") return NOTHING_AHEAD
  if (hold.role === "request") {
    await takeRequestSlot(scope, req)
    return NOTHING_AHEAD
  }
  const taken = await takeCallSlot(hold, req)
  const job = scope.wait
  let cancelOnClose = () => {}
  let freed: Promise<void> | null = null
  const slot: AheadSlot = {
    lane: req.lane,
    hold: leafOf(hold, req.lane, taken.leaseId),
    busy: false,
    closing: null,
    free: (outcome) => (freed ??= (async () => {
      cancelOnClose()
      const rest = (aheadByJob.get(job) ?? []).filter((s) => s !== slot)
      if (rest.length > 0) aheadByJob.set(job, rest)
      else aheadByJob.delete(job)
      await taken.release(outcome)
    })()),
  }
  aheadByJob.set(job, [...(aheadByJob.get(job) ?? []), slot])
  const release = async (outcome: ReleaseOutcome): Promise<void> => {
    if (slot.closing) return
    slot.closing = outcome
    // A call running in it frees it when it ends (withSlotTakenAheadOr).
    if (!slot.busy) await slot.free(outcome)
  }
  // A slot its owner never released goes when the scope it was taken in ends.
  cancelOnClose = onHoldScopeClose(scope, () => {
    warnLaneRateLimited("a slot taken ahead was never released by its owner; freed when its job ended", new Error(req.jobType))
    void release("completed")
  })
  return { release }
}

/**
 * Run `fn` — the call a slot was taken ahead for — in the oldest idle slot of
 * `req.lane` taken ahead for this job, without a second acquire; with none
 * (or under a hold that takes no slot anyway), exactly withConcurrencySlot.
 * The slot stays its owner's to free; a release asked while `fn` runs takes
 * effect when it ends.
 */
export async function withSlotTakenAheadOr<T>(req: SlotRequest, fn: () => Promise<T>): Promise<T> {
  const scope = currentHoldScope()
  const claims = !!scope && !scope.closed && (scope.hold.role === "run" || scope.hold.role === "coordinator")
  const slot = claims ? aheadByJob.get(scope.wait)?.find((s) => s.lane === req.lane && !s.busy && !s.closing) : undefined
  if (!slot) return withConcurrencySlot(req, fn)
  slot.busy = true
  try {
    return await runHolding(slot.hold, fn)
  } finally {
    slot.busy = false
    if (slot.closing) await slot.free(slot.closing)
  }
}
