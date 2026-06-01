import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { tryRemoveFromQueue } from "../lib/queue.js"
import { CreditsService } from "../ee/billing/credits.js"
import { invalidateBalanceCache } from "../ee/routes/credits.js"

/**
 * Refund any reserved credit holds for the given job IDs. Best-effort —
 * `CreditsService.refundCredits` already short-circuits on rows that aren't
 * `status='reserved'` (see PR #1502), so it's safe if the worker happens to
 * commit/refund the same row concurrently.
 *
 * Without this, cancelling a job leaves its `usage_logs` row stuck at
 * `status='reserved'` forever — the user's balance was decremented when the
 * job was reserved but never restored. Net effect: silent credit theft on
 * every cancellation.
 */
async function refundReservedCreditsForJobs(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return
  const { data: usageLogs } = await supabase
    .from("usage_logs")
    .select("id")
    .in("job_id", jobIds)
    .eq("status", "reserved")

  if (!usageLogs || usageLogs.length === 0) return

  await Promise.all(
    usageLogs.map((row) =>
      CreditsService.refundCredits(row.id).catch((err) =>
        console.error(`[cancel-job] Failed to refund usage_log ${row.id}:`, err),
      ),
    ),
  )
}

export async function cancelJobsRoutes(app: FastifyInstance) {
  // Cancel a single job
  app.post<{ Params: { jobId: string } }>(
    "/v1/jobs/:jobId/cancel",
    async (req, reply) => {
      const { jobId } = req.params
      const userId = req.userId

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      try {
        // Get the job to verify ownership and current status. `provider_task_id`
        // is set once we've submitted to the external provider — past that point
        // the job can't be killed (no provider cancel API), it runs to completion.
        const { data: job, error: fetchError } = await supabase
          .from("jobs")
          .select("id, status, user_id, input_data, output_data, provider_task_id")
          .eq("id", jobId)
          .single()

        if (fetchError || !job) {
          return reply.status(404).send({
            error: { code: "not_found", message: "Job not found" },
          })
        }

        // Verify ownership
        if (job.user_id !== userId) {
          return reply.status(403).send({
            error: { code: "forbidden", message: "You do not own this job" },
          })
        }

        // Already terminal — nothing to do.
        const cancellableStatuses = ["pending", "queued", "processing"]
        if (!cancellableStatuses.includes(job.status)) {
          return reply.status(400).send({
            error: {
              code: "invalid_status",
              message: `Job cannot be cancelled (status: ${job.status})`,
            },
          })
        }

        // In flight: the external provider call already went out. We can't kill
        // it — let it finish (the user keeps the result they paid for). Report
        // `inFlight` so the UI shows a graceful "Stopping…" rather than pretending
        // it was cancelled. No status change, no refund.
        if (job.provider_task_id) {
          return { success: true, cancelled: 0, inFlight: true }
        }

        // Pre-call: truly cancel. Remove from the queue (if still waiting), flip
        // to cancelled (the worker's pre-call guard aborts before createTask if
        // it had already been picked up), and refund the reserved credits.
        await tryRemoveFromQueue(jobId)

        const { error: updateError } = await supabase
          .from("jobs")
          .update({ status: "cancelled" })
          .eq("id", jobId)

        if (updateError) {
          return reply.status(500).send({
            error: { code: "internal_error", message: updateError.message },
          })
        }

        await refundReservedCreditsForJobs([jobId])
        invalidateBalanceCache(userId)

        return { success: true, cancelled: 1, inFlight: false }
      } catch (err) {
        console.error("[cancel-job] Error:", err)
        return reply.status(500).send({
          error: { code: "internal_error", message: "Failed to cancel job" },
        })
      }
    }
  )

  // Cancel all pending/processing jobs for a user
  app.post("/v1/jobs/cancel-all", async (req, reply) => {
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    try {
      // Get all cancellable jobs for this user that have NOT yet hit the
      // external provider (provider_task_id IS NULL). In-flight jobs can't be
      // killed — they run to completion — so we leave them alone.
      const { data: jobs, error: fetchError } = await supabase
        .from("jobs")
        .select("id")
        .eq("user_id", userId)
        .in("status", ["pending", "queued", "processing"])
        .is("provider_task_id", null)

      if (fetchError) {
        return reply.status(500).send({
          error: { code: "internal_error", message: fetchError.message },
        })
      }

      if (!jobs || jobs.length === 0) {
        return { success: true, cancelled: 0 }
      }

      const jobIds = jobs.map((j) => j.id)

      // Try to remove each job from BullMQ queue
      for (const jobId of jobIds) {
        await tryRemoveFromQueue(jobId)
      }

      // Update all jobs to cancelled
      const { error: updateError } = await supabase
        .from("jobs")
        .update({ status: "cancelled" })
        .in("id", jobIds)

      if (updateError) {
        return reply.status(500).send({
          error: { code: "internal_error", message: updateError.message },
        })
      }

      // Refund reserved credits for every cancelled job in one pass.
      await refundReservedCreditsForJobs(jobIds)
      invalidateBalanceCache(userId)

      return { success: true, cancelled: jobIds.length }
    } catch (err) {
      console.error("[cancel-all] Error:", err)
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to cancel jobs" },
      })
    }
  })
}
