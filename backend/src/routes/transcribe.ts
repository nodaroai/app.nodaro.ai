import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const transcribeBody = z.object({
  audioUrl: z.string().url(),
  provider: z.enum(["whisper", "incredibly-fast-whisper"]).optional(),
  language: z.string().max(10).optional(),
  userId: z.string().uuid().optional(),
})

export async function transcribeRoutes(app: FastifyInstance) {
  app.post("/v1/transcribe", {
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown>
      return (body?.provider as string) ?? "whisper"
    }),
  }, async (req, reply) => {
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

    // Determine model identifier for credit reservation
    const modelIdentifier = provider ?? "whisper"

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

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

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
