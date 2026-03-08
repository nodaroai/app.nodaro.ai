import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId } from "../lib/request-helpers.js"
import { TEXT_TO_AUDIO_PROVIDERS } from "../../../packages/shared/src/model-constants.js"

const textToAudioBody = z.object({
  prompt: z.string().min(1).max(2000),
  provider: z.enum(TEXT_TO_AUDIO_PROVIDERS).optional(),
  duration: z.number().min(0.5).max(30).optional(),
  loop: z.boolean().optional(),
  promptInfluence: z.number().min(0).max(1).optional(),
  userId: z.string().uuid().optional(),
})

export async function textToAudioRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-audio", { preHandler: creditGuard((req) => { const body = req.body as Record<string, unknown>; return (body?.provider as string) ?? "tangoflux" }) }, async (req, reply) => {
    const parsed = textToAudioBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { prompt, provider, duration, loop, promptInfluence } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Determine model identifier for credit check (default to tangoflux)
    const modelIdentifier = provider ?? "tangoflux"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        user_id: userId,
        status: "pending",
        input_data: { prompt, provider, duration, loop, promptInfluence, type: "text-to-audio" },
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

    await videoQueue.add("text-to-audio", {
      jobId: job.id,
      prompt,
      provider,
      duration,
      loop,
      promptInfluence,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
