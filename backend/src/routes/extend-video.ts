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
import { buildJobInputData } from "../lib/job-input-data.js"
import { EXTEND_VIDEO_PROVIDERS } from "@nodaro/shared"

const extendVideoBody = z.object({
  kieTaskId: z.string().min(1, "kieTaskId is required"),
  prompt: z.string().min(1, "prompt is required"),
  userPrompt: z.string().max(8000).optional(),
  provider: z.enum(EXTEND_VIDEO_PROVIDERS),
  model: z.enum(["fast", "quality"]).optional(), // VEO only
  seeds: z.number().int().min(10000).max(99999).optional(), // VEO only
  quality: z.enum(["720p", "1080p"]).optional(), // Runway only
})

// Resolve the credit identifier used by both the preHandler check and the
// downstream credit reservation. Keeping these in sync is critical — a
// divergence would charge the preHandler's price but reserve at a different
// price, which can let under-funded users through or over-charge paying ones.
function resolveExtendVideoIdentifier(body: Record<string, unknown> | undefined): string {
  const provider = (body?.provider as string) ?? "veo-extend"
  if (provider === "veo-extend" && body?.model === "quality") {
    return "veo-extend:quality"
  }
  return provider
}

export async function extendVideoRoutes(app: FastifyInstance) {
  app.post("/v1/extend-video", {
    preHandler: creditGuard((req) => resolveExtendVideoIdentifier(req.body as Record<string, unknown> | undefined)),
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
        input_data: buildJobInputData(parsed.data, "extend-video"),
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
      resolveExtendVideoIdentifier(req.body as Record<string, unknown> | undefined),
    )
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
