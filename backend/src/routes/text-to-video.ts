import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const textToVideoBody = z.object({
  prompt: z.string().min(1).max(2000),
  provider: z.enum([
    // Available on both Replicate and KIE
    "veo3", "kling", "minimax",
    // Replicate-only
    "veo", "runway", "pika", "sora",
    // KIE-only
    "kling-turbo", "grok", "sora2-pro"
  ]).optional(),
  userId: z.string().uuid().optional(),
})

export async function textToVideoRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-video", { preHandler: creditGuard((req) => { const body = req.body as Record<string, unknown>; return (body?.provider as string) ?? "minimax" }) }, async (req, reply) => {
    const parsed = textToVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { prompt, provider, userId } = parsed.data

    // Determine model identifier for credit check (default to minimax)
    const modelIdentifier = provider ?? "minimax"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId ?? null,
        status: "pending",
        input_data: { prompt, provider, type: "text-to-video" },
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

    await videoQueue.add("text-to-video", {
      jobId: job.id,
      prompt,
      provider,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
