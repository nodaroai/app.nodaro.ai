import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { config } from "../lib/config.js"
import { CreditsService } from "../services/credits.js"

const adjustVolumeBody = z.object({
  audioUrl: z.string().url(),
  volume: z.number().min(0).max(200).optional().default(100),
  normalize: z.boolean().optional().default(false),
  fadeIn: z.number().min(0).max(10).optional().default(0),
  fadeOut: z.number().min(0).max(10).optional().default(0),
  userId: z.string().uuid().optional(),
})

export async function adjustVolumeRoutes(app: FastifyInstance) {
  app.post("/v1/adjust-volume", async (req, reply) => {
    const parsed = adjustVolumeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request" },
      })
    }

    const { userId, ...restData } = parsed.data

    // Model identifier for credit check (FFmpeg processing = 0 credits)
    const modelIdentifier = "ffmpeg"

    // Credit check for cloud edition only
    if (config.EDITION !== "self-hosted" && userId) {
      try {
        const creditCheck = await CreditsService.checkCredits(userId, modelIdentifier)

        if (!creditCheck.allowed) {
          return reply.status(402).send({
            error: {
              code: "insufficient_credits",
              message: creditCheck.error ?? "Insufficient credits",
            },
            required: creditCheck.required,
            balance: creditCheck.balance,
          })
        }
      } catch (err) {
        console.error("[adjust-volume] Credit check failed:", err)
        return reply.status(500).send({
          error: { code: "credit_check_failed", message: "Failed to check credits" },
        })
      }
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId ?? null,
        status: "pending",
        input_data: { ...restData, type: "adjust-volume" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    // Reserve credits for cloud edition
    let usageLogId: string | undefined
    if (config.EDITION !== "self-hosted" && userId) {
      try {
        const reservation = await CreditsService.reserveCredits(
          userId,
          job.id,
          modelIdentifier,
          0, // provider cost calculated in worker
          0  // display cost calculated in worker
        )
        usageLogId = reservation.usageLogId

        // Store usageLogId in dedicated column for worker to access
        await supabase
          .from("jobs")
          .update({ usage_log_id: usageLogId })
          .eq("id", job.id)
      } catch (err) {
        console.error("[adjust-volume] Credit reservation failed:", err)
        // Delete the job if reservation fails
        await supabase.from("jobs").delete().eq("id", job.id)
        return reply.status(500).send({
          error: { code: "credit_reservation_failed", message: "Failed to reserve credits" },
        })
      }
    }

    await videoQueue.add("adjust-volume", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
