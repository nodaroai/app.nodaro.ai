import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { LIP_SYNC_PROVIDERS } from "../../../packages/shared/src/model-constants.js"

const lipSyncBody = z.object({
  imageUrl: safeUrlSchema,       // Portrait/face image
  audioUrl: safeUrlSchema,       // Audio to sync (speech)
  prompt: z.string().max(500).optional(),  // Optional prompt for infinitalk
  provider: z.enum(LIP_SYNC_PROVIDERS).optional(),
  resolution: z.enum(["480p", "720p"]).optional(),  // For infinitalk
  userId: z.string().uuid().optional(),
})

export async function lipSyncRoutes(app: FastifyInstance) {
  app.post("/v1/lip-sync", {
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown>
      const provider = (body?.provider as string) ?? "kling-avatar"
      if (provider === "infinitalk") {
        const res = (body?.resolution as string) ?? "720p"
        return `infinitalk:${res}`
      }
      return provider
    }),
  }, async (req, reply) => {
    const parsed = lipSyncBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, audioUrl, prompt, provider, resolution } = parsed.data
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
        input_data: { imageUrl, audioUrl, prompt, provider, resolution, type: "lip-sync" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    // Build composite credit identifier for infinitalk (resolution-based pricing)
    const baseProvider = provider ?? "kling-avatar"
    const modelIdentifier = baseProvider === "infinitalk"
      ? `infinitalk:${resolution ?? "720p"}`
      : baseProvider
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("lip-sync", {
      jobId: job.id,
      imageUrl,
      audioUrl,
      prompt,
      provider: baseProvider,
      resolution,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
