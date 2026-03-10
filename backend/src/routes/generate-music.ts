import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { MUSIC_PROVIDERS } from "../../../packages/shared/src/model-constants.js"

const generateMusicBody = z.object({
  prompt: z.string().min(1).max(2000),
  provider: z.enum(MUSIC_PROVIDERS).optional().default("musicgen"),
  duration: z.number().min(1).max(30).optional(),
  genre: z.string().optional(),
  mood: z.string().optional(),
  instrumental: z.boolean().optional(),
  lyrics: z.string().max(2000).optional(),
  referenceAudioUrl: safeUrlSchema.optional(),
  modelVersion: z.string().optional(),
  userId: z.string().uuid().optional(),
})

export async function generateMusicRoutes(app: FastifyInstance) {
  app.post("/v1/generate-music", { preHandler: creditGuard((req) => { const body = req.body as Record<string, unknown>; return (body?.provider as string) ?? "musicgen" }) }, async (req, reply) => {
    const parsed = generateMusicBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { prompt, provider, duration, genre, mood, instrumental, lyrics, referenceAudioUrl, modelVersion } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Determine model identifier for credit check (default to musicgen)
    const modelIdentifier = provider ?? "musicgen"

    // Build enriched prompt with genre/mood if provided
    const parts = [prompt]
    if (genre) parts.push(genre)
    if (mood) parts.push(mood)
    if (instrumental) parts.push("instrumental, no vocals")
    const enrichedPrompt = parts.join(", ")

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
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

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

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
