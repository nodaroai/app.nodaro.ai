/**
 * The jobs Trash's purge: a job deleted more than `TRASH_RETENTION_DAYS` ago
 * is deleted for good — its child jobs, its session links (the CASCADE) and
 * its private media with it — through `deleteJobWithPrivateMedia`, the one job
 * delete. The age is re-checked under the row lock
 * (`delete_trashed_job_with_recast_cleanup`, migration 561), so a job restored
 * between the list and the delete is kept.
 *
 * It runs where scheduled workflows fire (`scheduleTriggersEnabled`): on
 * Railway only in production, so staging's newer code — or a local backend —
 * never deletes production's data (all three share one database), and on a
 * self-hosted install. Idempotent across replicas: a job another runner
 * purged first answers "not deleted" and is skipped. Batched: at most
 * `PURGE_BATCH` jobs a round and `PURGE_MAX_ROUNDS` rounds a tick, oldest
 * first and keyed on (deleted_at, id), so a job that fails is passed over
 * within the tick and tried again on the next one — it never holds the rest
 * back. Best-effort: a failure is counted and reported, never thrown. A
 * database before migration 561 has no `deleted_at`: nothing to do.
 */
import { supabase } from "./supabase.js"
import { TRASHED_JOB_COLUMN } from "./public-job-data.js"
import { isMissingColumnError } from "./postgrest-errors.js"
import { deleteJobWithPrivateMedia } from "./workflow-delete.js"
import { TRASH_RETENTION_MS } from "./job-trash.js"
import { scheduleTriggersEnabled } from "./config.js"

export const PURGE_BATCH = 100
export const PURGE_MAX_ROUNDS = 10
const PURGE_INTERVAL_MS = 60 * 60 * 1000

export interface JobTrashPurgeResult {
  readonly purged: number
  readonly failed: number
}

type PurgeLogger = { warn(fields: Record<string, unknown>, message: string): void }

export async function purgeExpiredTrashedJobs(nowMs: number = Date.now(), logger?: PurgeLogger): Promise<JobTrashPurgeResult> {
  const cutoff = new Date(nowMs - TRASH_RETENTION_MS).toISOString()
  let purged = 0
  let failed = 0
  let after: { at: string; id: string } | null = null
  for (let round = 0; round < PURGE_MAX_ROUNDS; round++) {
    let query = supabase
      // tenant-scope-ignore: the platform purge of every owner's expired Trash; each delete is the job's own.
      .from("jobs")
      .select(`id, ${TRASHED_JOB_COLUMN}`)
      // trash-read: the purge reads only the Trash.
      .not(TRASHED_JOB_COLUMN, "is", null)
      .lt(TRASHED_JOB_COLUMN, cutoff)
    // Strictly after the last row read: values quoted (a timestamp holds `:` and `+`).
    if (after) query = query.or(`${TRASHED_JOB_COLUMN}.gt."${after.at}",and(${TRASHED_JOB_COLUMN}.eq."${after.at}",id.gt."${after.id}")`)
    const { data, error } = await query
      .order(TRASHED_JOB_COLUMN, { ascending: true })
      .order("id", { ascending: true })
      .limit(PURGE_BATCH)
    if (error) {
      if (isMissingColumnError(error)) return { purged, failed }
      return { purged, failed: failed + 1 }
    }
    const rows = ((data ?? []) as Array<Record<string, unknown>>).flatMap((r) =>
      typeof r.id === "string" && typeof r[TRASHED_JOB_COLUMN] === "string" ? [{ id: r.id, at: r[TRASHED_JOB_COLUMN] as string }] : [],
    )
    for (const { id: jobId } of rows) {
      try {
        const deleted = await deleteJobWithPrivateMedia({ jobId, actorUserId: null, isAdmin: true, onlyTrashedBefore: cutoff, logger })
        if (deleted) purged++
      } catch {
        failed++
      }
    }
    const last = rows[rows.length - 1]
    if (!last || rows.length < PURGE_BATCH) break
    after = last
  }
  return { purged, failed }
}

/** Purge on boot, then every hour. Returns the stop function the server's `onClose` awaits. */
export function startJobTrashPurge(report: (message: string) => void): () => Promise<void> {
  if (!scheduleTriggersEnabled()) return async () => {}
  let stopped = false
  let pending: Promise<void> | undefined
  const logger: PurgeLogger = { warn: (_fields, message) => report(message) }
  const tick = () => {
    if (stopped || pending) return
    pending = (async () => {
      const result = await purgeExpiredTrashedJobs(Date.now(), logger)
      if (result.failed > 0) report(`Jobs Trash purge: ${result.failed} failed; they will be retried`)
    })().finally(() => {
      pending = undefined
    })
  }
  const timer = setInterval(tick, PURGE_INTERVAL_MS)
  timer.unref()
  tick()
  return async () => {
    stopped = true
    clearInterval(timer)
    await pending
  }
}
