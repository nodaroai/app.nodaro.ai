/**
 * The credit holds of a batch's jobs: who pays for a job, and undoing what a
 * request paid for — before anything is queued (`undoOwnedJobs`), or after the
 * queue refused the batch's bulk add (`settleRefusedBatch`, which fails each
 * job from `pending` first). Kept beside `job-batch.ts`, which runs the steps.
 *
 * The invariant: a job ends with exactly ONE live hold. Completion commits
 * whichever `reserved` log the job has (`job-finalize.ts :: loadUsageLogId`), so
 * a second hold would stay reserved forever — the user charged twice. Two
 * requests can only both reserve one job if the first lost its claim mid-step
 * (its lease lapsed while it worked); the request that sees another hold
 * after its own reservation YIELDS: it refunds its own and the job keeps the
 * other's. Its own, never the other's: the other may already sit in the queue
 * entry a failure refunds by (only the first enqueue of a job's queue id
 * counts).
 */
import type { FastifyRequest } from "fastify"
import { jobCreditHolds, refundJobHoldsConfirmed, refundUsageLogConfirmed, type JobHold } from "./credits-job-lifecycle.js"
import { markJobFailedDetailed, type JobFailureOutcome, type MarkJobFailedInput } from "./job-failure.js"
import { insertAppReport } from "./app-reports.js"
import { supabase } from "./supabase.js"

/**
 * After this request reserved `ownLogId` for `jobId`: the job's hold when it is
 * ANOTHER request's (ours refunded, the job pointed at that one), or null when
 * ours is the job's (or the holds cannot be read — ours then stands).
 */
export async function yieldToOtherHold(req: FastifyRequest, jobId: string, ownLogId: string): Promise<JobHold | null> {
  const holds = await jobCreditHolds([jobId])
  const others = (holds?.get(jobId) ?? []).filter((hold) => hold.id !== ownLogId)
  if (others.length === 0) return null
  const kept = others[0]!
  if (!(await refundUsageLogConfirmed(ownLogId))) {
    req.log.error({ jobId, usageLogId: ownLogId }, "[job-batch] a second hold on one job could not be refunded")
  }
  // The reservation pointed the job at ours; point it back at the one it keeps.
  const { error } = await supabase
    .from("jobs")
    .update({ usage_log_id: kept.id, ...(kept.credits !== null ? { credits: kept.credits } : {}) })
    .eq("id", jobId)
    .eq("usage_log_id", ownLogId)
  if (error) req.log.warn({ err: error, jobId }, "[job-batch] could not point a job back at the hold it keeps")
  // Both requests yielding (each saw the other) leaves the job unpaid: an
  // under-charge, never a double charge — said loudly so it is seen.
  const after = await jobCreditHolds([jobId])
  if (after && (after.get(jobId) ?? []).length === 0) {
    req.log.error({ jobId }, "[job-batch] two requests each yielded a job's hold: it runs with none")
  }
  return kept
}

/** A job this request undoes: created by it, or taken over by it. */
export interface UndoableJob {
  readonly jobId: string
  /** Paid for by another request after a race: never this request's to undo. */
  readonly paidByOther?: boolean
}

/**
 * Undo what this request owns: refund each job's holds and remove the jobs
 * whose refund is CONFIRMED. A job whose refund is not stays `pending` and
 * unqueued, for the never-started sweep to fail and refund (deleting it would
 * strand the hold: `usage_logs.job_id` is ON DELETE SET NULL). Never throws.
 */
export async function undoOwnedJobs(req: FastifyRequest, owned: readonly UndoableJob[]): Promise<void> {
  const mine = owned.filter((job) => !job.paidByOther)
  if (mine.length === 0) return
  const removable: string[] = []
  const stranded: string[] = []
  for (const job of mine) {
    // True at once for a job holding nothing (not reserved yet, or a
    // reservation that was refused before any debit).
    if (await refundJobHoldsConfirmed(job.jobId)) removable.push(job.jobId)
    else stranded.push(job.jobId)
  }
  if (stranded.length > 0) {
    req.log.error(
      { jobIds: stranded },
      "[job-batch] refund not confirmed while undoing a batch: jobs left pending and unqueued for the never-started sweep to fail and refund",
    )
  }
  await removeJobs(req, removable)
}

/** Remove the jobs of an undone batch (with `onlyFailed`, only rows that read `failed`). Never throws. */
async function removeJobs(req: FastifyRequest, jobIds: readonly string[], onlyFailed = false): Promise<void> {
  if (jobIds.length === 0) return
  try {
    const scoped = supabase.from("jobs").delete().in("id", [...jobIds]).eq("user_id", req.userId)
    const { error } = await (onlyFailed ? scoped.eq("status", "failed") : scoped)
    if (error) req.log.warn({ err: error, jobIds }, "[job-batch] failed to remove the jobs of an undone batch")
  } catch (err) {
    req.log.warn({ err, jobIds }, "[job-batch] failed to remove the jobs of an undone batch")
  }
}

// ───────────────────────────────────────── a bulk add the queue refused

/**
 * What a job of a batch the queue refused says (`jobs.error_message`) — the
 * words `UNQUEUED_JOB_MESSAGE` (lib/enqueue-route-job.ts) gives every other
 * job the queue refused; a test holds the two equal. Kept here, not imported:
 * that module builds the queue at import.
 */
export const REFUSED_BATCH_JOB_MESSAGE = "The job could not be queued to start. Run it again."

/** The app reports filed when a refused batch job's failure or refund cannot be confirmed: the kinds `enqueue-route-job.ts` files for a single job (a test holds them equal). */
export const REFUSED_BATCH_REFUND_UNCONFIRMED_KIND = "unqueued-job-refund-unconfirmed"
export const REFUSED_BATCH_FAILURE_UNCONFIRMED_KIND = "unqueued-job-failure-unconfirmed"

/** The failure write: from `pending` only, its key released in the same statement. */
const REFUSED_FAILURE: MarkJobFailedInput = {
  error_message: REFUSED_BATCH_JOB_MESSAGE,
  from: ["pending"],
  extra: { idempotency_key: null },
}

/** Whether the row reads as this failure: true, false, or null when the read fails. Never throws. */
async function readsAsRefusedFailure(jobId: string): Promise<boolean | null> {
  try {
    // trash-read: the request that wrote this job's failure reads it back to learn whether it landed; nothing is shown to anyone.
    const { data, error } = await supabase.from("jobs").select("status, error_message").eq("id", jobId).maybeSingle()
    if (error) return null
    const row = data as { status?: unknown; error_message?: unknown } | null
    return row?.status === "failed" && row.error_message === REFUSED_BATCH_JOB_MESSAGE
  } catch {
    return null
  }
}

/**
 * Fail one job of a refused batch: the write, written again once when it
 * errors, and read back when that second write misses (the first may have
 * landed with only its answer lost). "error" leaves the row in an unknown
 * state. Never throws.
 */
async function failRefusedJob(jobId: string): Promise<JobFailureOutcome> {
  const first = await markJobFailedDetailed(jobId, REFUSED_FAILURE)
  if (first !== "error") return first
  const second = await markJobFailedDetailed(jobId, REFUSED_FAILURE)
  if (second !== "missed") return second
  const landed = await readsAsRefusedFailure(jobId)
  return landed === null ? "error" : landed ? "flipped" : "missed"
}

/** File the report an operator needs for a refused batch job no sweep will revisit. Never throws. */
async function reportRefusedJob(req: FastifyRequest, jobId: string, kind: string, title: string, message: string): Promise<void> {
  req.log.error({ jobId }, `[job-batch] ${title}`)
  await insertAppReport({
    node: "job-batch",
    kind,
    severity: "error",
    title: `${title}: job ${jobId}`,
    payload: { message },
    userId: req.userId ?? null,
    jobId,
  })
}

/** What became of the jobs a refused bulk add settled. */
export interface RefusedBatchSettlement {
  /** No longer `pending` when the failure was written: a worker took them (or their owner cancelled them). Left alone. */
  readonly started: readonly string[]
  /** Failed by this request, or whose failure could not be confirmed. */
  readonly failed: readonly string[]
}

/**
 * Settle the jobs this request owns after the queue refused their bulk add.
 * The add may have been delivered with only its answer lost, and a worker may
 * have claimed a job since, so a job is undone only once it is failed FROM
 * `pending` (its key released in the same write); the queue entry of a job
 * failed here is then discarded at pickup. In that order:
 *
 *   1. fail each job from `pending` (`markJobFailedDetailed`);
 *   2. refund each one this wrote, CONFIRMED, and remove those rows;
 *   3. leave a job that is no longer `pending` alone: it is `started`.
 *
 * A failed job whose refund is not confirmed is kept (deleting it would strand
 * its hold) and reported, as is a job whose failure cannot be confirmed (it
 * may still be `pending`, for the never-started sweep, or failed with its hold
 * reserved): no sweep revisits a failed row. Never throws.
 */
export async function settleRefusedBatch(req: FastifyRequest, owned: readonly UndoableJob[]): Promise<RefusedBatchSettlement> {
  const started: string[] = []
  const failed: string[] = []
  const removable: string[] = []
  for (const job of owned.filter((j) => !j.paidByOther)) {
    const outcome = await failRefusedJob(job.jobId)
    if (outcome === "missed") {
      started.push(job.jobId)
      continue
    }
    failed.push(job.jobId)
    if (outcome === "error") {
      await reportRefusedJob(
        req, job.jobId, REFUSED_BATCH_FAILURE_UNCONFIRMED_KIND, "a batch job the queue refused could not be confirmed failed",
        "The failure write errored and its outcome is unknown. If the job is pending, the never-started sweep fails and refunds it; " +
          "if it is failed, no sweep revisits it: check its usage logs for a hold still reserved.",
      )
    } else if (await refundJobHoldsConfirmed(job.jobId)) {
      removable.push(job.jobId)
    } else {
      await reportRefusedJob(
        req, job.jobId, REFUSED_BATCH_REFUND_UNCONFIRMED_KIND, "refund not confirmed for a batch job the queue refused",
        "The job is failed and kept, and no sweep revisits it: check its usage logs for a hold still reserved.",
      )
    }
  }
  // A failed row stays failed (only `pending` / `queued` rows are picked up), so this removes exactly the ones failed above.
  await removeJobs(req, removable, true)
  return { started, failed }
}
