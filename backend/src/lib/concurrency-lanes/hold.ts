// backend/src/lib/concurrency-lanes/hold.ts — the slot the current code runs
// under, carried by AsyncLocalStorage, so a funnel deep inside a job or a run
// (the provider egress, the LLM router, a toolkit member) knows whose work it
// is and whether it must take a slot itself:
//   leaf         — the code already holds a slot (of `lane`): calls under it never acquire;
//   run          — a top-level run (holds a run slot): its calls acquire at the front of their lane;
//   coordinator  — a job that dispatches or makes several calls: same as run, without a run slot;
//   not-limited  — work that is deliberately not limited (training, the Copilot): never acquires;
//   request      — a request (request-scope.ts) that holds no slot yet: its first call takes one
//                  for the rest of the request, and the scope then holds it as a leaf hold.
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
import { LANE_LEASE_RENEW_MS, LANE_LEASE_TTL_MS, type ConcurrencyGate, type ReleaseOutcome } from "./gate.js"
import { coveredMs, mergeWaitInterval, type WaitInterval } from "./queued-clock.js"
import type { ConcurrencyLane, LaneEntryMeta, PayerKey } from "./types.js"

export interface ConcurrencyHold {
  role: "leaf" | "run" | "coordinator" | "not-limited" | "request"
  /** The lane of the slot held: the leaf's lane, `run` for a run, null for a coordinator, not-limited or request scope. */
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
  /**
   * Set on the pass-through hold a call that ran ungated under no hold gives
   * its nested calls (slot.ts, `coversNested`): it only stops them from being
   * counted again. It is no job's and no request's: nothing under it waits as
   * a job (coordinator-wait.ts).
   */
  passThrough?: true
}

/** A job's in-handler wait, shared by every nested scope of the same job. */
export interface HeldWait {
  /** Waits added as a bare amount (addHeldWaitMs). */
  ms: number
  /** Waits added as wall-clock intervals (addHeldWait), merged. */
  intervals: WaitInterval[]
}

/**
 * What a request scope (request-scope.ts) keeps about the slot it holds. The
 * scope's hold reads `request` until the first slot is taken, then the leaf
 * hold of that slot. Written by slot.ts; released by the request's wrapper.
 */
export interface RequestSlotState {
  /** How long a live wait may last: the request's own transport, or none (the queue timeout) under a coordinator. */
  readonly transport: "json" | "sse" | "mcp" | undefined
  /** Ends a wait still in progress (the client went away); never a call already running. */
  readonly signal: AbortSignal | undefined
  /**
   * The run or coordinator hold the request was injected under (a job's
   * in-process request): its calls take a front slot of the job's line under
   * the queue timeout, never the live limit. Undefined for a live request.
   */
  readonly coordinator: ConcurrencyHold | undefined
  /**
   * The slot the request holds, once one is taken; null for none (or one run
   * ungated). `release` frees it (and stops its renewal) and never throws.
   */
  lease: { leaseId: string; lane: ConcurrencyLane; release(outcome: ReleaseOutcome): Promise<void> } | null
  /** The take in progress, shared by every call that asks while it lasts. */
  pending: Promise<void> | null
  /** Set when the request's handler has settled: nothing new is taken, and a take still in progress is released. */
  ended: boolean
}

/** One runHolding scope (or one request's scope). Internal to the lane modules (slot.ts, request-scope.ts). */
export interface HoldScope {
  /** The hold. A request scope's changes once: from its `request` hold to the leaf hold of the slot it takes. */
  hold: ConcurrencyHold
  /** The job's in-handler wait, shared by every nested scope of the same job. */
  readonly wait: HeldWait
  /** Set when runHolding's `fn` has settled: nothing new is admitted under the scope. */
  closed: boolean
  /** Present on a request scope only. */
  readonly request?: RequestSlotState
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
    // Outside any hold scope: the gate and its connection live for the process.
    const p = outsideHoldScopes(() => import("./instance.js"))
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
export async function releaseQuietly(leaseId: string, outcome: ReleaseOutcome): Promise<void> {
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
  const scope = newHoldScope(hold)
  try {
    return await scopes.run(scope, fn)
  } finally {
    scope.closed = true
    runCloseHooks(scope)
  }
}

/** What runs when a runHolding scope closes (onHoldScopeClose). */
const closeHooks = new WeakMap<HoldScope, Set<() => void>>()

/**
 * Run `fn` once when `scope` (a runHolding scope) closes — at once when it
 * already has. Returns a function that cancels it. For the lane modules: a
 * slot taken ahead of its call (slot.ts) is released when its job ends even
 * if nobody released it.
 */
export function onHoldScopeClose(scope: HoldScope, fn: () => void): () => void {
  if (scope.closed) {
    fn()
    return () => {}
  }
  let hooks = closeHooks.get(scope)
  if (!hooks) {
    hooks = new Set()
    closeHooks.set(scope, hooks)
  }
  const set = hooks
  set.add(fn)
  return () => { set.delete(fn) }
}

function runCloseHooks(scope: HoldScope): void {
  const hooks = closeHooks.get(scope)
  if (!hooks) return
  closeHooks.delete(scope)
  for (const fn of hooks) {
    try {
      fn()
    } catch (err) {
      warnLaneRateLimited("a scope-close hook threw", err)
    }
  }
}

/**
 * A scope for `hold`, nested in the current one: a scope of the same job
 * shares the job's in-handler wait. For request-scope.ts, which enters it
 * with runInHoldScope and closes it itself.
 */
export function newHoldScope(hold: ConcurrencyHold, request?: RequestSlotState): HoldScope {
  const parent = scopes.getStore()
  const wait = parent && parent.hold.jobId === hold.jobId ? parent.wait : { ms: 0, intervals: [] }
  return request ? { hold, wait, closed: false, request } : { hold, wait, closed: false }
}

/** Run `fn` (synchronously) with `scope` current. The caller closes the scope when its work has settled. */
export function runInHoldScope<T>(scope: HoldScope, fn: () => T): T {
  return scopes.run(scope, fn)
}

/**
 * Run `fn` outside every hold scope — for what lives for the process (a
 * connection, a subscriber) and must not carry the scope of the call that
 * happened to start it.
 */
export function outsideHoldScopes<T>(fn: () => T): T {
  return scopes.exit(fn)
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
