import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { tryRemoveFromQueue } from "../lib/queue.js"

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
        // Get the job to verify ownership and current status
        const { data: job, error: fetchError } = await supabase
          .from("jobs")
          .select("id, status, user_id, input_data, output_data")
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

        // Check if job can be cancelled
        const cancellableStatuses = ["pending", "queued", "processing"]
        if (!cancellableStatuses.includes(job.status)) {
          return reply.status(400).send({
            error: {
              code: "invalid_status",
              message: `Job cannot be cancelled (status: ${job.status})`,
            },
          })
        }

        // Try to remove from BullMQ queue
        await tryRemoveFromQueue(jobId)

        // Update job status to cancelled
        const { error: updateError } = await supabase
          .from("jobs")
          .update({ status: "cancelled" })
          .eq("id", jobId)

        if (updateError) {
          return reply.status(500).send({
            error: { code: "internal_error", message: updateError.message },
          })
        }

        return { success: true, cancelled: 1 }
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
      // Get all cancellable jobs for this user
      const { data: jobs, error: fetchError } = await supabase
        .from("jobs")
        .select("id")
        .eq("user_id", userId)
        .in("status", ["pending", "queued", "processing"])

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

      return { success: true, cancelled: jobIds.length }
    } catch (err) {
      console.error("[cancel-all] Error:", err)
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to cancel jobs" },
      })
    }
  })
}
