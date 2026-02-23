import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const forcedAlignmentBody = z.object({
  audioUrl: safeUrlSchema,
  transcript: z.string().min(1).max(50000),
  userId: z.string().uuid().optional(),
})

export async function forcedAlignmentRoutes(app: FastifyInstance) {
  app.post("/v1/forced-alignment", {
    preHandler: creditGuard(() => "elevenlabs-forced-alignment"),
  }, async (req, reply) => {
    const parsed = forcedAlignmentBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { audioUrl, transcript, userId } = parsed.data

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
        input_data: { audioUrl, transcript, type: "forced-alignment" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "elevenlabs-forced-alignment")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("forced-alignment", {
      jobId: job.id,
      audioUrl,
      transcript,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
