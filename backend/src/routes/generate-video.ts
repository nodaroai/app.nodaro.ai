import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { shotsSchema, elementsSchema } from "../lib/video-schemas.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { IMAGE_TO_VIDEO_PROVIDERS, SEEDANCE_2_REF_LIMITS, isSeedance2Provider } from "../../../packages/shared/src/model-constants.js"
import { buildVideoCreditModelIdentifier } from "../../../packages/shared/src/credit-identifiers.js"

const generateVideoBody = z.object({
  imageUrl: safeUrlSchema.optional(),  // Optional in VEO REFERENCE_2_VIDEO mode
  endFrameUrl: safeUrlSchema.optional(),
  audioUrl: safeUrlSchema.optional(),
  prompt: z.string().max(2500).optional(),
  userPrompt: z.string().max(8000).optional(),
  provider: z.enum(IMAGE_TO_VIDEO_PROVIDERS).optional(),
  generateAudio: z.boolean().optional(),
  duration: z.number().int().min(1).max(60).optional(),
  mode: z.enum(["pro", "std"]).optional(),
  sound: z.boolean().optional(),
  negativePrompt: z.string().max(2500).optional(),
  motionPrompt: z.string().max(2500).optional(),
  cfgScale: z.number().min(0).max(1).optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive", "Auto"]).optional(),
  multiShot: z.boolean().optional(),
  shots: shotsSchema.optional(),
  elements: elementsSchema.optional(),
  resolution: z.string().optional(),
  grokMode: z.enum(["fun", "normal", "spicy"]).optional(),
  videoSize: z.enum(["standard", "high"]).optional(),
  seed: z.number().int().min(-1).max(2147483647).optional(),
  cameraFixed: z.boolean().optional(),
  referenceImageUrls: z.array(safeUrlSchema).max(SEEDANCE_2_REF_LIMITS.images).optional(),
  referenceVideoUrls: z.array(safeUrlSchema).max(SEEDANCE_2_REF_LIMITS.videos).optional(),
  referenceAudioUrls: z.array(safeUrlSchema).max(SEEDANCE_2_REF_LIMITS.audio).optional(),
  webSearch: z.boolean().optional(),
  nsfwChecker: z.boolean().optional(),
  generationType: z.enum(["TEXT_2_VIDEO", "FIRST_AND_LAST_FRAMES_2_VIDEO", "REFERENCE_2_VIDEO"]).optional(),
  userId: z.string().uuid().optional(),
})

export async function generateVideoRoutes(app: FastifyInstance) {
  app.post("/v1/generate-video", {
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown>
      const hasVideoRef = Array.isArray(body?.referenceVideoUrls) && (body.referenceVideoUrls as unknown[]).length > 0
      return buildVideoCreditModelIdentifier(
        (body?.provider as string) ?? "minimax",
        body?.duration as number | string | undefined,
        body?.sound as boolean | undefined,
        "image-to-video",
        body?.videoSize as string | undefined,
        body?.resolution as string | undefined,
        hasVideoRef,
      )
    }),
  }, async (req, reply) => {
    const parsed = generateVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShot, shots, elements, resolution, grokMode, videoSize, seed, cameraFixed, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker, generationType } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const hasMultimodalRef = isSeedance2Provider(provider) && ((referenceVideoUrls?.length ?? 0) > 0 || (referenceAudioUrls?.length ?? 0) > 0)

    // imageUrl is required for all modes except VEO REFERENCE_2_VIDEO or Seedance 2 multimodal ref
    if (!imageUrl && generationType !== "REFERENCE_2_VIDEO" && !hasMultimodalRef) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "imageUrl is required" },
      })
    }

    // Determine model identifier for credit check (supports variable pricing by duration/audio/resolution/video-ref)
    const modelIdentifier = buildVideoCreditModelIdentifier(
      provider ?? "minimax",
      duration,
      sound,
      "image-to-video",
      videoSize,
      resolution,
      (referenceVideoUrls?.length ?? 0) > 0,
    )

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "image-to-video"),
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
      motionPrompt,
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
      referenceImageUrls,
      referenceVideoUrls,
      referenceAudioUrls,
      webSearch,
      nsfwChecker,
      generationType,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
