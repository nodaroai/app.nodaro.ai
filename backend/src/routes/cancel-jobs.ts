import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { sendInternalError } from "../lib/http-errors.js"
import { tryRemoveFromQueue } from "../lib/queue.js"
import { cancelOwnedJob, refundReservedHolds } from "../lib/cancel-job.js"
import { IN_FLIGHT_JOB_STATUSES, isParkedJobStatus } from "../lib/job-status.js"
import { invalidateBalanceCache } from "../ee/routes/credits.js"

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

      if (!z.string().uuid().safeParse(jobId).success) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "Invalid job id" },
        })
      }

      try {
        const result = await cancelOwnedJob(jobId, userId)
        switch (result.kind) {
          case "not_found":
            return reply.status(404).send({ error: { code: "not_found", message: "Job not found" } })
          case "forbidden":
            return reply.status(403).send({ error: { code: "forbidden", message: "You do not own this job" } })
          case "invalid_status":
            return reply.status(400).send({
              error: { code: "invalid_status", message: `Job cannot be cancelled (status: ${result.status})` },
            })
          case "in_flight":
            // The provider call already went out and a live worker is polling
            // it — let it finish (the user keeps the result they paid for) and
            // report `inFlight` so the UI shows "Stopping…" honestly.
            return { success: true, cancelled: 0, inFlight: true }
          case "lost_race":
            // A terminal writer beat us; its lifecycle handled the credits.
            return { success: true, cancelled: 0, inFlight: false }
          case "cancelled":
            break
        }

        // A parent that spawned an analysis child (POST /v1/llm/structured/jobs
        // with videoUrl) takes a STILL-RUNNING child with it: the child's row
        // and reservation are the user's too, and nobody will draft from an
        // analysis whose draft was cancelled. A finished child is left alone
        // (anything but "cancelled" here is fine — Draft again reuses it), and
        // a child already out at the provider is left to finish, like any
        // in-flight job.
        if (result.analysisJobId) {
          await cancelOwnedJob(result.analysisJobId, userId).catch((err) =>
            console.error(`[cancel-job] child ${result.analysisJobId} of ${jobId}:`, err),
          )
        }

        invalidateBalanceCache(userId)
        return { success: true, cancelled: 1, inFlight: false }
      } catch (err) {
        console.error("[cancel-job] Error:", err)
        return sendInternalError(reply, req, err, "Failed to cancel job")
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
      // cancel), OR parked in review. Live in-flight jobs can't be killed —
      // they run to completion — so we leave them alone.
      //
      // A held job fails BOTH halves of the old predicate (it is
      // `pending_review`, and it has a provider task because the provider
      // already delivered), so "Cancel all" used to skip it in silence and
      // strand its reservation (spec D18).
      const { data: jobs, error: fetchError } = await supabase
        .from("jobs")
        .select("id, status")
        .eq("user_id", userId)
        .in("status", [...IN_FLIGHT_JOB_STATUSES])
        .or("provider_task_id.is.null,reconcile_attempts.gt.0,status.eq.pending_review")

      if (fetchError) {
        return sendInternalError(reply, req, fetchError, "Failed to fetch jobs")
      }

      if (!jobs || jobs.length === 0) {
        return { success: true, cancelled: 0 }
      }

      // Held rows cannot go through the bulk path: each needs its own refund,
      // its own withheld-object deletion and its own audit row. Delegate them
      // to the single-job helper — bounded, because a user has 0-2 held rows.
      const heldIds = jobs.filter((j) => isParkedJobStatus(j.status as string)).map((j) => j.id as string)
      const jobIds = jobs.filter((j) => !isParkedJobStatus(j.status as string)).map((j) => j.id as string)

      let heldCancelled = 0
      for (const heldId of heldIds) {
        const result = await cancelOwnedJob(heldId, userId).catch((err) => {
          console.error(`[cancel-all] held job ${heldId}:`, err)
          return { kind: "lost_race" as const }
        })
        if (result.kind === "cancelled") heldCancelled++
      }

      if (jobIds.length === 0) {
        if (heldCancelled > 0) invalidateBalanceCache(userId)
        return { success: true, cancelled: heldCancelled }
      }

      // Try to remove each job from BullMQ queue. Held jobs are deliberately
      // absent: their BullMQ entry is long gone by the time a result is held.
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
        return sendInternalError(reply, req, updateError, "Failed to cancel jobs")
      }

      const cancelledIds = (cancelledRows ?? []).map((r) => r.id as string)
      if (cancelledIds.length > 0) {
        // Refund reserved credits for every cancelled job in one pass.
        await refundReservedHolds(cancelledIds)
      }
      if (cancelledIds.length > 0 || heldCancelled > 0) invalidateBalanceCache(userId)

      return { success: true, cancelled: cancelledIds.length + heldCancelled }
    } catch (err) {
      console.error("[cancel-all] Error:", err)
      return sendInternalError(reply, req, err, "Failed to cancel jobs")
    }
  })
}
