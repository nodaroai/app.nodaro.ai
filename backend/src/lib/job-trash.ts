/**
 * The jobs Trash (migration 561, decided 2026-10-25). Deleting a job stamps
 * `deleted_at`: from then on every user-facing read leaves it out
 * (`TRASHED_JOB_COLUMN`), it stays restorable for `TRASH_RETENTION_DAYS`, and
 * the purge (lib/job-trash-purge.ts) then deletes it for good through
 * `deleteJobWithPrivateMedia` — the job delete as it always was: its child
 * jobs and private media go, a copy saved to the Library stays. Its session links are kept
 * while it is in the Trash, so a restored job is back where it was. Nothing is
 * refunded on a delete or a purge.
 *
 * Moving a job to the Trash also frees its idempotency key (UNIQUE per owner,
 * migration 166): a request sent again with the same key makes a new job, as
 * after the old hard delete, instead of answering with one nobody can read. A
 * restored job keeps working; it just no longer answers that key.
 *
 * A non-admin reaches only their own jobs, and never a child job (it reads as
 * one that does not exist, CHILD_JOB_COLUMN); an admin reaches any, as the
 * delete always allowed. A miss is `not_found` — never "it is someone else's".
 */
import { supabase } from "./supabase.js"
import { CHILD_JOB_COLUMN, TRASHED_JOB_COLUMN } from "./public-job-data.js"
import { deleteJobWithPrivateMedia } from "./workflow-delete.js"

export const TRASH_RETENTION_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * DAY_MS

/** When a job deleted at `deletedAt` is purged for good. */
export function purgeAtOf(deletedAt: string): string {
  return new Date(Date.parse(deletedAt) + TRASH_RETENTION_MS).toISOString()
}

export type JobTrashOutcome =
  | { kind: "done" }
  | { kind: "not_found" }
  | { kind: "not_in_trash" }
  | { kind: "error"; error: unknown }

export interface JobTrashActor {
  readonly jobId: string
  readonly userId: string
  readonly isAdmin: boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The caller's job by id, live or in the Trash: its `deleted_at`, or null when it is not theirs to reach. */
async function findReachableJob(a: JobTrashActor): Promise<{ deletedAt: string | null } | null | { error: unknown }> {
  // trash-read: the Trash's own routes read a job whether or not it is in the Trash.
  let query = supabase.from("jobs").select(`id, ${TRASHED_JOB_COLUMN}`).eq("id", a.jobId)
  if (!a.isAdmin) query = query.eq("user_id", a.userId).is(CHILD_JOB_COLUMN, null)
  const { data, error } = await query.maybeSingle()
  if (error) return { error }
  if (!data) return null
  return { deletedAt: ((data as Record<string, unknown>)[TRASHED_JOB_COLUMN] as string | null) ?? null }
}

/**
 * Move a job to the Trash. A job already there answers `done` and keeps its
 * purge date (a retried delete never extends it).
 */
export async function trashJob(a: JobTrashActor): Promise<JobTrashOutcome> {
  if (!UUID_RE.test(a.jobId)) return { kind: "not_found" }
  let update = supabase
    .from("jobs")
    .update({ [TRASHED_JOB_COLUMN]: new Date().toISOString(), idempotency_key: null })
    .eq("id", a.jobId)
    .is(TRASHED_JOB_COLUMN, null)
  if (!a.isAdmin) update = update.eq("user_id", a.userId).is(CHILD_JOB_COLUMN, null)
  const { data, error } = await update.select("id")
  if (error) return { kind: "error", error }
  if ((data ?? []).length > 0) return { kind: "done" }
  const found = await findReachableJob(a)
  if (found && "error" in found) return { kind: "error", error: found.error }
  return found?.deletedAt ? { kind: "done" } : { kind: "not_found" }
}

/** Bring a job back from the Trash. A live job answers `done` too. */
export async function restoreJob(a: JobTrashActor): Promise<JobTrashOutcome> {
  if (!UUID_RE.test(a.jobId)) return { kind: "not_found" }
  let update = supabase
    .from("jobs")
    .update({ [TRASHED_JOB_COLUMN]: null })
    .eq("id", a.jobId)
    .not(TRASHED_JOB_COLUMN, "is", null)
  if (!a.isAdmin) update = update.eq("user_id", a.userId).is(CHILD_JOB_COLUMN, null)
  const { data, error } = await update.select("id")
  if (error) return { kind: "error", error }
  if ((data ?? []).length > 0) return { kind: "done" }
  const found = await findReachableJob(a)
  if (found && "error" in found) return { kind: "error", error: found.error }
  return found ? { kind: "done" } : { kind: "not_found" }
}

/**
 * Delete a job in the Trash for good, now. A live job answers `not_in_trash`
 * (the API's 409): it is moved to the Trash first, never deleted in one step.
 */
export async function deleteTrashedJobForGood(
  a: JobTrashActor & { logger?: { warn(fields: Record<string, unknown>, message: string): void } },
): Promise<JobTrashOutcome> {
  if (!UUID_RE.test(a.jobId)) return { kind: "not_found" }
  const found = await findReachableJob(a)
  if (found && "error" in found) return { kind: "error", error: found.error }
  if (!found) return { kind: "not_found" }
  if (!found.deletedAt) return { kind: "not_in_trash" }
  try {
    const deleted = await deleteJobWithPrivateMedia({
      jobId: a.jobId,
      actorUserId: a.userId,
      isAdmin: a.isAdmin,
      onlyTrashedBefore: "infinity",
      logger: a.logger,
    })
    // Restored between the read and the delete: it is live again.
    return deleted ? { kind: "done" } : { kind: "not_in_trash" }
  } catch (error) {
    return { kind: "error", error }
  }
}
