/**
 * Video Upscale Route
 *
 * Upscales a video using:
 * - Topaz Video Upscaler via KIE.ai (factor-based)
 * - VEO 1080p (taskId-based, from completed VEO generation)
 * - VEO 4K (taskId-based, from completed VEO generation)
 *
 * Input:
 * - videoUrl: Source video to upscale (max 50MB) — required for Topaz
 * - upscaleFactor: "1", "2", or "4" — Topaz only
 * - provider: "topaz" (default), "veo-1080p", or "veo-4k"
 * - kieTaskId: Required for VEO providers (original VEO task ID)
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { VIDEO_UPSCALE_PROVIDERS } from "../../../packages/shared/src/model-constants.js"

const videoUpscaleBody = z.object({
  videoUrl: safeUrlSchema.optional(),
  upscaleFactor: z.enum(["1", "2", "4"]).default("2"),
  provider: z.enum(VIDEO_UPSCALE_PROVIDERS).default("topaz"),
  kieTaskId: z.string().optional(),
}).refine(
  (data) => {
    // VEO providers require kieTaskId
    if (data.provider === "veo-1080p" || data.provider === "veo-4k") {
      return !!data.kieTaskId
    }
    // Topaz requires videoUrl
    return !!data.videoUrl
  },
  {
    message: "VEO upscale requires kieTaskId; Topaz requires videoUrl",
  }
)

function upscaleCreditModel(provider: string): string {
  if (provider === "veo-1080p") return "veo-1080p"
  if (provider === "veo-4k") return "veo-4k"
  return "topaz-video"
}

export async function videoUpscaleRoutes(app: FastifyInstance) {
  app.post("/v1/video-upscale", {
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown>
      return upscaleCreditModel((body?.provider as string) ?? "topaz")
    }),
  }, async (req, reply) => {
    const parsed = videoUpscaleBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { videoUrl, upscaleFactor, provider, kieTaskId } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const creditModel = upscaleCreditModel(provider)

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: {
          videoUrl,
          upscaleFactor,
          provider,
          kieTaskId,
          type: "video-upscale",
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, creditModel)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("video-upscale", {
      jobId: job.id,
      videoUrl,
      upscaleFactor,
      provider,
      kieTaskId,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
