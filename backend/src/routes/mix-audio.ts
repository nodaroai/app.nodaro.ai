import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId } from "../lib/request-helpers.js"

const mixAudioBody = z.object({
  audioUrls: z.array(safeUrlSchema).min(2),
  trackVolumes: z.array(z.number().min(0).max(200)).optional(),
  userId: z.string().uuid().optional(),
})

export async function mixAudioRoutes(app: FastifyInstance) {
  app.post("/v1/mix-audio", { preHandler: creditGuard(() => "ffmpeg") }, async (req, reply) => {
    const parsed = mixAudioBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request" },
      })
    }

    const { userId: _bodyUserId, ...restData } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Model identifier for credit check (FFmpeg processing = 0 credits)
    const modelIdentifier = "ffmpeg"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        user_id: userId,
        status: "pending",
        input_data: { ...restData, type: "mix-audio" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("mix-audio", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
