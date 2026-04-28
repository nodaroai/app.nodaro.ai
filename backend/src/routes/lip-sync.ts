import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { LIP_SYNC_PROVIDERS } from "@nodaro/shared"

const lipSyncBody = z.object({
  imageUrl: safeUrlSchema.optional(),     // Portrait/face image (required for KIE/SadTalker)
  videoUrl: safeUrlSchema.optional(),     // Video input (required for LatentSync/Video-Retalking)
  audioUrl: safeUrlSchema,                // Audio to sync
  prompt: z.string().max(500).optional(),
  userPrompt: z.string().max(8000).optional(),
  provider: z.enum(LIP_SYNC_PROVIDERS).optional(),
  resolution: z.enum(["480p", "720p"]).optional(),
  // LatentSync params
  guidanceScale: z.number().min(1).max(3).optional(),
  inferenceSteps: z.number().int().min(20).max(50).optional(),
  seed: z.number().int().optional(),
  // Wav2Lip params
  pads: z.string().max(50).optional(),
  smooth: z.boolean().optional(),
  fps: z.number().min(1).max(60).optional(),
  resizeFactor: z.number().int().min(1).max(4).optional(),
  // SadTalker params
  enhancer: z.enum(["gfpgan", "RestoreFormer"]).optional(),
  preprocess: z.enum(["crop", "resize", "full"]).optional(),
  still: z.boolean().optional(),
  poseStyle: z.number().int().min(0).max(45).optional(),
  expressionScale: z.number().min(0).max(3).optional(),
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

    const {
      imageUrl, videoUrl, audioUrl, prompt, provider, resolution,
      guidanceScale, inferenceSteps, seed,
      pads, smooth, fps, resizeFactor,
      enhancer, preprocess, still, poseStyle, expressionScale,
    } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Validate that at least one face input is provided
    if (!imageUrl && !videoUrl) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Either imageUrl or videoUrl is required" },
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "lip-sync"),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

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
      videoUrl,
      audioUrl,
      prompt,
      provider: baseProvider,
      resolution,
      guidanceScale, inferenceSteps, seed,
      pads, smooth, fps, resizeFactor,
      enhancer, preprocess, still, poseStyle, expressionScale,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
