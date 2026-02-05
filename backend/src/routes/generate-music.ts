import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { config } from "../lib/config.js"
import { CreditsService } from "../services/credits.js"

const generateMusicBody = z.object({
  prompt: z.string().min(1).max(2000),
  provider: z.enum(["musicgen", "minimax", "lyria", "bark"]).optional().default("musicgen"),
  duration: z.number().min(1).max(30).optional(),
  genre: z.string().optional(),
  mood: z.string().optional(),
  instrumental: z.boolean().optional(),
  lyrics: z.string().max(2000).optional(),
  referenceAudioUrl: z.string().url().optional(),
  modelVersion: z.string().optional(),
  userId: z.string().uuid().optional(),
})

export async function generateMusicRoutes(app: FastifyInstance) {
  app.post("/v1/generate-music", async (req, reply) => {
    const parsed = generateMusicBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { prompt, provider, duration, genre, mood, instrumental, lyrics, referenceAudioUrl, modelVersion, userId } = parsed.data

    // Determine model identifier for credit check (default to musicgen)
    const modelIdentifier = provider ?? "musicgen"

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
        console.error("[generate-music] Credit check failed:", err)
        return reply.status(500).send({
          error: { code: "credit_check_failed", message: "Failed to check credits" },
        })
      }
    }

    // Build enriched prompt with genre/mood if provided
    const parts = [prompt]
    if (genre) parts.push(genre)
    if (mood) parts.push(mood)
    if (instrumental) parts.push("instrumental, no vocals")
    const enrichedPrompt = parts.join(", ")

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId ?? null,
        status: "pending",
        input_data: { prompt: enrichedPrompt, provider, duration, lyrics, referenceAudioUrl, modelVersion, type: "generate-music" },
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
        console.error("[generate-music] Credit reservation failed:", err)
        // Delete the job if reservation fails
        await supabase.from("jobs").delete().eq("id", job.id)
        return reply.status(500).send({
          error: { code: "credit_reservation_failed", message: "Failed to reserve credits" },
        })
      }
    }

    await videoQueue.add("generate-music", {
      jobId: job.id,
      prompt: enrichedPrompt,
      provider,
      duration,
      lyrics,
      referenceAudioUrl,
      modelVersion,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
