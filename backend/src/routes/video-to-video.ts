import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { VIDEO_TO_VIDEO_PROVIDERS } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

const videoToVideoBody = z.object({
  videoUrl: safeUrlSchema,
  prompt: z.string().max(5000).optional(),
  userPrompt: z.string().max(8000).optional(),
  provider: z.enum(VIDEO_TO_VIDEO_PROVIDERS).optional(),
  // Wan / Wan Flash params
  duration: z.enum(["5", "10"]).optional(),
  resolution: z.enum(["720p", "1080p"]).optional(),
  // Wan Flash only
  audio: z.boolean().optional(),
  multiShots: z.boolean().optional(),
  // Runway Aleph params
  aspectRatio: z.enum(["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"]).optional(),
  seed: z.number().int().min(0).optional(),
  referenceImageUrl: safeUrlSchema.optional(),
})

export async function videoToVideoRoutes(app: FastifyInstance) {
  app.post("/v1/video-to-video", { preHandler: creditGuard((req) => { const body = req.body as Record<string, unknown>; return (body?.provider as string) ?? "wan" }) }, async (req, reply) => {
    const parsed = videoToVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { videoUrl, prompt, provider, duration, resolution, audio, multiShots, aspectRatio, seed, referenceImageUrl } = parsed.data
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
        input_data: buildJobInputData(parsed.data, "video-to-video"),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const modelIdentifier = provider ?? "wan"
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("video-to-video", {
      jobId: job.id,
      videoUrl,
      prompt,
      provider: modelIdentifier,
      duration,
      resolution,
      audio,
      multiShots,
      aspectRatio,
      seed,
      referenceImageUrl,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
