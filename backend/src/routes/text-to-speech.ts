import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const textToSpeechBody = z.object({
  text: z.string().min(1).max(5000),
  voice: z.string().optional(),
  provider: z.enum(["elevenlabs", "playht", "azure"]).optional(),
  userId: z.string().uuid().optional(),
})

export async function textToSpeechRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-speech", { preHandler: creditGuard((req) => { const body = req.body as Record<string, unknown>; return (body?.provider as string) ?? "elevenlabs" }) }, async (req, reply) => {
    const parsed = textToSpeechBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { text, voice, provider, userId } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    // Determine model identifier for credit check (default to elevenlabs)
    const modelIdentifier = provider ?? "elevenlabs"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
        status: "pending",
        input_data: { text, voice, provider, type: "text-to-speech" },
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
      provider,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
