/**
 * Video Retake Route (LTX 2.3 Pro)
 *
 * Replace a portion of a video — audio only, video only, or both — using
 * Lightricks LTX 2.3 Pro's `retake` task on Replicate. Webhook-driven
 * completion via the standard Replicate reconcile path.
 *
 * Credit math: `ltx-2.3-pro-retake:per-second × retakeDuration` — the
 * per-second rate is seeded in STATIC_CREDIT_COSTS and model_pricing
 * (Task 1.7). The route's `computeCredits` hook multiplies by the user-
 * supplied retake duration so the reservation matches the actual cost.
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { getModelCreditBaseCost } from "../ee/billing/credits.js"

const RETAKE_MODEL_IDENTIFIER = "ltx-2.3-pro-retake:per-second"

const videoRetakeBody = z.object({
  videoUrl: safeUrlSchema,
  prompt: z.string().max(8000).optional().default(""),
  retakeStartTime: z.number().min(0),
  retakeDuration: z.number().min(2),
  retakeMode: z.enum(["replace_audio", "replace_video", "replace_audio_and_video"]),
  aspectRatio: z.enum(["16:9", "9:16"]),
  fps: z.union([z.literal(24), z.literal(25), z.literal(48), z.literal(50)]),
  generateAudio: z.boolean(),
  cameraMotion: z.string().optional(),
  userId: z.string().uuid().optional(),
})

export async function videoRetakeRoutes(app: FastifyInstance) {
  app.post("/v1/video-retake", {
    preHandler: creditGuard(() => RETAKE_MODEL_IDENTIFIER, {
      // LTX retake bills per second of replaced material. Pull the per-second
      // rate from the DB / STATIC_CREDIT_COSTS fallback and multiply by the
      // user-supplied duration. checkCredits + reserveCredits both use this
      // value so they stay in sync.
      computeCredits: async (body) => {
        const b = body as Record<string, unknown>
        const duration = typeof b.retakeDuration === "number" && b.retakeDuration > 0
          ? b.retakeDuration
          : 2
        const pricing = await getModelCreditBaseCost(RETAKE_MODEL_IDENTIFIER)
        return Math.ceil(pricing.creditCost * duration)
      },
    }),
  }, async (req, reply) => {
    const parsed = videoRetakeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const {
      videoUrl,
      prompt,
      retakeStartTime,
      retakeDuration,
      retakeMode,
      aspectRatio,
      fps,
      generateAudio,
      cameraMotion,
    } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const mcpClient = extractMcpClient(req.body)
    // job_type powers the reconcile cron's correct finalization path —
    // see lib/reconcile/replicate.ts (defaults to "generate-image" when
    // null, which mis-uploads the LTX retake video as an image).
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        job_type: "video-retake",
        status: "pending",
        input_data: buildJobInputData(parsed.data, "video-retake"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(
      req,
      reply,
      job.id,
      RETAKE_MODEL_IDENTIFIER,
    )
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("video-retake", {
      jobId: job.id,
      provider: "ltx-2.3-pro",
      video: videoUrl,
      prompt: prompt ?? "",
      retake_start_time: retakeStartTime,
      retake_duration: retakeDuration,
      retake_mode: retakeMode,
      resolution: "1080p",
      aspect_ratio: aspectRatio,
      fps,
      generate_audio: generateAudio,
      camera_motion: cameraMotion ?? "none",
      usageLogId,
    })

    return { jobId: job.id }
  })
}
