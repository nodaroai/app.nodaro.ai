/**
 * Motion Transfer Route
 *
 * Applies motion from a source video to a character from a source image.
 * Uses Kling 2.6 Motion Control model via KIE.ai.
 *
 * Input:
 * - imageUrl: Character reference image
 * - videoUrl: Motion source video
 * - prompt: Optional text prompt (max 2500 chars)
 * - characterOrientation: "image" (max 10s) or "video" (max 30s)
 * - resolution: "720p" or "1080p"
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const motionTransferBody = z.object({
  imageUrl: z.string().url(),
  videoUrl: z.string().url(),
  prompt: z.string().max(2500).optional(),
  characterOrientation: z.enum(["image", "video"]).default("image"),
  resolution: z.enum(["720p", "1080p"]).default("720p"),
})

export async function motionTransferRoutes(app: FastifyInstance) {
  app.post("/v1/motion-transfer", { preHandler: creditGuard(() => "motion-transfer") }, async (req, reply) => {
    const parsed = motionTransferBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, videoUrl, prompt, characterOrientation, resolution } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
        status: "pending",
        input_data: {
          imageUrl,
          videoUrl,
          prompt,
          characterOrientation,
          resolution,
          type: "motion-transfer",
          provider: "kling-2.6/motion-control",  // Actual KIE.ai model used
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "motion-transfer")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("motion-transfer", {
      jobId: job.id,
      imageUrl,
      videoUrl,
      prompt,
      characterOrientation,
      resolution,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
