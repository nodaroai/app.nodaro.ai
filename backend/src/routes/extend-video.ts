/**
 * Extend Video Route
 *
 * Extends a VEO or Runway video with a new prompt.
 * Requires the original KIE taskId from the upstream video generation job.
 *
 * Providers:
 * - veo-extend: VEO 3.1 extend (POST /api/v1/veo/extend)
 * - runway-extend: Runway extend (POST /api/v1/runway/extend)
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { EXTEND_VIDEO_PROVIDERS } from "../../../packages/shared/src/model-constants.js"

const extendVideoBody = z.object({
  kieTaskId: z.string().min(1, "kieTaskId is required"),
  prompt: z.string().min(1, "prompt is required"),
  provider: z.enum(EXTEND_VIDEO_PROVIDERS),
  model: z.enum(["fast", "quality"]).optional(), // VEO only
  seeds: z.number().int().min(10000).max(99999).optional(), // VEO only
  quality: z.enum(["720p", "1080p"]).optional(), // Runway only
})

export async function extendVideoRoutes(app: FastifyInstance) {
  app.post("/v1/extend-video", {
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown>
      return (body?.provider as string) ?? "veo-extend"
    }),
  }, async (req, reply) => {
    const parsed = extendVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { kieTaskId, prompt, provider, model, seeds, quality } = parsed.data
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
        input_data: {
          kieTaskId,
          prompt,
          provider,
          model,
          seeds,
          quality,
          type: "extend-video",
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, provider)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("extend-video", {
      jobId: job.id,
      kieTaskId,
      prompt,
      provider,
      model,
      seeds,
      quality,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
