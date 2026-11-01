// backend/src/lib/concurrency-lanes/hold.ts — the slot the current code runs
// under, carried by AsyncLocalStorage, so a funnel deep inside a job or a run
// (the provider egress, the LLM router, a toolkit member) knows whose work it
// is and whether it must take a slot itself:
//   leaf         — the code already holds a slot (of `lane`): calls under it never acquire;
//   run          — a top-level run (holds a run slot): its calls acquire at the front of their lane;
//   coordinator  — a job that dispatches or makes several calls: same as run, without a run slot;
//   not-limited  — work that is deliberately not limited (training, the Copilot): never acquires.
//
// A scope is one runHolding call. It also carries the job's in-handler wait
// (time spent waiting inside the handler — for a slot of its own calls, or for
// a child job that waits for one — which the job's own clocks leave out). Waits
// are kept as merged wall-clock intervals, so calls waiting at the same time
// count once. When the scope ends it is closed: a call that STARTS after that
// (detached work that kept the context) takes the no-hold path and never leaves
// a lease behind. A call already waiting when the scope ends keeps waiting,
// bounded by the queue timeout, and releases its own slot when it is done.
//
// The gate is loaded lazily (instance.ts opens the queue's Redis connection),
// so importing this module never connects.
import { AsyncLocalStorage } from "node:async_hooks"
import { LANE_LEASE_RENEW_MS, LANE_LEASE_TTL_MS, type ConcurrencyGate } from "./gate.js"
import { coveredMs, mergeWaitInterval, type WaitInterval } from "./queued-clock.js"
import type { ConcurrencyLane, LaneEntryMeta, PayerKey } from "./types.js"

export interface ConcurrencyHold {
  role: "leaf" | "run" | "coordinator" | "not-limited"
  /** The lane of the slot held: the leaf's lane, `run` for a run, null for a coordinator or not-limited scope. */
  lane: ConcurrencyLane | null
  userId: string
  payer: PayerKey
  /** The payer's plan tier, for sizing the line (see LaneSubject). */
  tier: string | null
  /** The job (or execution) the scope belongs to; null for a request with no job. */
  jobId: string | null
  /** The lease of the slot held; null when none is (a coordinator, or a call run ungated). */
  leaseId: string | null
  transport?: "json" | "sse" | "mcp"
  reason?: "training" | "copilot"
  /**
   * The table whose row `jobId` names, when its in-handler wait is kept on the
   * row (`lane_wait_ms`, coordinator-wait.ts): `jobs` for a job, `pipelines`
   * for a pipeline drive. Absent: the wait is kept in memory only (a workflow
   * run keeps its own, execution-wait.ts).
   */
  waitTable?: "jobs" | "pipelines"
}

/** A job's in-handler wait, shared by every nested scope of the same job. */
export interface HeldWait {
  /** Waits added as a bare amount (addHeldWaitMs). */
  ms: number
  /** Waits added as wall-clock intervals (addHeldWait), merged. */
  intervals: WaitInterval[]
}

/** One runHolding scope. Internal to the lane modules (slot.ts). */
export interface HoldScope {
  readonly hold: ConcurrencyHold
  /** The job's in-handler wait, shared by every nested scope of the same job. */
  readonly wait: HeldWait
  /** Set when runHolding's `fn` has settled: nothing new is admitted under the scope. */
  closed: boolean
}

const scopes = new AsyncLocalStorage<HoldScope>()

type InstanceModule = typeof import("./instance.js")

/**
 * The gate module, one import per process (the sizes.ts pattern: no per-call
 * import promise). A rejected import is forgotten, so the next call tries again.
 */
let instanceModule: Promise<InstanceModule> | null = null

/** The process's gate, loaded on first use. For the lane modules. */
export async function loadConcurrencyGate(): Promise<ConcurrencyGate> {
  if (!instanceModule) {
    const p = import("./instance.js")
    instanceModule = p
    p.catch(() => {
      if (instanceModule === p) instanceModule = null
    })
  }
  return (await instanceModule).concurrencyGate()
}

const WARN_EVERY_MS = 60_000
const lastWarnAt = new Map<string, number>()

/** A warning at most once a minute per kind. */
export function warnLaneRateLimited(what: string, err: unknown): void {
  logLaneRateLimited("warn", what, err)
}

/** Log `what` at `level`, at most once a minute per kind (`what`). */
export function logLaneRateLimited(level: "warn" | "error", what: string, err: unknown): void {
  const now = Date.now()
  if (now - (lastWarnAt.get(what) ?? -Infinity) < WARN_EVERY_MS) return
  lastWarnAt.set(what, now)
  console[level](`[concurrency-lanes] ${what}: ${(err as Error)?.message ?? String(err)}`)
}

/** Free a lease without ever throwing (a lease nobody releases expires after its TTL). */
export async function releaseQuietly(leaseId: string, outcome: "completed" | "failed"): Promise<void> {
  try {
    await (await loadConcurrencyGate()).release(leaseId, outcome)
  } catch (err) {
    warnLaneRateLimited("could not release a lease", err)
  }
}

/**
 * Run `fn` with `hold` as the current hold. A nested scope of the same job
 * shares the job's in-handler wait. When `fn` settles the scope is closed
 * (see the module comment); nothing is awaited, so the scope's end is never
 * delayed by a wait in progress.
 */
export async function runHolding<T>(hold: ConcurrencyHold, fn: () => Promise<T>): Promise<T> {
  const parent = scopes.getStore()
  const wait = parent && parent.hold.jobId === hold.jobId ? parent.wait : { ms: 0, intervals: [] }
  const scope: HoldScope = { hold, wait, closed: false }
  try {
    return await scopes.run(scope, fn)
  } finally {
    scope.closed = true
  }
}

/** The hold the current code runs under, if any. */
export function currentConcurrencyHold(): ConcurrencyHold | undefined {
  return scopes.getStore()?.hold
}

/** The current scope. For the lane modules only. */
export function currentHoldScope(): HoldScope | undefined {
  return scopes.getStore()
}

/** Add time the current job waited for a slot inside its handler. Outside any hold, nothing. */
export function addHeldWaitMs(ms: number): void {
  const scope = scopes.getStore()
  if (!scope || !Number.isFinite(ms) || ms <= 0) return
  scope.wait.ms += ms
}

/**
 * Add the wall-clock interval `[fromMs, toMs]` during which the current job
 * waited inside its handler; one that overlaps a wait already added counts
 * once. Outside any hold, nothing.
 */
export function addHeldWait(fromMs: number, toMs: number): void {
  const scope = scopes.getStore()
  if (!scope) return
  const merged = mergeWaitInterval(scope.wait.intervals, fromMs, toMs)
  if (merged) scope.wait.intervals = merged
}

/** The in-handler wait `wait` holds so far. */
export function heldWaitOf(wait: HeldWait): number {
  return wait.ms + coveredMs(wait.intervals)
}

/**
 * A reader of the current job's in-handler wait, bound to the scope it is
 * taken in — for a timer, which must not depend on carrying the async context
 * into its callback. Outside any hold it always reads 0.
 */
export function heldWaitReader(): () => number {
  const scope = scopes.getStore()
  if (!scope) return () => 0
  const { wait } = scope
  return () => heldWaitOf(wait)
}

/** How long the current job has waited for slots inside its handler so far; 0 outside any hold. */
export function heldWaitMs(): number {
  const scope = scopes.getStore()
  return scope ? heldWaitOf(scope.wait) : 0
}

/**
 * Keep a lease alive while its holder runs: renew it every LANE_LEASE_RENEW_MS.
 * A lease Redis no longer has is re-created by the renew (re-adopted), so a
 * running job never runs uncounted; one that was released stops the renewals.
 * A renew that fails is logged and tried again on the next tick.
 */
export function keepLeaseAlive(leaseId: string, meta: LaneEntryMeta): { stop(): void } {
  let stopped = false
  let inFlight = false
  const timer = setInterval(() => { void tick() }, LANE_LEASE_RENEW_MS)
  timer.unref?.()
  const stop = () => {
    stopped = true
    clearInterval(timer)
  }
  async function tick(): Promise<void> {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const status = await (await loadConcurrencyGate()).renew(leaseId, LANE_LEASE_TTL_MS, meta)
      if (status === "released") stop()
    } catch (err) {
      warnLaneRateLimited("could not renew a lease", err)
    } finally {
      inFlight = false
    }
  }
  return { stop }
}

// ------------------------------------------------------------- counters
//
// Work that ran outside the gate: calls made with no hold at all (crons, boot)
// and calls run ungated because the gate failed, by job type; not-limited
// scopes by reason; and the gate failures themselves by class. In-process; the
// live usage page reads them through laneCounters().

/** Why a call under a hold ran ungated: the gate gave no answer in time, or failed otherwise. */
export type FailOpenClass = "gate-timeout" | "gate-error"

const ungatedCounts = new Map<string, number>()
const notLimitedCounts = new Map<string, number>()
const failOpenCounts = new Map<FailOpenClass, number>()

/** Count one call that ran with no hold and took no slot. */
export function countUngated(jobType: string): void {
  ungatedCounts.set(jobType, (ungatedCounts.get(jobType) ?? 0) + 1)
}

/** Count one call that ran ungated because the gate failed. */
export function countFailOpen(cls: FailOpenClass): void {
  failOpenCounts.set(cls, (failOpenCounts.get(cls) ?? 0) + 1)
}

export function laneCounters(): {
  ungated: Record<string, number>
  notLimited: Record<string, number>
  failOpen: Partial<Record<FailOpenClass, number>>
} {
  return {
    ungated: Object.fromEntries(ungatedCounts),
    notLimited: Object.fromEntries(notLimitedCounts),
    failOpen: Object.fromEntries(failOpenCounts),
  }
}

/** For tests: zero every counter. */
export function resetLaneCountersForTests(): void {
  ungatedCounts.clear()
  notLimitedCounts.clear()
  failOpenCounts.clear()
}

/**
 * Run `fn` deliberately unlimited (model training, the Copilot): nothing in it
 * acquires a slot. The scope keeps the caller's line and job when there is a
 * hold, and is counted by reason.
 */
export function runNotLimited<T>(reason: "training" | "copilot", fn: () => Promise<T>): Promise<T> {
  notLimitedCounts.set(reason, (notLimitedCounts.get(reason) ?? 0) + 1)
  const outer = scopes.getStore()?.hold
  const hold: ConcurrencyHold = {
    role: "not-limited",
    lane: null,
    userId: outer?.userId ?? "",
    payer: outer?.payer ?? "user:",
    tier: outer?.tier ?? null,
    jobId: outer?.jobId ?? null,
    leaseId: null,
    reason,
    ...(outer?.transport ? { transport: outer.transport } : {}),
  }
  return runHolding(hold, fn)
}
