import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"

const voiceChangerBody = z.object({
  audioUrl: safeUrlSchema,
  voiceId: z.string().min(1),
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
  removeBackgroundNoise: z.boolean().optional(),
  userId: z.string().uuid().optional(),
})

export async function voiceChangerRoutes(app: FastifyInstance) {
  app.post("/v1/voice-changer", {
    preHandler: creditGuard(() => "elevenlabs-voice-changer"),
  }, async (req, reply) => {
    const parsed = voiceChangerBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { audioUrl, voiceId, stability, similarityBoost, removeBackgroundNoise } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { audioUrl, voiceId, type: "voice-changer" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "elevenlabs-voice-changer")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("voice-changer", {
      jobId: job.id,
      audioUrl,
      voiceId,
      stability,
      similarityBoost,
      removeBackgroundNoise,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
