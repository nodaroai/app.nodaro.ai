import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { shotsSchema, elementsSchema } from "../lib/video-schemas.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { IMAGE_TO_VIDEO_PROVIDERS } from "../../../packages/shared/src/model-constants.js"
import { buildVideoCreditModelIdentifier } from "../../../packages/shared/src/credit-identifiers.js"

const generateVideoBody = z.object({
  imageUrl: safeUrlSchema,
  endFrameUrl: safeUrlSchema.optional(),
  audioUrl: safeUrlSchema.optional(),
  prompt: z.string().max(2500).optional(),
  provider: z.enum(IMAGE_TO_VIDEO_PROVIDERS).optional(),
  generateAudio: z.boolean().optional(),
  duration: z.number().int().min(1).max(60).optional(),
  mode: z.enum(["pro", "std"]).optional(),
  sound: z.boolean().optional(),
  negativePrompt: z.string().max(2500).optional(),
  cfgScale: z.number().min(0).max(1).optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "21:9"]).optional(),
  multiShot: z.boolean().optional(),
  shots: shotsSchema.optional(),
  elements: elementsSchema.optional(),
  resolution: z.string().optional(),
  grokMode: z.enum(["fun", "normal", "spicy"]).optional(),
  videoSize: z.enum(["standard", "high"]).optional(),
  seed: z.number().int().min(-1).max(2147483647).optional(),
  cameraFixed: z.boolean().optional(),
  removeWatermark: z.boolean().optional(),
  userId: z.string().uuid().optional(),
})

export async function generateVideoRoutes(app: FastifyInstance) {
  app.post("/v1/generate-video", { preHandler: creditGuard((req) => { const body = req.body as Record<string, unknown>; return buildVideoCreditModelIdentifier((body?.provider as string) ?? "minimax", body?.duration as number | string | undefined, body?.sound as boolean | undefined) }) }, async (req, reply) => {
    const parsed = generateVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration, mode, sound, negativePrompt, cfgScale, aspectRatio, multiShot, shots, elements, resolution, grokMode, videoSize, seed, cameraFixed, removeWatermark } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Determine model identifier for credit check (supports variable pricing by duration/audio)
    const modelIdentifier = buildVideoCreditModelIdentifier(provider ?? "minimax", duration, sound)

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration, mode, sound, negativePrompt, cfgScale, aspectRatio, multiShot, shots, elements, resolution, grokMode, videoSize, seed, cameraFixed, removeWatermark, type: "image-to-video" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("image-to-video", {
      jobId: job.id,
      imageUrl,
      endFrameUrl,
      audioUrl,
      prompt,
      provider,
      generateAudio,
      duration,
      mode,
      sound,
      negativePrompt,
      cfgScale,
      aspectRatio,
      multiShot,
      shots,
      elements,
      resolution,
      grokMode,
      videoSize,
      seed,
      cameraFixed,
      removeWatermark,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
