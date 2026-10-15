/**
 * The credit holds of a batch's jobs: who pays for a job, and undoing what a
 * request paid for. Kept beside `job-batch.ts`, which runs the steps.
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
  if (removable.length === 0) return
  try {
    const { error } = await supabase.from("jobs").delete().in("id", removable).eq("user_id", req.userId)
    if (error) req.log.warn({ err: error, jobIds: removable }, "[job-batch] failed to remove the jobs of an undone batch")
  } catch (err) {
    req.log.warn({ err, jobIds: removable }, "[job-batch] failed to remove the jobs of an undone batch")
  }
}
