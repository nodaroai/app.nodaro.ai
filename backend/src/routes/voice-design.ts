import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { VOICE_DESIGN_MODELS } from "../../../packages/shared/src/model-constants.js"

const voiceDesignBody = z.object({
  text: z.string().min(100).max(1000),
  userPrompt: z.string().max(8000).optional(),
  voiceDescription: z.string().min(1).max(1000),
  model: z.enum(VOICE_DESIGN_MODELS).optional(),
  loudness: z.number().min(-1).max(1).optional(),
  guidanceScale: z.number().min(0).max(100).optional(),
  seed: z.number().int().optional(),
  quality: z.number().optional(),
  shouldEnhance: z.boolean().optional(),
  userId: z.string().uuid().optional(),
})

export async function voiceDesignRoutes(app: FastifyInstance) {
  app.post("/v1/voice-design", {
    preHandler: creditGuard(() => "elevenlabs-voice-design"),
  }, async (req, reply) => {
    const parsed = voiceDesignBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { text, voiceDescription, model, loudness, guidanceScale, seed, quality, shouldEnhance } = parsed.data
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
        input_data: buildJobInputData(parsed.data, "voice-design"),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "elevenlabs-voice-design")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("voice-design", {
      jobId: job.id,
      text,
      voiceDescription,
      model,
      loudness,
      guidanceScale,
      seed,
      quality,
      shouldEnhance,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
