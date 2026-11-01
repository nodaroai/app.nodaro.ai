// backend/src/lib/concurrency-lanes/execution-wait.ts — a workflow run's time
// spent waiting for concurrency slots, kept off every workflow clock (decided
// 2026-10-30: nothing fails for waiting; only the queue timeout ends a wait).
//
// Two halves:
//   - in the orchestrator, `ctx.laneWaitMs` is the WALL-CLOCK time during
//     which at least one of the run's child jobs waited (`queued`) — the
//     union of their waits, as `pollJobToCompletion` observes them
//     (`addRunLaneWait`), so siblings waiting at once count once; the run's
//     cap takes it off the elapsed time, and it is persisted to
//     `workflow_executions.lane_wait_ms` while non-zero
//     (`persistRunLaneWait`) — never written while nothing queues;
//   - outside it, the clocks that wait on an execution (the stale sweeps,
//     app-expunge, a component's or use-case node's wait on its inner run,
//     the component route and its wait-limit answer) read the run's queued
//     time from the rows (`executionQueuedMs`), and only once their base limit
//     is spent, so a run that never queued costs no extra query.
//
// Every wait read from a row's `lane_queued_at` is capped at the longest queue
// timeout an admin can set plus slack (`MAX_QUEUED_CREDIT_MS`): the queued
// sweep ends a wait by then, so a row it missed can never extend a clock
// without end.
//
// The column is read and written TOLERANTLY until migration 568 reaches the
// shared database (staging runs dev code on it): a missing column reads as no
// wait, and is remembered for the life of the process (columns.ts).
import type { OrchestratorContext } from "../../services/workflow-engine/types.js"
import { supabase } from "../supabase.js"
import { jobIdsOf } from "../node-state-job-ids.js"
import { WRAPPER_JOB_PROVIDERS } from "../wrapper-providers.js"
import { inChunks, laneColumnsAbsent, noteLaneColumnError } from "./columns.js"
import { coveredMs, MAX_QUEUED_CREDIT_MS, mergeWaitInterval } from "./queued-clock.js"

type PgError = { readonly code?: string | null; readonly message?: string } | null | undefined

// The bound and the interval arithmetic are shared with every other clock that leaves queued time out.
export { MAX_LANE_WAIT_INTERVALS, MAX_QUEUE_TIMEOUT_MS, MAX_QUEUED_CREDIT_MS } from "./queued-clock.js"
/** Same limit as component nesting (`executeComponentNode`: depth ≥ 5 refused). */
const MAX_NESTING_DEPTH = 5

const epochMs = (v: unknown): number | null => {
  const ms = typeof v === "string" ? Date.parse(v) : NaN
  return Number.isFinite(ms) ? ms : null
}

const capped = (ms: number): number => Math.min(MAX_QUEUED_CREDIT_MS, Math.max(0, ms))

const warn = (what: string, err: unknown): void => {
  const e = err as PgError | Error
  console.warn(`[concurrency-lanes] ${what}: ${(e as { message?: string } | null)?.message ?? (e as { code?: string } | null)?.code ?? String(err)}`)
}

/**
 * Credit the run the wait `[fromMs, toMs]` a child job of it spent waiting for
 * a slot. The run keeps the waits as a merged list of intervals
 * (`ctx.laneWaitIntervals`) and `laneWaitMs` is their total covered length —
 * the wall clock during which at least one child waited (decided 2026-10-30):
 * siblings waiting at the same time count once, waits one after another count
 * in full, and a wait reported late (a component's inner run, on completion)
 * counts wherever it falls, whatever was reported since. The list is bounded
 * (`MAX_LANE_WAIT_INTERVALS`). An empty or invalid interval leaves the context
 * untouched, so a run that never queued keeps no `laneWaitMs`.
 */
export function addRunLaneWait(
  ctx: Pick<OrchestratorContext, "laneWaitMs" | "laneWaitIntervals">,
  fromMs: number,
  toMs: number,
): void {
  const merged = mergeWaitInterval(ctx.laneWaitIntervals, fromMs, toMs)
  if (!merged) return
  ctx.laneWaitIntervals = merged
  ctx.laneWaitMs = coveredMs(merged)
}

/** What each run's context last persisted (per context, so a resumed attempt starts again). */
const persisted = new WeakMap<object, number>()

/**
 * Persist the run's queued time to `workflow_executions.lane_wait_ms`, called
 * beside the run's node-state writes. Writes only when the run has waited
 * (non-zero) and the figure grew since its last write — never while nothing
 * queues — in its own statement, so a database without the column never fails
 * a node-state write. The column only grows (`lt`): a resumed attempt, whose
 * own figure starts again from 0, never lowers what an earlier attempt wrote
 * (the readers then over-credit, the safe side). Never throws.
 */
export async function persistRunLaneWait(executionId: string, ctx: Pick<OrchestratorContext, "laneWaitMs">): Promise<void> {
  const ms = Math.round(ctx.laneWaitMs ?? 0)
  if (ms <= 0 || ms <= (persisted.get(ctx) ?? 0) || laneColumnsAbsent("workflow_executions")) return
  try {
    const { error } = (await supabase
      .from("workflow_executions")
      .update({ lane_wait_ms: ms })
      .eq("id", executionId)
      .lt("lane_wait_ms", ms)) ?? {}
    if (error) {
      if (!noteLaneColumnError("workflow_executions", error)) warn(`could not persist the queued time of execution ${executionId}`, error)
      return
    }
    if (ms > (persisted.get(ctx) ?? 0)) persisted.set(ctx, ms)
  } catch (err) {
    warn(`could not persist the queued time of execution ${executionId}`, err)
  }
}

export interface ExecutionQueuedOptions {
  /**
   * Also count the run's OWN wait for its run slot: `lane_queued_at` →
   * `started_at` (written at its claim, after admission), or → now while it
   * still waits. For a clock that started before the run was admitted (the
   * component route's wait, the editor's, app-expunge's `created_at` clock);
   * a clock measured from `started_at` already leaves it out.
   */
  readonly includeOwnWait?: boolean
  readonly nowMs?: number
}

/** A wait still going on: when it started to count, and how much it counts. */
interface LiveWait {
  readonly fromMs: number
  readonly ms: number
}

/**
 * How long (ms) the execution has waited for concurrency slots, from the rows:
 *
 *   - its persisted `lane_wait_ms` (the wall clock its jobs waited, up to the
 *     run's last node-state write — `workflow_executions.updated_at`);
 *   - plus what is still going on, all of it ending now: the longest wait of
 *     its children still `queued` (they overlap, so the longest is their
 *     union), counted only after the persisted figure's last write so
 *     nothing persisted counts twice; and the queued time of each component
 *     or use-case node's inner run still in flight (its wrapper job in the
 *     run's node states; recursively, owner-scoped, to the nesting limit).
 *     These run at once, so together they credit at most the wall clock since
 *     the earliest of them began (their sum, capped at that span);
 *   - plus, on request, the run's own wait for its run slot.
 *
 * Every wait read from a `lane_queued_at` is capped (`MAX_QUEUED_CREDIT_MS`).
 * Only `ownerId`'s rows count (decided 2026-10-06; migration 474). Best
 * effort: a failed read, or a database without the lane columns, counts as no
 * wait — which leaves the caller on its default (today's) limit. Read it
 * lazily, once the caller's base limit is spent.
 */
export async function executionQueuedMs(
  executionId: string,
  ownerId: string,
  opts: ExecutionQueuedOptions = {},
  depth = 0,
  visited: Set<string> = new Set(),
): Promise<number> {
  if (!executionId || !ownerId || visited.has(executionId) || depth > MAX_NESTING_DEPTH) return 0
  visited.add(executionId)
  const now = opts.nowMs ?? Date.now()

  const run = await readRunRow(executionId, ownerId)
  let total = 0
  /** The persisted figure covers waits up to here: a live wait counts only after it. */
  let coveredUntil = -Infinity
  if (run) {
    const persistedMs = Number(run.lane_wait_ms ?? 0)
    if (Number.isFinite(persistedMs) && persistedMs > 0) {
      total += persistedMs
      coveredUntil = epochMs(run.updated_at) ?? now
    }
    const queuedAt = opts.includeOwnWait ? epochMs(run.lane_queued_at) : null
    if (queuedAt !== null) total += capped((epochMs(run.started_at) ?? now) - queuedAt)
  }

  const live: LiveWait[] = []
  const child = await longestWaitingChild(executionId, ownerId, now)
  if (child !== null) {
    const fromMs = Math.max(child, coveredUntil)
    if (now > fromMs) live.push({ fromMs, ms: capped(now - fromMs) })
  }
  if (run && depth < MAX_NESTING_DEPTH) {
    for (const inner of await innerRunsInFlight(run.node_states, ownerId)) {
      const ms = await executionQueuedMs(inner.executionId, ownerId, { includeOwnWait: true, nowMs: now }, depth + 1, visited)
      if (ms > 0) live.push({ fromMs: inner.sinceMs ?? now - ms, ms })
    }
  }
  if (live.length > 0) {
    const span = now - Math.min(...live.map((w) => w.fromMs))
    total += Math.max(0, Math.min(live.reduce((sum, w) => sum + w.ms, 0), span))
  }
  return total
}

interface RunRow {
  lane_wait_ms?: unknown
  lane_queued_at?: unknown
  started_at?: unknown
  updated_at?: unknown
  node_states?: unknown
}

/** The run's row; its lane columns only while they are in this database. Never throws. */
async function readRunRow(executionId: string, ownerId: string): Promise<RunRow | null> {
  const base = "started_at, updated_at, node_states"
  const read = (columns: string) => supabase
    .from("workflow_executions")
    .select(columns)
    .eq("id", executionId)
    .eq("user_id", ownerId)
    .maybeSingle()
  try {
    let withLane = !laneColumnsAbsent("workflow_executions")
    let { data, error } = (await read(withLane ? `lane_wait_ms, lane_queued_at, ${base}` : base)) ?? {}
    if (error && withLane && noteLaneColumnError("workflow_executions", error)) {
      withLane = false
      ;({ data, error } = (await read(base)) ?? {})
    }
    if (error) {
      warn(`could not read the queued time of execution ${executionId}`, error)
      return null
    }
    if (!data) return null
    const row = data as RunRow
    // Only what was asked for: without the lane columns there is no wait of the run's own.
    return withLane ? row : { started_at: row.started_at, updated_at: row.updated_at, node_states: row.node_states }
  } catch (err) {
    warn(`could not read the queued time of execution ${executionId}`, err)
    return null
  }
}

/** When the run's longest-waiting child still `queued` entered its line; null when none (or unreadable). Never throws. */
async function longestWaitingChild(executionId: string, ownerId: string, now: number): Promise<number | null> {
  if (laneColumnsAbsent("jobs")) return null
  try {
    const { data, error } = (await supabase
      // trash-read: a run's waiting child keeps the run alive whether or not it was trashed.
      .from("jobs")
      .select("lane_queued_at")
      .eq("workflow_execution_id", executionId)
      .eq("user_id", ownerId)
      .eq("status", "queued")) ?? {}
    if (error) {
      if (!noteLaneColumnError("jobs", error)) warn(`could not read the waiting jobs of execution ${executionId}`, error)
      return null
    }
    let earliest: number | null = null
    for (const r of (data ?? []) as Array<{ lane_queued_at?: unknown }>) {
      const queuedAt = epochMs(r.lane_queued_at)
      if (queuedAt !== null && queuedAt < now && (earliest === null || queuedAt < earliest)) earliest = queuedAt
    }
    return earliest
  } catch (err) {
    warn(`could not read the waiting jobs of execution ${executionId}`, err)
    return null
  }
}

/** The inner runs of the run's component and use-case nodes still in flight (their wrapper jobs, named in its node states). Never throws. */
async function innerRunsInFlight(nodeStates: unknown, ownerId: string): Promise<Array<{ executionId: string; sinceMs: number | null }>> {
  const ids = jobIdsOf(nodeStates && typeof nodeStates === "object" ? (nodeStates as Record<string, unknown>) : null)
  const out: Array<{ executionId: string; sinceMs: number | null }> = []
  if (ids.length === 0) return out
  try {
    for (const chunk of inChunks(ids)) {
      const { data, error } = (await supabase
        // trash-read: a run's in-flight component or use-case node keeps the run alive whether or not it was trashed.
        .from("jobs")
        .select("input_data, created_at")
        .in("id", chunk)
        .in("provider", [...WRAPPER_JOB_PROVIDERS])
        .in("status", ["pending", "processing"])
        .eq("user_id", ownerId)) ?? {}
      if (error) {
        warn("could not read the in-flight wrappers of a run", error)
        continue
      }
      for (const w of (data ?? []) as Array<{ input_data?: Record<string, unknown> | null; created_at?: unknown }>) {
        const inner = w.input_data?._executionId
        if (typeof inner === "string" && inner) out.push({ executionId: inner, sinceMs: epochMs(w.created_at) })
      }
    }
  } catch (err) {
    warn("could not read the in-flight wrappers of a run", err)
  }
  return out
}

/**
 * When each of these `queued` jobs entered its line (`jobs.lane_queued_at`),
 * by id — for the orchestrator's resume, which re-attaches a waiting child on
 * the queued time it already has. Its own statement, run only when the resume
 * found a waiting child: a database without the column answers an empty map
 * (the child is then adopted on fresh clocks), and the resume's main read
 * never names the column. Never throws.
 */
export async function laneQueuedAtOf(jobIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (jobIds.length === 0 || laneColumnsAbsent("jobs")) return out
  try {
    const { data, error } = (await supabase
      // trash-read: the resume re-attaches its own waiting children, trashed or not.
      .from("jobs")
      .select("id, lane_queued_at")
      .in("id", [...jobIds])) ?? {}
    if (error) {
      if (!noteLaneColumnError("jobs", error)) warn(`could not read when ${jobIds.length} waiting job(s) entered their line`, error)
      return out
    }
    for (const r of (data ?? []) as Array<{ id?: unknown; lane_queued_at?: unknown }>) {
      const queuedAt = epochMs(r.lane_queued_at)
      if (typeof r.id === "string" && queuedAt !== null) out.set(r.id, queuedAt)
    }
  } catch (err) {
    warn(`could not read when ${jobIds.length} waiting job(s) entered their line`, err)
  }
  return out
}
