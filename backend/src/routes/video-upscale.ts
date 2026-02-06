/**
 * Video Upscale Route
 *
 * Upscales a video using Topaz Video Upscaler via KIE.ai.
 *
 * Input:
 * - videoUrl: Source video to upscale (max 50MB)
 * - upscaleFactor: "1", "2", or "4"
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const videoUpscaleBody = z.object({
  videoUrl: z.string().url(),
  upscaleFactor: z.enum(["1", "2", "4"]).default("2"),
  userId: z.string().uuid().optional(),
})

export async function videoUpscaleRoutes(app: FastifyInstance) {
  app.post("/v1/video-upscale", async (req, reply) => {
    const parsed = videoUpscaleBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { videoUrl, upscaleFactor, userId } = parsed.data

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
        input_data: {
          videoUrl,
          upscaleFactor,
          type: "video-upscale",
          provider: "topaz/video-upscale",  // Actual KIE.ai model used
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("video-upscale", {
      jobId: job.id,
      videoUrl,
      upscaleFactor,
    })

    return { jobId: job.id }
  })
}
