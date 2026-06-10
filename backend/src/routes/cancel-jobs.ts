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
          .from("jobs") // tenant-scope-ignore: ownership verified post-fetch (job.user_id !== userId → 403 below)
          .select("id, status, user_id, input_data, output_data, provider_task_id, reconcile_attempts")
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

        // In flight: the external provider call already went out and a live
        // worker is polling it. We can't kill it — let it finish (the user
        // keeps the result they paid for). Report `inFlight` so the UI shows
        // a graceful "Stopping…" rather than pretending it was cancelled.
        //
        // EXCEPTION (audit D2): a row the reconcile system has already touched
        // (`reconcile_attempts > 0`) was abandoned by its worker — the user is
        // staring at a stuck progress bar with no kill path, possibly for the
        // full exhaustion budget (~90+ min). Cancelling converts the wait into
        // an immediate refund; the provider cost is sunk either way (the same
        // trade reconcile exhaustion makes). The CAS below + reserved-only
        // refund keep the race with a concurrent cron completion safe in both
        // directions: cron wins → CAS flips 0 rows, no refund; cancel wins →
        // the cron's claim RPC + finalize + markJobCompleted all refuse
        // cancelled rows.
        const inRecovery = ((job.reconcile_attempts as number | null) ?? 0) > 0
        if (job.provider_task_id && !inRecovery) {
          return { success: true, cancelled: 0, inFlight: true }
        }

        // Truly cancel. Remove from the queue (if still waiting), CAS-flip to
        // cancelled (only live rows — a concurrent completion between our read
        // and this write must NOT be trampled into `cancelled` after its
        // credits committed), and refund ONLY when we actually flipped the row.
        await tryRemoveFromQueue(jobId)

        const { data: cancelledRows, error: updateError } = await supabase
          .from("jobs")
          .update({ status: "cancelled" })
          .eq("id", jobId)
          .in("status", ["pending", "queued", "processing"])
          .select("id")

        if (updateError) {
          return reply.status(500).send({
            error: { code: "internal_error", message: updateError.message },
          })
        }

        if (!cancelledRows || cancelledRows.length === 0) {
          // Lost the race to a terminal writer (completed/failed/cancelled).
          // The job's own lifecycle handled credits — nothing to refund here.
          return { success: true, cancelled: 0, inFlight: false }
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
      // Get all cancellable jobs for this user: not yet at the external
      // provider (provider_task_id IS NULL), OR abandoned to the reconcile
      // system (reconcile_attempts > 0 — audit D2, same rule as single
      // cancel). Live in-flight jobs can't be killed — they run to
      // completion — so we leave them alone.
      const { data: jobs, error: fetchError } = await supabase
        .from("jobs")
        .select("id")
        .eq("user_id", userId)
        .in("status", ["pending", "queued", "processing"])
        .or("provider_task_id.is.null,reconcile_attempts.gt.0")

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

      // CAS-update to cancelled (live rows only) and refund ONLY the rows we
      // actually flipped — a job that completed between the SELECT and this
      // UPDATE keeps its committed credits.
      const { data: cancelledRows, error: updateError } = await supabase
        .from("jobs")
        .update({ status: "cancelled" })
        .in("id", jobIds)
        .in("status", ["pending", "queued", "processing"])
        .select("id")

      if (updateError) {
        return reply.status(500).send({
          error: { code: "internal_error", message: updateError.message },
        })
      }

      const cancelledIds = (cancelledRows ?? []).map((r) => r.id as string)
      if (cancelledIds.length > 0) {
        // Refund reserved credits for every cancelled job in one pass.
        await refundReservedCreditsForJobs(cancelledIds)
        invalidateBalanceCache(userId)
      }

      return { success: true, cancelled: cancelledIds.length }
    } catch (err) {
      console.error("[cancel-all] Error:", err)
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to cancel jobs" },
      })
    }
  })
}
