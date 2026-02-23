import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const dubbingBody = z.object({
  audioUrl: safeUrlSchema,
  targetLanguage: z.string().min(2).max(10),
  sourceLanguage: z.string().min(2).max(10).optional(),
  numSpeakers: z.number().int().min(1).max(20).optional(),
  userId: z.string().uuid().optional(),
})

export async function dubbingRoutes(app: FastifyInstance) {
  app.post("/v1/dubbing", {
    preHandler: creditGuard(() => "elevenlabs-dubbing"),
  }, async (req, reply) => {
    const parsed = dubbingBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { audioUrl, targetLanguage, sourceLanguage, numSpeakers, userId } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
        status: "pending",
        input_data: { audioUrl, targetLanguage, sourceLanguage, type: "dubbing" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "elevenlabs-dubbing")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("dubbing", {
      jobId: job.id,
      audioUrl,
      targetLanguage,
      sourceLanguage,
      numSpeakers,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
