import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const textToSpeechBody = z.object({
  text: z.string().min(1).max(5000),
  voice: z.string().optional(),
  provider: z.enum(["elevenlabs-turbo", "elevenlabs-multilingual", "elevenlabs"]).optional(),
  userId: z.string().uuid().optional(),
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
  speed: z.number().min(0.7).max(1.2).optional(),
  languageCode: z.string().optional(),
})

export async function textToSpeechRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-speech", {
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown>
      const provider = (body?.provider as string) ?? "elevenlabs-turbo"
      // Map legacy "elevenlabs" to "elevenlabs-turbo" for credit lookup
      return provider === "elevenlabs" ? "elevenlabs-turbo" : provider
    }),
  }, async (req, reply) => {
    const parsed = textToSpeechBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { text, voice, provider, userId, stability, similarityBoost, style, speed, languageCode } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    // Map legacy "elevenlabs" to "elevenlabs-turbo" for credit check
    const resolvedProvider = provider === "elevenlabs" ? "elevenlabs-turbo" : (provider ?? "elevenlabs-turbo")
    const modelIdentifier = resolvedProvider

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
        status: "pending",
        input_data: {
          text, voice, provider: resolvedProvider,
          type: "text-to-speech",
          stability, similarityBoost, style, speed, languageCode,
        },
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

    await videoQueue.add("text-to-speech", {
      jobId: job.id,
      text,
      voice,
      provider: resolvedProvider,
      usageLogId,
      stability,
      similarityBoost,
      style,
      speed,
      languageCode,
    })

    return { jobId: job.id }
  })
}
