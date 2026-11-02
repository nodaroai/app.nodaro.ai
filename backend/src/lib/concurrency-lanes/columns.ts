// backend/src/lib/concurrency-lanes/columns.ts — the lane columns (migration
// 568) and the requeue side table, read and written TOLERANTLY until the
// migration reaches the database.
//
// Staging runs dev code against the shared production database, and migrations
// apply only when dev is promoted to main — so for that window the columns do
// not exist, and a statement naming one fails WHOLE. Every writer here is its
// own statement, except one: the workers' pickup claim also writes the job's
// BullMQ entry (claimWithBullEntry), and is retried without it when a lane
// column is missing. On a missing-column error (42703 / PGRST204) the table is
// remembered as absent for the life of the process — a deploy that applies the
// migration restarts it — and nothing names the columns again. The precedent
// is lib/jobs-slot-wait-column.ts.
//
// Migration 568 adds `lane_bull_queue` / `lane_bull_job_id` to `jobs` only;
// `workflow_executions` and `pipelines` keep their BullMQ entry in
// `lane_requeue_payloads` alone, so nothing here names those two columns on
// them.
import { getRuntimeEnv } from "../runtime-env.js"
import { supabase } from "../supabase.js"
import type { LaneQueueName } from "./types.js"

export type LaneTable = "jobs" | "workflow_executions" | "pipelines"

/** 42703: undefined column (Postgres); PGRST204: unknown column in a write (PostgREST). */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"])
/** 42P01: undefined table (Postgres); PGRST205: unknown table (PostgREST). */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"])

const REQUEUE_TABLE = "lane_requeue_payloads"

const absentTables = new Set<LaneTable | typeof REQUEUE_TABLE>()

type PgError = { readonly code?: string | null; readonly message?: string } | null | undefined

/** True when `error` says a lane column of `table` does not exist (and records it). */
export function noteLaneColumnError(table: LaneTable, error: PgError): boolean {
  if (!error?.code || !MISSING_COLUMN_CODES.has(error.code)) return false
  absentTables.add(table)
  return true
}

/** Is `table` known, in this process, to lack the lane columns? */
export function laneColumnsAbsent(table: LaneTable): boolean {
  return absentTables.has(table)
}

/** For tests. */
export function resetLaneColumnsForTests(): void {
  absentTables.clear()
}

const ROW_KIND: Record<LaneTable, "job" | "execution" | "pipeline"> = {
  jobs: "job",
  workflow_executions: "execution",
  pipelines: "pipeline",
}

/**
 * The fields that record which BullMQ entry carries the job
 * (`lane_bull_queue`, `lane_bull_job_id`), so a cancel or a reconcile can find
 * any job's entry by id; none once the columns are known to be missing (or
 * there is no entry id).
 */
export function bullEntryFields(queue: LaneQueueName, bullJobId: string | null | undefined): Record<string, string> {
  if (!bullJobId || laneColumnsAbsent("jobs")) return {}
  return { lane_bull_queue: queue, lane_bull_job_id: bullJobId }
}

const isMissingColumnError = (error: PgError): boolean => !!error?.code && MISSING_COLUMN_CODES.has(error.code)

/** What a tolerant status read appends to its column list: the lane stamp, or nothing. */
export const LANE_STAMP_SELECT = ", lane_queued_at" as const
export type LaneStampSelect = typeof LANE_STAMP_SELECT | ""

/** The table of each row kind (the reverse of ROW_KIND). */
const TABLE_OF_KIND = Object.fromEntries(Object.entries(ROW_KIND).map(([table, kind]) => [kind, table])) as Record<LaneRowKind, LaneTable>

/**
 * A status read that also names `lane_queued_at` (to tell a row waiting for a
 * slot) on the table of `kind`. `read(stamp)` writes its query in place and
 * ends its column list with `stamp`: LANE_STAMP_SELECT, or `""` once the table
 * is known to lack the column. On a missing-column error the read runs again
 * without it; only when that one succeeds is the column remembered as absent —
 * a missing column the caller named answers that error as it always did.
 */
export async function readWithLaneStamp<R extends { error: PgError }>(kind: LaneRowKind, read: (stamp: LaneStampSelect) => PromiseLike<R>): Promise<R> {
  const table = TABLE_OF_KIND[kind]
  if (laneColumnsAbsent(table)) return read("")
  const first = await read(LANE_STAMP_SELECT)
  if (!isMissingColumnError(first.error)) return first
  const retry = await read("")
  if (!retry.error) noteLaneColumnError(table, first.error)
  return retry
}

/**
 * A worker's pickup claim, writing the job's BullMQ entry in the same UPDATE
 * (one statement per pickup): `claim(fields)` runs the claim with `fields`
 * spread into its update. A missing column fails the whole statement, so on a
 * missing-column error the claim is run again without the lane fields; when
 * that one succeeds, the lane columns are the missing ones and are remembered
 * as absent (never named again in this process). When it fails on a missing
 * column too, another column the caller named is missing: that result is
 * returned for the caller's own retry, and nothing is remembered here. The
 * claim's own status set and semantics are the caller's, unchanged.
 */
export async function claimWithBullEntry<R extends { error: PgError }>(
  queue: LaneQueueName,
  bullJobId: string | null | undefined,
  claim: (fields: Record<string, string>) => PromiseLike<R>,
): Promise<R> {
  const fields = bullEntryFields(queue, bullJobId)
  const first = await claim(fields)
  if (Object.keys(fields).length === 0 || !isMissingColumnError(first.error)) return first
  const second = await claim({})
  if (!second.error) absentTables.add("jobs")
  return second
}

const LANE_QUEUE_NAMES: ReadonlySet<string> = new Set<LaneQueueName>([
  "video-generation", "video-render", "workflow-orchestration", "pipeline-orchestration", "video-director", "live", "inline",
])

/**
 * The BullMQ entry a job was stamped with (`lane_bull_queue`,
 * `lane_bull_job_id`) and the row's status, so a cancel can remove it by id
 * (and tell a job that started from one still waiting); null when the job has
 * none (never picked up, or the columns are not in this database). Never
 * throws: any failure answers null, and the caller scans instead.
 */
export async function readBullEntry(jobId: string): Promise<{ queue: LaneQueueName; bullJobId: string; status: string | null } | null> {
  if (laneColumnsAbsent("jobs")) return null
  try {
    const { data, error } = (await supabase
      // trash-read: a cancel removes the BullMQ entry of the very job it cancels, trashed or not.
      .from("jobs")
      .select("status, lane_bull_queue, lane_bull_job_id")
      .eq("id", jobId)
      .maybeSingle()) ?? {}
    if (error) {
      if (!noteLaneColumnError("jobs", error)) {
        console.warn(`[concurrency-lanes] could not read the BullMQ entry of job ${jobId}: ${error.message ?? error.code}`)
      }
      return null
    }
    const row = data as { status?: unknown; lane_bull_queue?: unknown; lane_bull_job_id?: unknown } | null
    const queue = row?.lane_bull_queue
    const bullJobId = row?.lane_bull_job_id
    if (typeof queue !== "string" || !LANE_QUEUE_NAMES.has(queue) || typeof bullJobId !== "string" || bullJobId.length === 0) return null
    return { queue: queue as LaneQueueName, bullJobId, status: typeof row?.status === "string" ? row.status : null }
  } catch (err) {
    console.warn(`[concurrency-lanes] could not read the BullMQ entry of job ${jobId}: ${(err as Error)?.message ?? String(err)}`)
    return null
  }
}

/** The BullMQ options a parked entry is added again with (copied from the job's own). */
export interface RequeueOpts {
  priority?: number
  attempts?: number
  backoff?: unknown
  removeOnComplete?: unknown
  removeOnFail?: unknown
}

export interface QueuedStamp {
  bullQueue: LaneQueueName
  bullJobId: string
  /** The BullMQ name, payload and options the row was parked with, for a re-add after Redis lost it; null keeps what is stored. */
  requeue: { name: string; data: unknown; opts: RequeueOpts } | null
}

/** The options as stored: only those the job set. */
function storedOpts(opts: RequeueOpts): RequeueOpts {
  const out: RequeueOpts = {}
  if (opts.priority !== undefined) out.priority = opts.priority
  if (opts.attempts !== undefined) out.attempts = opts.attempts
  if (opts.backoff !== undefined) out.backoff = opts.backoff
  if (opts.removeOnComplete !== undefined) out.removeOnComplete = opts.removeOnComplete
  if (opts.removeOnFail !== undefined) out.removeOnFail = opts.removeOnFail
  return out
}

/** What stampQueued wrote. */
export interface QueuedStampResult {
  /**
   * "stamped": `lane_env` (with `lane_env_id`) and `lane_queued_at` are on the
   * row — the queued sweep sees it, so it may wait; "not-waiting": the row no
   * longer waits (nothing was written); "failed": the row stamps could not be
   * written or confirmed (the columns are not in this database, or a write
   * failed) — the row must not be left waiting, since no sweep would see it.
   */
  row: "stamped" | "not-waiting" | "failed"
  /** The row's status as the stamp found it (a job: `pending` on a first park, `queued` on a re-park); null unless stamped. */
  status: string | null
  /** The requeue payload is stored (or none was asked for). Without it a lost entry fails as lost instead of being added again. */
  payloadStored: boolean
}

/** Store the payload a parked row can be added again with; true when stored (or none was asked for). Never throws. */
async function storeRequeuePayload(table: LaneTable, id: string, stamp: QueuedStamp): Promise<boolean> {
  if (stamp.requeue === null) return true
  if (absentTables.has(REQUEUE_TABLE)) return false
  try {
    const { error } = (await supabase.from(REQUEUE_TABLE).upsert({
      kind: ROW_KIND[table],
      row_id: id,
      bull_queue: stamp.bullQueue,
      bull_job_id: stamp.bullJobId,
      name: stamp.requeue.name,
      data: stamp.requeue.data,
      opts: storedOpts(stamp.requeue.opts),
    }, { onConflict: "kind,row_id" })) ?? {}
    if (!error) return true
    if (error.code && MISSING_TABLE_CODES.has(error.code)) absentTables.add(REQUEUE_TABLE)
    else console.warn(`[concurrency-lanes] could not store the requeue payload of ${table} row ${id}: ${error.message ?? error.code}`)
    return false
  } catch (err) {
    console.warn(`[concurrency-lanes] could not store the requeue payload of ${table} row ${id}: ${(err as Error)?.message ?? String(err)}`)
    return false
  }
}

const NOT_STAMPED: QueuedStampResult = { row: "failed", status: null, payloadStored: false }

/**
 * Stamp a row about to wait, BEFORE it is marked waiting: the owning
 * environment (`lane_env`, `lane_env_id`), its BullMQ entry (on `jobs`),
 * `lane_queued_at` on the first park only, and the requeue payload in
 * `lane_requeue_payloads` (service-role only: the payload carries the billing
 * context, and `jobs` rows reach users). The row stamps are written only while
 * the row still waits, and read back from the row: a re-park, whose
 * `lane_queued_at` is already set, is stamped all the same. Never throws.
 */
export async function stampQueued(table: LaneTable, id: string, stamp: QueuedStamp): Promise<QueuedStampResult> {
  if (laneColumnsAbsent(table)) return NOT_STAMPED
  try {
    const env = {
      lane_env: getRuntimeEnv(),
      lane_env_id: process.env.RAILWAY_ENVIRONMENT_ID || null,
      ...(table === "jobs" ? { lane_bull_queue: stamp.bullQueue, lane_bull_job_id: stamp.bullJobId } : {}),
    }
    // A job waits from `pending` (first park) or `queued` (re-park); a run in its own waiting status.
    const waiting = table === "jobs" ? ["pending", "queued"] : [LANE_WAITING_STATUS[table]]
    const { data: rows, error: envError } = (await supabase
      .from(table)
      .update(env)
      .eq("id", id)
      .in("status", waiting)
      .select("status, lane_queued_at")) ?? {}
    if (envError) {
      if (!noteLaneColumnError(table, envError)) console.warn(`[concurrency-lanes] could not stamp parked ${table} row ${id}: ${envError.message ?? envError.code}`)
      return NOT_STAMPED
    }
    const row = (Array.isArray(rows) ? rows[0] : null) as { status?: unknown; lane_queued_at?: unknown } | null | undefined
    if (!row) return { row: "not-waiting", status: null, payloadStored: false }
    const status = typeof row.status === "string" ? row.status : null
    if (typeof row.lane_queued_at !== "string" || row.lane_queued_at.length === 0) {
      // The first park only: the queue timeout counts from it, across re-parks and Redis restarts.
      const { error: queuedError } = (await supabase
        .from(table)
        .update({ lane_queued_at: new Date().toISOString() })
        .eq("id", id)
        .is("lane_queued_at", null)) ?? {}
      if (queuedError) {
        if (!noteLaneColumnError(table, queuedError)) console.warn(`[concurrency-lanes] could not stamp lane_queued_at on ${table} row ${id}: ${queuedError.message ?? queuedError.code}`)
        return NOT_STAMPED
      }
    }
    return { row: "stamped", status, payloadStored: await storeRequeuePayload(table, id, stamp) }
  } catch (err) {
    console.warn(`[concurrency-lanes] could not stamp parked ${table} row ${id}: ${(err as Error)?.message ?? String(err)}`)
    return NOT_STAMPED
  }
}

// ------------------------------------------------- the queued sweep's reads

/** The kind a `lane_requeue_payloads` row names its owner by. */
export type LaneRowKind = "job" | "execution" | "pipeline"

/** The `lane_requeue_payloads` kind of a table's rows. */
export function laneRowKindOf(table: LaneTable): LaneRowKind {
  return ROW_KIND[table]
}

/** A parked row as the queued sweep reads it. `lane_bull_*` are null on executions and pipelines (they keep theirs in the payload). */
export interface LaneQueuedRow {
  id: string
  user_id: string | null
  lane_queued_at: string
  /** `jobs` only: the reservation a failed job is refunded from. */
  usage_log_id: string | null
  /** `jobs` and `workflow_executions` (pipelines have none): the workspace it runs for, for the history's payer line. */
  workspace_id?: string | null
  lane_bull_queue: string | null
  lane_bull_job_id: string | null
}

/** The status a waiting row has: a job is `queued`, a workflow execution stays `pending`, a pipeline stays `queued`. */
export const LANE_WAITING_STATUS: Record<LaneTable, string> = {
  jobs: "queued",
  workflow_executions: "pending",
  pipelines: "queued",
}

const QUEUED_ROW_COLUMNS: Record<LaneTable, string> = {
  jobs: "id, user_id, workspace_id, usage_log_id, lane_queued_at, lane_bull_queue, lane_bull_job_id",
  workflow_executions: "id, user_id, workspace_id, lane_queued_at",
  pipelines: "id, user_id, lane_queued_at",
}

/**
 * One page of the rows THIS environment parked, oldest first: still waiting,
 * stamped with this process's `lane_env` (getRuntimeEnv()) and `lane_env_id`
 * (RAILWAY_ENVIRONMENT_ID; a process without one matches only rows stamped
 * without one, so a process off Railway that shares a Railway environment's
 * name never acts on that environment's rows), and parked at or after
 * `fromQueuedAt`. A row without `lane_env` (never parked by a lane: the
 * legacy `queued` rows other paths write) is never returned. "absent": the
 * lane columns are not in this database (remembered for the process);
 * "error": the read failed. Never throws.
 */
export async function readLaneQueuedRows(
  table: LaneTable,
  page: { fromQueuedAt: string | null; limit: number },
): Promise<LaneQueuedRow[] | "absent" | "error"> {
  if (laneColumnsAbsent(table)) return "absent"
  try {
    const envId = process.env.RAILWAY_ENVIRONMENT_ID || null
    let q = supabase
      // trash-read: a parked job in the Trash still times out and is refunded like any other.
      .from(table)
      .select(QUEUED_ROW_COLUMNS[table])
      .eq("status", LANE_WAITING_STATUS[table])
      .eq("lane_env", getRuntimeEnv())
    q = envId ? q.eq("lane_env_id", envId) : q.is("lane_env_id", null)
    q = q.not("lane_queued_at", "is", null)
    if (page.fromQueuedAt) q = q.gte("lane_queued_at", page.fromQueuedAt)
    const { data, error } = (await q.order("lane_queued_at", { ascending: true }).limit(page.limit)) ?? {}
    if (error) {
      if (noteLaneColumnError(table, error)) return "absent"
      console.warn(`[concurrency-lanes] could not read the parked ${table} rows: ${error.message ?? error.code}`)
      return "error"
    }
    const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)
    return ((data ?? []) as unknown as Array<Record<string, unknown>>)
      .filter((r) => str(r.id) !== null && str(r.lane_queued_at) !== null)
      .map((r) => ({
        id: r.id as string,
        user_id: str(r.user_id),
        workspace_id: str(r.workspace_id),
        lane_queued_at: r.lane_queued_at as string,
        usage_log_id: str(r.usage_log_id),
        lane_bull_queue: str(r.lane_bull_queue),
        lane_bull_job_id: str(r.lane_bull_job_id),
      }))
  } catch (err) {
    console.warn(`[concurrency-lanes] could not read the parked ${table} rows: ${(err as Error)?.message ?? String(err)}`)
    return "error"
  }
}

/** A stored requeue payload: the BullMQ entry a row was parked with, and what to add it again with. */
export interface RequeuePayload {
  bullQueue: string
  bullJobId: string
  name: string
  data: unknown
  opts: RequeueOpts
}

/**
 * The payload a row was parked with; null when it has none. "error": the read
 * failed, or the table is not in this database — never read as "none", which
 * would fail the row as lost. Never throws.
 */
export async function readRequeuePayload(table: LaneTable, id: string): Promise<RequeuePayload | null | "error"> {
  if (absentTables.has(REQUEUE_TABLE)) return "error"
  try {
    const { data, error } = (await supabase
      .from(REQUEUE_TABLE)
      .select("bull_queue, bull_job_id, name, data, opts")
      .eq("kind", ROW_KIND[table])
      .eq("row_id", id)
      .maybeSingle()) ?? {}
    if (error) {
      if (error.code && MISSING_TABLE_CODES.has(error.code)) absentTables.add(REQUEUE_TABLE)
      else console.warn(`[concurrency-lanes] could not read the requeue payload of ${table} row ${id}: ${error.message ?? error.code}`)
      return "error"
    }
    const row = data as { bull_queue?: unknown; bull_job_id?: unknown; name?: unknown; data?: unknown; opts?: unknown } | null
    if (!row) return null
    if (typeof row.bull_queue !== "string" || typeof row.bull_job_id !== "string" || typeof row.name !== "string") return null
    const opts = row.opts !== null && typeof row.opts === "object" ? storedOpts(row.opts as RequeueOpts) : {}
    return { bullQueue: row.bull_queue, bullJobId: row.bull_job_id, name: row.name, data: row.data, opts }
  } catch (err) {
    console.warn(`[concurrency-lanes] could not read the requeue payload of ${table} row ${id}: ${(err as Error)?.message ?? String(err)}`)
    return "error"
  }
}

/** Ids per `.in()` list: 500 UUIDs is past what the gateway reliably accepts (ee/notifications/credits-digest.ts, ee/routes/deployment-billing.ts). */
export const LANE_IN_CHUNK = 200

/** `ids` in lists of at most LANE_IN_CHUNK. */
export function inChunks<T>(ids: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < ids.length; i += LANE_IN_CHUNK) out.push(ids.slice(i, i + LANE_IN_CHUNK))
  return out
}

/**
 * Delete the requeue payloads of these rows (they were admitted, or ended).
 * Best effort: never throws; false when it could not.
 */
export async function deleteRequeuePayloads(kind: LaneRowKind, rowIds: readonly string[]): Promise<boolean> {
  if (rowIds.length === 0) return true
  if (absentTables.has(REQUEUE_TABLE)) return false
  try {
    for (const chunk of inChunks(rowIds)) {
      const { error } = (await supabase.from(REQUEUE_TABLE).delete().eq("kind", kind).in("row_id", chunk)) ?? {}
      if (error) {
        if (error.code && MISSING_TABLE_CODES.has(error.code)) absentTables.add(REQUEUE_TABLE)
        else console.warn(`[concurrency-lanes] could not delete ${chunk.length} ${kind} requeue payload(s): ${error.message ?? error.code}`)
        return false
      }
    }
    return true
  } catch (err) {
    console.warn(`[concurrency-lanes] could not delete ${rowIds.length} ${kind} requeue payload(s): ${(err as Error)?.message ?? String(err)}`)
    return false
  }
}

/**
 * For a worker's pickup, after its claim won: the job runs now, so the payload
 * it was parked with (if it ever parked) is no longer needed. Best effort, not
 * awaited by the caller, never throws.
 */
export async function dropRequeuePayload(jobId: string): Promise<void> {
  await deleteRequeuePayloads("job", [jobId])
}

/** One page of stored payloads, oldest first, for the sweep that deletes those whose row ended. "error" when it could not read. Never throws. */
export async function readRequeuePayloadOwners(page: { fromCreatedAt: string | null; limit: number }): Promise<Array<{ kind: LaneRowKind; rowId: string; createdAt: string }> | "error"> {
  if (absentTables.has(REQUEUE_TABLE)) return "error"
  try {
    let q = supabase.from(REQUEUE_TABLE).select("kind, row_id, created_at")
    if (page.fromCreatedAt) q = q.gte("created_at", page.fromCreatedAt)
    const { data, error } = (await q.order("created_at", { ascending: true }).limit(page.limit)) ?? {}
    if (error) {
      if (error.code && MISSING_TABLE_CODES.has(error.code)) absentTables.add(REQUEUE_TABLE)
      else console.warn(`[concurrency-lanes] could not read the requeue payloads: ${error.message ?? error.code}`)
      return "error"
    }
    return ((data ?? []) as Array<{ kind?: unknown; row_id?: unknown; created_at?: unknown }>)
      .filter((r) => (r.kind === "job" || r.kind === "execution" || r.kind === "pipeline") && typeof r.row_id === "string" && typeof r.created_at === "string")
      .map((r) => ({ kind: r.kind as LaneRowKind, rowId: r.row_id as string, createdAt: r.created_at as string }))
  } catch (err) {
    console.warn(`[concurrency-lanes] could not read the requeue payloads: ${(err as Error)?.message ?? String(err)}`)
    return "error"
  }
}
