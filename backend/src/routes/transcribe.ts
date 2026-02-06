import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { config } from "../lib/config.js"
import { CreditsService } from "../services/credits.js"

const transcribeBody = z.object({
  audioUrl: z.string().url(),
  provider: z.enum(["whisper", "incredibly-fast-whisper"]).optional(),
  language: z.string().max(10).optional(),
  userId: z.string().uuid().optional(),
})

export async function transcribeRoutes(app: FastifyInstance) {
  app.post("/v1/transcribe", async (req, reply) => {
    const parsed = transcribeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { audioUrl, provider, language, userId } = parsed.data

    // Determine model identifier for credit check
    const modelIdentifier = provider ?? "whisper"

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
        console.error("[transcribe] Credit check failed:", err)
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
        input_data: { audioUrl, provider, language, type: "transcribe" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    // Reserve credits for cloud edition
    let usageLogId: string | undefined
    if (config.EDITION !== "self-hosted" && userId) {
      try {
        const reservation = await CreditsService.reserveCredits(
          userId,
          job.id,
          modelIdentifier,
          0,
          0
        )
        usageLogId = reservation.usageLogId

        await supabase
          .from("jobs")
          .update({ usage_log_id: usageLogId })
          .eq("id", job.id)
      } catch (err) {
        console.error("[transcribe] Credit reservation failed:", err)
        await supabase.from("jobs").delete().eq("id", job.id)
        return reply.status(500).send({
          error: { code: "credit_reservation_failed", message: "Failed to reserve credits" },
        })
      }
    }

    await videoQueue.add("transcribe", {
      jobId: job.id,
      audioUrl,
      provider,
      language,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
