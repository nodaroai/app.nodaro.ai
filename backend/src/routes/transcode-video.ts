import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const transcodeVideoBody = z.object({
  videoUrl: safeUrlSchema,
  codec: z.enum(["h264", "h265"]).optional(),
  crf: z.number().int().min(0).max(51).optional(),
  resolution: z.enum(["original", "1080p", "720p", "480p"]).optional(),
  audioBitrate: z.enum(["128k", "192k", "256k", "320k"]).optional(),
  userId: z.string().uuid().optional(),
})

export async function transcodeVideoRoutes(app: FastifyInstance) {
  app.post("/v1/transcode-video", { preHandler: creditGuard(() => "ffmpeg") }, async (req, reply) => {
    const parsed = transcodeVideoBody.safeParse(req.body)
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

    const modelIdentifier = "ffmpeg"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
        status: "pending",
        input_data: { ...restData, type: "transcode-video" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("transcode-video", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
