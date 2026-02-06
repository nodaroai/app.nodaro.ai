import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const adjustVolumeBody = z.object({
  audioUrl: z.string().url(),
  volume: z.number().min(0).max(200).optional().default(100),
  normalize: z.boolean().optional().default(false),
  fadeIn: z.number().min(0).max(10).optional().default(0),
  fadeOut: z.number().min(0).max(10).optional().default(0),
  userId: z.string().uuid().optional(),
})

export async function adjustVolumeRoutes(app: FastifyInstance) {
  app.post("/v1/adjust-volume", { preHandler: creditGuard(() => "ffmpeg") }, async (req, reply) => {
    const parsed = adjustVolumeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request" },
      })
    }

    const { userId, ...restData } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    // Model identifier for credit check (FFmpeg processing = 0 credits)
    const modelIdentifier = "ffmpeg"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
        status: "pending",
        input_data: { ...restData, type: "adjust-volume" },
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

    await videoQueue.add("adjust-volume", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
