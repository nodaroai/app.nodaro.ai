import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId } from "../lib/request-helpers.js"

const mergeVideoAudioBody = z.object({
  videoUrl: safeUrlSchema,
  audioUrl: safeUrlSchema.optional(),
  audioTracks: z.array(z.object({
    url: safeUrlSchema,
    startTime: z.number().min(0).default(0),
    volume: z.number().min(0).max(200).optional(),
    sourceType: z.enum(["audio", "video"]).optional(),
  })).optional(),
  voiceoverVolume: z.number().min(0).max(200).optional().default(100),
  backgroundVolume: z.number().min(0).max(200).optional().default(30),
  keepOriginalAudio: z.boolean().optional().default(true),
  userId: z.string().uuid().optional(),
}).refine((data) => data.audioUrl || (data.audioTracks && data.audioTracks.length > 0), {
  message: "Either audioUrl or audioTracks is required",
})

export async function mergeVideoAudioRoutes(app: FastifyInstance) {
  app.post("/v1/merge-video-audio", { preHandler: creditGuard(() => "ffmpeg") }, async (req, reply) => {
    const parsed = mergeVideoAudioBody.safeParse(req.body)
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
        input_data: { ...restData, type: "merge-video-audio" },
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

    await videoQueue.add("merge-video-audio", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
