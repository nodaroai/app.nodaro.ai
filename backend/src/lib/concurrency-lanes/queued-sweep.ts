// backend/src/lib/concurrency-lanes/queued-sweep.ts — the reconcile pass over
// rows waiting for a concurrency slot: the queue timeout, entries Redis lost,
// and line heads whose row ended (ghosts).
//
// OWNING ENVIRONMENT ONLY. Staging runs against the production database but
// its own Redis, so a row parked by production has no line entry and no BullMQ
// entry in staging's Redis: read from there it looks lost. The sweep therefore
// acts only on rows stamped with this process's `lane_env` (getRuntimeEnv())
// and `lane_env_id` (RAILWAY_ENVIRONMENT_ID; a process without one owns only
// rows stamped without one), and never on a waiting row no lane stamped (the
// `queued` rows other paths write). Before migration 568 is in the database
// the stamps do not exist and the sweep does nothing (columns.ts).
//
// NEVER A VERDICT FROM AN ERROR. "Lost" is concluded only from definitive
// answers: the gate says the job is in no line and no server-share wait, and
// BullMQ has neither the entry the row was stamped with nor the one it would
// be added again under. A gate or BullMQ call that fails or does not answer in
// time, a payload read that fails, or a process without a BullMQ connection
// leaves the row as it is; after a Redis timeout the pass stops all Redis work
// (a dead Redis would otherwise hold it LANE_GATE_CALL_TIMEOUT_MS per row).
//
// Per row of this environment, oldest first:
//   - a job of a quietly stopped account: nothing at all. Its jobs are meant to
//     sit accepted and charged, never run (lib/access-blocks.ts): no timeout,
//     no refund, no promote and no re-add (the workers move it back to
//     delayed at their own recheck interval; its line entry lapses by its TTL),
//     exactly as the never-started sweep leaves them alone;
//   - waited ≥ the queue timeout (from `lane_queued_at`, so a Redis restart
//     does not restart the clock): withdraw, fail it (a CAS from the waiting
//     status only — a worker that admitted it meanwhile wins) through the
//     row's own failure path — a job's (markJobFailed), a run's
//     (run-failure.ts: the execution's failure write, event and use-case
//     wrapper; the pipeline's stages, status, events) — and refund only when
//     that write won; its parked BullMQ entry is removed;
//   - in its line or a server-share wait: nothing (its wake or backstop brings it);
//   - its BullMQ entry delayed: promote it (its pickup re-enters the line);
//     waiting or active: nothing;
//   - both gone, a stored payload: add it again under the queue's own
//     deterministic id (`lane-readd-<id>` for a job, whose claim then accepts
//     only `queued`; the execution id; `pipeline-<id>`), which BullMQ
//     de-duplicates and the next pass finds — an ENDED entry still kept under
//     that id (BullMQ keeps finished jobs per the queue's removeOnComplete /
//     removeOnFail) is removed first, or the add would be silently dropped;
//   - both gone, no payload: fail it as lost and refund on the same rule.
// Then the stored payloads whose row ended or is gone are deleted (the table
// has no foreign key: this is also what clears them after an account deletion).
//
// Jobs, workflow executions and pipelines all park (the run lane parks the
// last two, run-admit.ts); each table's read is served by a partial index on
// (lane_env, lane_queued_at) over its waiting rows (migrations 569 and 573).
import { Job, type Queue } from "bullmq"
import { isUserQuietStopped } from "../access-blocks.js"
import { hasCredits } from "../config.js"
import { refundJobHoldsConfirmed } from "../credits-job-lifecycle.js"
import { TERMINAL_JOB_STATUSES } from "../job-status.js"
import { markJobFailedDetailed } from "../job-failure.js"
import type { ReconcileResult } from "../reconcile/cron.js"
import { supabase } from "../supabase.js"
import {
  deleteRequeuePayloads, inChunks, laneColumnsAbsent, laneRowKindOf, readLaneQueuedRows, readRequeuePayload,
  readRequeuePayloadOwners, type LaneQueuedRow, type LaneRowKind, type LaneTable, type RequeuePayload,
} from "./columns.js"
import { LaneWaitTimeoutError } from "./errors.js"
import { LaneGateTimeoutError, type ConcurrencyGate } from "./gate.js"
import { loadConcurrencyGate, warnLaneRateLimited } from "./hold.js"
import { LANE_PARK_BACKSTOP_MS, promoteQuietly, queueOf } from "./park.js"
import { laneSettings } from "./sizes.js"
import { payerOfRow } from "./payer.js"
import type { LaneQueueName, PayerKey } from "./types.js"
import { withdrawFromLane } from "./withdraw.js"
import { LANE_READD_PREFIX } from "./worker-admit.js"
import { failWaitingExecution, failWaitingPipeline } from "./run-failure.js"

const MINUTE_MS = 60_000

/** Rows read per page; a pass reads at most QUEUED_SWEEP_MAX_PAGES pages per table. */
export const QUEUED_SWEEP_PAGE = 500
export const QUEUED_SWEEP_MAX_PAGES = 20

/** A line head not seen for this long has its row read (2 × the park backstop). */
export const LANE_GHOST_AGE_MS = 2 * LANE_PARK_BACKSTOP_MS

/** The most one BullMQ call may take before the pass reads Redis as down. */
const BULL_CALL_TIMEOUT_MS = 5_000

/** The tables the sweep reads: every table whose rows park. */
const SWEPT_TABLES: readonly LaneTable[] = ["jobs", "workflow_executions", "pipelines"]
let sweptTables: readonly LaneTable[] = SWEPT_TABLES

/** The BullMQ id a row is added again under: the id its queue de-duplicates on. */
const READD_ID: Record<LaneTable, (id: string) => string> = {
  jobs: (id) => `${LANE_READD_PREFIX}${id}`,
  workflow_executions: (id) => id,
  pipelines: (id) => `pipeline-${id}`,
}

/** The queue a run is driven on (a job's is stamped on its row). */
const RUN_QUEUE: Partial<Record<LaneTable, LaneQueueName>> = {
  workflow_executions: "workflow-orchestration",
  pipelines: "pipeline-orchestration",
}

/** BullMQ states in which an entry will still run. */
const LIVE_STATES: ReadonlySet<string> = new Set(["delayed", "waiting", "prioritized", "active", "waiting-children"])

// ---------------------------------------------------------------- history

/** A waiting row the sweep ended: for the daily lane history. */
export interface LaneQueueOutcome {
  table: LaneTable
  rowId: string
  userId: string | null
  /**
   * The payer line it waited in: read from its gate entry before the withdraw;
   * without one (Redis lost it, or it waited only for a server share), from
   * its row (a workspace job or run counts on the workspace's line, anything
   * else on the personal one); null with no owner.
   */
  payer: PayerKey | null
  reason: "timeout" | "lost"
  waitedMs: number
}

let recordOutcome: (e: LaneQueueOutcome) => void = () => {}

/** Who counts the rows the sweep ended into the history (the history module); a no-op until registered. */
export function registerLaneQueueOutcomeRecorder(fn: (e: LaneQueueOutcome) => void): void {
  recordOutcome = fn
}

/** For tests: no recorder, and only the tables the sweep reads in production. */
export function resetQueuedSweepForTests(): void {
  recordOutcome = () => {}
  sweptTables = SWEPT_TABLES
}

/** For tests: sweep only these tables. */
export function setQueuedSweepTablesForTests(tables: readonly LaneTable[]): void {
  sweptTables = tables
}

// ---------------------------------------------------------------- helpers

/** BullMQ did not answer in time: Redis is unreachable for this pass. */
class BullCallTimeoutError extends Error {
  constructor(what: string) {
    super(`BullMQ did not answer "${what}" within ${BULL_CALL_TIMEOUT_MS} ms`)
    this.name = "BullCallTimeoutError"
  }
}

/** `promise`, or a BullCallTimeoutError after BULL_CALL_TIMEOUT_MS (the BullMQ connection queues commands while Redis is down). */
function bounded<T>(promise: Promise<T>, what: string): Promise<T> {
  promise.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BullCallTimeoutError(what)), BULL_CALL_TIMEOUT_MS)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

interface Pass {
  now: number
  timeoutMs: number
  gate: ConcurrencyGate | null
  /** Redis did not answer: no more Redis work this pass. */
  redisDown: boolean
  result: ReconcileResult
}

/** Note a Redis failure; a timeout ends Redis work for the pass. */
function noteRedisFailure(pass: Pass, what: string, err: unknown): void {
  if (err instanceof LaneGateTimeoutError || err instanceof BullCallTimeoutError) pass.redisDown = true
  pass.result.errors++
  warnLaneRateLimited(`the queued sweep could not ${what}`, err)
}

const isLaneQueue = (q: string | null | undefined): q is LaneQueueName =>
  q === "video-generation" || q === "video-render" || q === "video-director" || q === "workflow-orchestration" || q === "pipeline-orchestration"

/** The BullMQ entry `id` on `queue`, when it is this row's and will still run; null when it is gone, ended, or another job's. */
async function liveEntry(queue: Queue, id: string, table: LaneTable, rowId: string): Promise<{ job: Job; state: string } | null> {
  const job = await bounded(Job.fromId(queue, id), "find a BullMQ entry")
  if (!job) return null
  if (table === "jobs" && (job.data as { jobId?: unknown } | undefined)?.jobId !== rowId) return null
  const state = await bounded(job.getState(), "read a BullMQ entry's state")
  return LIVE_STATES.has(state) ? { job, state } : null
}

// ------------------------------------------------------------- end a wait

/**
 * Fail a waiting run through its own failure path (run-failure.ts); true when
 * this call failed it. A pipeline has no message column: its failure reason
 * names what happened.
 */
async function failRun(table: Exclude<LaneTable, "jobs">, row: LaneQueuedRow, err: LaneWaitTimeoutError): Promise<boolean> {
  if (table === "workflow_executions") return failWaitingExecution(row.id, err.message)
  return failWaitingPipeline(row.id, row.user_id, err.failureHint.reason === "timeout" ? "queue_timeout" : "queue_lost")
}

/**
 * Remove a timed-out or lost row's parked BullMQ entry, so its backstop does
 * not bring it to a pickup: a job's stamped entry, a run's entry under its
 * queue's own id. Best effort.
 */
async function removeParkedEntry(table: LaneTable, row: LaneQueuedRow, pass: Pass): Promise<void> {
  const queueName = table === "jobs" ? row.lane_bull_queue : RUN_QUEUE[table]
  const bullJobId = table === "jobs" ? row.lane_bull_job_id : READD_ID[table](row.id)
  if (pass.redisDown || !isLaneQueue(queueName) || !bullJobId) return
  const queue = queueOf(queueName)
  if (!queue) return
  try {
    const live = await liveEntry(queue, bullJobId, table, row.id)
    // An active entry is a pickup in progress: its claim finds the row failed and discards it.
    if (live && live.state !== "active") await bounded(live.job.remove(), "remove a parked entry")
  } catch (err) {
    if (err instanceof BullCallTimeoutError) pass.redisDown = true
    warnLaneRateLimited("could not remove a timed-out job's parked entry", err)
  }
}

/**
 * Refund a failed waiting job: everything it holds goes back, since it never
 * ran. Never throws (what follows — the parked entry, the payload, the
 * history count — must happen whatever the refund did).
 */
async function refundEveryHold(row: LaneQueuedRow, err: LaneWaitTimeoutError, pass: Pass): Promise<void> {
  try {
    // FIRST the job's own refund path: it settles what is not a plain refund
    // (a metered hold, managed credits, a billed refusal) on its main
    // reservation. workers/shared.ts loads the media toolchain: only when
    // there is a refund to make.
    const { refundJobCredits } = await import("../../workers/shared.js")
    await refundJobCredits(row.usage_log_id, row.id, err)
  } catch (refundErr) {
    pass.result.errors++
    console.error(`[concurrency-lanes] could not refund job ${row.id} after its queue wait ended:`, refundErr)
  }
  if (!hasCredits()) return
  // THEN only what is left: every other hold still `reserved` (an add-on beside
  // the main reservation). Each refund is a CAS on `usage_logs.status =
  // 'reserved'`, so nothing refunded above, or by any other path, is refunded
  // twice. Retried and confirmed by a read; an unconfirmed one is counted.
  if (!(await refundJobHoldsConfirmed(row.id))) {
    pass.result.errors++
    console.error(`[concurrency-lanes] job ${row.id}: could not confirm that every hold was refunded after its queue wait ended`)
  }
}

/** The payer line a row waited in, for the history (see LaneQueueOutcome.payer). Never throws. */
async function payerOfWaiting(row: LaneQueuedRow, pass: Pass): Promise<PayerKey | null> {
  if (!pass.redisDown && pass.gate) {
    try {
      const payer = await pass.gate.waitingPayer(row.id)
      if (payer) return payer
    } catch (err) {
      warnLaneRateLimited("could not read a waiting row's payer line", err)
    }
  }
  if (!row.user_id) return null
  return payerOfRow({ user_id: row.user_id, workspace_id: row.workspace_id ?? null }).payer
}

/** Fail a waiting row (the timeout, or a lost entry) and refund it only when the failure write won. */
async function endWaiting(table: LaneTable, row: LaneQueuedRow, reason: "timeout" | "lost", waitedMs: number, pass: Pass): Promise<void> {
  const err = new LaneWaitTimeoutError({ reason, waitedMs, timeoutMinutes: Math.round(pass.timeoutMs / MINUTE_MS) })
  const payer = await payerOfWaiting(row, pass)
  if (!pass.redisDown) await withdrawFromLane(row.id)
  let won: boolean
  if (table === "jobs") {
    // From `queued` only: a worker that admitted the job meanwhile runs it.
    const outcome = await markJobFailedDetailed(row.id, { error_message: err.message, error_hint: err.failureHint, from: ["queued"] })
    if (outcome === "error") pass.result.errors++
    won = outcome === "flipped"
    if (won) {
      await refundEveryHold(row, err, pass)
      await removeParkedEntry(table, row, pass)
    }
  } else {
    // The run's own failure path refunds what it holds (a pipeline its reservation, a use-case run its wrapper's fee).
    won = await failRun(table, row, err)
    if (won) await removeParkedEntry(table, row, pass)
  }
  if (!won) {
    pass.result.notStale++
    return
  }
  pass.result.swept++
  void deleteRequeuePayloads(laneRowKindOf(table), [row.id])
  try {
    recordOutcome({ table, rowId: row.id, userId: row.user_id, payer, reason, waitedMs })
  } catch (recordErr) {
    warnLaneRateLimited("could not count a queue timeout into the history", recordErr)
  }
  console.log(`[concurrency-lanes] ${table} row ${row.id} ${reason === "timeout" ? "timed out in its queue" : "lost its place in line"} after ${Math.floor(waitedMs / MINUTE_MS)} min; failed and refunded`)
}

/**
 * Whether a waiting run's BullMQ entry (its queue's own id) is `active` — a
 * worker picked it up and is admitting or running it. True also whenever
 * Redis gives no answer (this read failed, or Redis was found down earlier in
 * the pass), so a run is never failed while it may be starting; it times out
 * on a pass that can read its entry.
 */
async function runPickupInProgress(table: Exclude<LaneTable, "jobs">, row: LaneQueuedRow, pass: Pass): Promise<boolean> {
  if (pass.redisDown) return true
  const queue = queueOf(RUN_QUEUE[table]!)
  if (!queue) return false
  try {
    return (await liveEntry(queue, READD_ID[table](row.id), table, row.id))?.state === "active"
  } catch (err) {
    noteRedisFailure(pass, "read a timed-out run's BullMQ entry", err)
    return true
  }
}

// ------------------------------------------------------------- per row

async function sweepRow(table: LaneTable, row: LaneQueuedRow, pass: Pass): Promise<void> {
  // Before anything else: a quietly stopped account's waiting job is neither timed out, refunded, promoted nor re-added.
  if (table === "jobs" && (await isUserQuietStopped(row.user_id))) {
    pass.result.notStale++
    return
  }
  const queuedAt = Date.parse(row.lane_queued_at)
  const waitedMs = Number.isFinite(queuedAt) ? Math.max(0, pass.now - queuedAt) : 0
  if (Number.isFinite(queuedAt) && waitedMs >= pass.timeoutMs) {
    // A run's own claim is no compare-and-set (the orchestrator moves its
    // execution to `running` unconditionally; a pipeline drive sets its own
    // status): a run admitted just as it timed out would be failed AND run.
    // Its BullMQ entry being `active` says a pickup is in progress — that run
    // is not stale. Without an answer the run waits for the next pass.
    if (table !== "jobs" && (await runPickupInProgress(table, row, pass))) {
      pass.result.notStale++
      return
    }
    await endWaiting(table, row, "timeout", waitedMs, pass)
    return
  }
  // Everything below reads absence from Redis: only on definitive answers.
  if (pass.redisDown || !pass.gate) return
  try {
    if (await pass.gate.describeWait(row.id)) {
      pass.result.notStale++
      return
    }
  } catch (err) {
    noteRedisFailure(pass, "read a waiting row's line", err)
    return
  }

  // A job carries its BullMQ entry on its row; a run keeps it in its payload only.
  let payload: RequeuePayload | null | undefined
  if (table !== "jobs") {
    const read = await readRequeuePayload(table, row.id)
    if (read === "error") {
      pass.result.errors++
      return
    }
    payload = read
  }
  const stampedQueue = table === "jobs" ? (row.lane_bull_queue ?? payload?.bullQueue) : (payload?.bullQueue ?? RUN_QUEUE[table])
  if (!isLaneQueue(stampedQueue)) {
    // No queue to look in (a stamp that was never complete): nothing can be judged.
    pass.result.notStale++
    return
  }
  const queue = queueOf(stampedQueue)
  if (!queue) return // no BullMQ connection in this process: nothing can be judged
  const stampedId = table === "jobs" ? (row.lane_bull_job_id ?? payload?.bullJobId ?? null) : (payload?.bullJobId ?? null)
  const readdId = READD_ID[table](row.id)
  try {
    for (const id of new Set([stampedId, readdId].filter((v): v is string => typeof v === "string" && v.length > 0))) {
      const live = await liveEntry(queue, id, table, row.id)
      if (!live) continue
      if (live.state === "delayed") {
        // Its line entry is gone; the pickup re-enters the line.
        if (await promoteQuietly(() => bounded(live.job.promote(), "promote a parked entry"), row.id)) pass.result.recovered++
        else pass.result.notStale++
      } else {
        pass.result.notStale++
      }
      return
    }
  } catch (err) {
    noteRedisFailure(pass, "look up a waiting row's BullMQ entry", err)
    return
  }

  // Both gone: Redis lost the job.
  if (payload === undefined) {
    const read = await readRequeuePayload(table, row.id)
    if (read === "error") {
      pass.result.errors++
      return
    }
    payload = read
  }
  if (payload === null) {
    await endWaiting(table, row, "lost", waitedMs, pass)
    return
  }
  const target = isLaneQueue(payload.bullQueue) ? queueOf(payload.bullQueue) : queue
  if (!target) return
  try {
    // An ENDED entry kept under the re-add id (the queue keeps finished jobs)
    // would swallow the add: BullMQ de-duplicates on the id whatever its state.
    const kept = await bounded(Job.fromId(target, readdId), "find an ended entry under the re-add id")
    if (kept) {
      const state = await bounded(kept.getState(), "read an ended entry's state")
      if (LIVE_STATES.has(state)) {
        pass.result.notStale++
        return
      }
      await bounded(kept.remove(), "remove an ended entry under the re-add id")
    }
    await bounded(target.add(payload.name, payload.data, { ...payload.opts, jobId: readdId } as Parameters<Queue["add"]>[2]), "add a lost entry again")
    pass.result.recovered++
    console.log(`[concurrency-lanes] ${table} row ${row.id} lost its queue entry; added again as ${readdId}`)
  } catch (err) {
    noteRedisFailure(pass, "add a lost entry again", err)
  }
}

async function sweepTable(table: LaneTable, pass: Pass): Promise<void> {
  if (laneColumnsAbsent(table)) return
  const seen = new Set<string>()
  let from: string | null = null
  for (let page = 0; page < QUEUED_SWEEP_MAX_PAGES; page++) {
    const rows = await readLaneQueuedRows(table, { fromQueuedAt: from, limit: QUEUED_SWEEP_PAGE })
    if (rows === "absent") return
    if (rows === "error") {
      pass.result.errors++
      return
    }
    // Paged on lane_queued_at (rows a page ended leave the set, so offsets would skip rows); ties re-read are skipped.
    const fresh = rows.filter((r) => !seen.has(r.id))
    if (fresh.length === 0) return
    for (const row of fresh) {
      seen.add(row.id)
      pass.result.scanned++
      try {
        await sweepRow(table, row, pass)
      } catch (err) {
        pass.result.errors++
        console.error(`[concurrency-lanes] queued sweep failed for ${table} row ${row.id}:`, err)
      }
    }
    if (rows.length < QUEUED_SWEEP_PAGE) return
    from = rows[rows.length - 1]!.lane_queued_at
  }
}

// ------------------------------------------------------ payload clean-up

/** The statuses after which a row is never driven again. */
const ENDED_STATUSES: Record<LaneRowKind, ReadonlySet<string>> = {
  job: new Set<string>(TERMINAL_JOB_STATUSES),
  execution: new Set(["completed", "failed", "cancelled", "timed_out", "discarded"]),
  pipeline: new Set(["completed", "failed", "cancelled", "forked"]),
}
const KIND_TABLE: Record<LaneRowKind, LaneTable> = { job: "jobs", execution: "workflow_executions", pipeline: "pipelines" }

/** The rows among `ids` that ended or are gone; null when the read failed (nothing is deleted then). */
async function endedOwners(kind: LaneRowKind, ids: string[]): Promise<string[] | null> {
  const status = new Map<string, string>()
  for (const chunk of inChunks(ids)) {
    // trash-read: a payload belongs to its row whether or not the row is in the Trash.
    const { data, error } = (await supabase.from(KIND_TABLE[kind]).select("id, status").in("id", chunk)) ?? {}
    if (error) {
      warnLaneRateLimited(`could not read the ${KIND_TABLE[kind]} rows of stored requeue payloads`, error)
      return null
    }
    for (const r of (data ?? []) as Array<{ id: string; status: string }>) status.set(r.id, r.status)
  }
  return ids.filter((id) => !status.has(id) || ENDED_STATUSES[kind].has(status.get(id)!))
}

/** Delete the stored payloads whose row ended or is gone. Environment-agnostic: an ended row is ended in the shared database. */
async function sweepEndedPayloads(result: ReconcileResult): Promise<void> {
  const seen = new Set<string>()
  let from: string | null = null
  for (let page = 0; page < QUEUED_SWEEP_MAX_PAGES; page++) {
    const owners = await readRequeuePayloadOwners({ fromCreatedAt: from, limit: QUEUED_SWEEP_PAGE })
    if (owners === "error") return
    const fresh = owners.filter((o) => !seen.has(`${o.kind}:${o.rowId}`))
    if (fresh.length === 0) return
    for (const kind of ["job", "execution", "pipeline"] as const) {
      const ids = fresh.filter((o) => o.kind === kind).map((o) => o.rowId)
      if (ids.length === 0) continue
      const ended = await endedOwners(kind, ids)
      if (ended === null) {
        result.errors++
        continue
      }
      if (ended.length > 0) await deleteRequeuePayloads(kind, ended)
    }
    for (const o of fresh) seen.add(`${o.kind}:${o.rowId}`)
    if (owners.length < QUEUED_SWEEP_PAGE) return
    from = owners[owners.length - 1]!.createdAt
  }
}

// ------------------------------------------------------------------ entry

/**
 * The queued sweep (see the module comment): this environment's waiting jobs,
 * runs and pipelines, then the stored payloads of rows that ended. Counts into
 * `result`; never throws.
 */
export async function sweepLaneQueuedJobs(result: ReconcileResult): Promise<void> {
  let timeoutMs: number
  try {
    timeoutMs = (await laneSettings()).queueTimeoutMs
  } catch (err) {
    warnLaneRateLimited("the queued sweep could not read the queue timeout", err)
    result.errors++
    return
  }
  const pass: Pass = { now: Date.now(), timeoutMs, gate: null, redisDown: false, result }
  try {
    pass.gate = await loadConcurrencyGate()
  } catch (err) {
    // Timeouts still run (the database alone decides them); no lost-entry verdicts.
    warnLaneRateLimited("the queued sweep could not load the concurrency gate", err)
    pass.redisDown = true
  }
  for (const table of sweptTables) await sweepTable(table, pass)
  try {
    await sweepEndedPayloads(result)
  } catch (err) {
    result.errors++
    console.error("[concurrency-lanes] the requeue payload clean-up failed:", err)
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The row a line head waits for: a run's own table, else the job (an inline call's entry is `<jobId>:call:<uuid>`); null for a live request's. */
function headRow(jobId: string, queue: string | null): { table: LaneTable; id: string } | null {
  if (queue === "workflow-orchestration") return { table: "workflow_executions", id: jobId }
  if (queue === "pipeline-orchestration") return { table: "pipelines", id: jobId }
  // A live request waits in its own connection and has no row: the waiter TTL drops it.
  if (queue === "live") return null
  if (queue === "inline") {
    const owner = jobId.split(":call:")[0] ?? ""
    return { table: "jobs", id: owner }
  }
  return { table: "jobs", id: jobId }
}

const STILL_WAITING: ReadonlySet<string> = new Set(["queued", "pending"])

/**
 * Withdraw every line head not seen for LANE_GHOST_AGE_MS whose row no longer
 * waits (ended, started, or gone): a waiter ended by a path that skipped the
 * withdraw must not block its line. Heads come from this environment's Redis,
 * so they are this environment's. A row read that fails keeps the head. Never
 * throws.
 */
export async function sweepLaneGhosts(result: ReconcileResult): Promise<void> {
  let heads: Awaited<ReturnType<ConcurrencyGate["heads"]>>
  try {
    heads = await (await loadConcurrencyGate()).heads()
  } catch (err) {
    warnLaneRateLimited("the ghost sweep could not read the line heads", err)
    result.errors++
    return
  }
  const cutoff = Date.now() - LANE_GHOST_AGE_MS
  for (const head of heads) {
    if (head.lastSeenMs > cutoff) continue
    const target = headRow(head.jobId, head.queue)
    if (!target || !UUID.test(target.id)) continue
    result.scanned++
    try {
      const { data, error } = (await supabase
        // trash-read: a waiter whose job went to the Trash is a ghost like any other.
        .from(target.table)
        .select("status")
        .eq("id", target.id)
        .maybeSingle()) ?? {}
      if (error) {
        warnLaneRateLimited(`the ghost sweep could not read ${target.table} row ${target.id}`, error)
        result.errors++
        continue
      }
      const status = (data as { status?: unknown } | null)?.status
      if (typeof status === "string" && STILL_WAITING.has(status)) {
        result.notStale++
        continue
      }
      await withdrawFromLane(head.jobId)
      result.swept++
    } catch (err) {
      result.errors++
      warnLaneRateLimited("the ghost sweep failed on a line head", err)
    }
  }
}
