/**
 * Motion Transfer Route
 *
 * Applies motion from a source video to a character from a source image.
 * Supports Kling 2.6 and Kling 3.0 Motion Control models via KIE.ai.
 *
 * Input:
 * - imageUrl: Character reference image
 * - videoUrl: Motion source video
 * - prompt: Optional text prompt (max 2500 chars)
 * - characterOrientation: "image" (max 10s) or "video" (max 30s) — Kling 2.6 only
 * - resolution: "720p" or "1080p"
 * - provider: "kling" (2.6) or "kling-3.0"
 * - backgroundSource: "input_video" or "input_image" — Kling 3.0 only
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { MOTION_TRANSFER_PROVIDERS } from "../../../packages/shared/src/model-constants.js"

const motionTransferBody = z.object({
  imageUrl: safeUrlSchema,
  videoUrl: safeUrlSchema,
  prompt: z.string().max(2500).optional(),
  characterOrientation: z.enum(["image", "video"]).default("image"),
  resolution: z.enum(["720p", "1080p"]).default("720p"),
  provider: z.enum(MOTION_TRANSFER_PROVIDERS).default("kling"),
  backgroundSource: z.enum(["input_video", "input_image"]).optional(),
})

/** Build credit model identifier based on provider + resolution. */
function buildMotionCreditId(provider: string, resolution: string): string {
  if (provider === "kling-3.0") {
    return resolution === "1080p" ? "kling-3.0-motion:1080p" : "kling-3.0-motion"
  }
  // Kling 2.6 — original flat credit identifier
  return "motion-transfer"
}

export async function motionTransferRoutes(app: FastifyInstance) {
  app.post("/v1/motion-transfer", {
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown>
      const provider = (body?.provider as string) ?? "kling"
      const resolution = (body?.resolution as string) ?? "720p"
      return buildMotionCreditId(provider, resolution)
    }),
  }, async (req, reply) => {
    const parsed = motionTransferBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, videoUrl, prompt, characterOrientation, resolution, provider, backgroundSource } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = buildMotionCreditId(provider, resolution)

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: {
          imageUrl,
          videoUrl,
          prompt,
          characterOrientation,
          resolution,
          provider,
          backgroundSource,
          type: "motion-transfer",
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("motion-transfer", {
      jobId: job.id,
      imageUrl,
      videoUrl,
      prompt,
      characterOrientation,
      resolution,
      provider,
      backgroundSource,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
