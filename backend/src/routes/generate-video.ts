import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { shotsSchema, elementsSchema } from "../lib/video-schemas.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { getModelCreditBaseCost } from "../ee/billing/credits.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { VIDEO_GEN_PROVIDERS, SEEDANCE_2_REF_LIMITS, isSeedance2Provider, estimateLoopTrimAddonCredits } from "@nodaro/shared"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

export const generateVideoBody = z.object({
  imageUrl: safeUrlSchema.optional(),  // Optional in VEO REFERENCE_2_VIDEO mode
  endFrameUrl: safeUrlSchema.optional(),
  last_frame_image: safeUrlSchema.optional(),  // LTX image_to_video end-frame URL (snake_case)
  audioUrl: safeUrlSchema.optional(),
  prompt: z.string().max(2500).optional(),
  userPrompt: z.string().max(8000).optional(),
  provider: z.enum(VIDEO_GEN_PROVIDERS).optional(),
  generateAudio: z.boolean().optional(),
  duration: z.number().int().min(1).max(60).optional(),
  mode: z.enum(["pro", "std", "4K"]).optional(),
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
  // VEO3.1 first+last-frame mode adds a ~333ms tail dissolve that
  // breaks loop seamlessness. Default true: strip the last 8 frames
  // post-render so the rendered last frame matches the supplied
  // `last_frame_url` exactly. Set false to keep the dissolve.
  loopTrim: z.object({
    enabled: z.boolean(),
    framesToTest: z.number().int().min(1).max(64).optional(),
    quality: z.enum(["lossless", "precise"]).optional(),
  }).optional(),
  // Legacy field — accepted for one release as a deprecation cycle.
  // Frontend migrates on workflow load; routes/MCP map it on entry.
  autoLoopTrim: z.boolean().optional(),
  // VEO 3.x: opt out of KIE's auto-translate-to-English (default true
  // upstream). Set false to keep prompts verbatim — useful when the
  // prompt's exact wording is load-bearing (perfect-loop seal phrase,
  // non-English creative direction). Has no effect on non-VEO providers.
  enableTranslation: z.boolean().optional(),
  seedance2InputMode: z.enum(["frames", "references"]).optional(),
  // Identity injection (image-to-video). When the upstream Character node
  // has its "Inject identity description in downstream prompts" toggle
  // enabled, the frontend / DAG executor passes injectCharacterContext +
  // attachToCharacterId so the route appends the character's
  // canonical_description (with an identity-preserve suffix) to the prompt
  // before reservation and worker enqueue. Default off.
  injectCharacterContext: z.boolean().optional().default(false),
  attachToCharacterId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
})

const IDENTITY_PRESERVE_SUFFIX =
  "The subject must remain exactly the same person — preserve facial identity, eye color, hair color, skin tone, and unique features."

export async function generateVideoRoutes(app: FastifyInstance) {
  app.post("/v1/generate-video", {
    preHandler: creditGuard(
      (req) => {
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
      },
      {
        computeCredits: async (body) => {
          const b = body as Record<string, unknown>
          const hasVideoRef = Array.isArray(b?.referenceVideoUrls) && (b.referenceVideoUrls as unknown[]).length > 0
          const modelId = buildVideoCreditModelIdentifier(
            (b?.provider as string) ?? "minimax",
            b?.duration as number | string | undefined,
            b?.sound as boolean | undefined,
            "image-to-video",
            b?.videoSize as string | undefined,
            b?.resolution as string | undefined,
            hasVideoRef,
          )
          const { creditCost: baseCost } = await getModelCreditBaseCost(modelId)
          // Normalize legacy autoLoopTrim into loopTrim for addon math.
          const rawLoopTrim = b.loopTrim as { enabled?: boolean; framesToTest?: number } | undefined
          const legacyAuto = b.autoLoopTrim as boolean | undefined
          const loopTrim = rawLoopTrim ?? (legacyAuto !== undefined
            ? (legacyAuto ? { enabled: true, framesToTest: 8 } : { enabled: false })
            : undefined)
          const duration = typeof b.duration === "number" ? b.duration : 8
          const addon = estimateLoopTrimAddonCredits(loopTrim, duration)
          return baseCost + addon
        },
      },
    ),
  }, async (req, reply) => {
    const parsed = generateVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { audioUrl, prompt: rawPrompt, provider, generateAudio, duration, mode, sound, negativePrompt, motionPrompt, cfgScale, aspectRatio, multiShot, shots, elements, resolution, grokMode, videoSize, seed, cameraFixed, webSearch, nsfwChecker, generationType, autoLoopTrim, loopTrim: rawLoopTrim, enableTranslation, seedance2InputMode } = parsed.data
    let prompt = rawPrompt

    // Seedance 2: strip inputs that belong to the inactive mode — hidden handles leave
    // stale edges that still resolve and would otherwise send conflicting params to KIE
    const isS2 = isSeedance2Provider(provider)
    const imageUrl = (isS2 && seedance2InputMode === "references") ? undefined : parsed.data.imageUrl
    const endFrameUrl = (isS2 && seedance2InputMode === "references") ? undefined : parsed.data.endFrameUrl
    const referenceImageUrls = (isS2 && seedance2InputMode === "frames") ? undefined : parsed.data.referenceImageUrls
    const referenceVideoUrls = (isS2 && seedance2InputMode === "frames") ? undefined : parsed.data.referenceVideoUrls
    const referenceAudioUrls = (isS2 && seedance2InputMode === "frames") ? undefined : parsed.data.referenceAudioUrls

    // Legacy autoLoopTrim → loopTrim normalization. Drop in a future release.
    const loopTrim = rawLoopTrim ?? (autoLoopTrim !== undefined
      ? (autoLoopTrim
        ? { enabled: true, framesToTest: 8, quality: "precise" as const }
        : { enabled: false })
      : undefined)
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Identity injection — when enabled + a character is referenced, append
    // the canonical_description (with description fallback) plus an
    // identity-preserve suffix to the prompt. Off by default.
    if (parsed.data.injectCharacterContext && parsed.data.attachToCharacterId) {
      const { data: char } = await supabase
        .from("characters")
        .select("canonical_description, description, name")
        .eq("id", parsed.data.attachToCharacterId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .single()
      if (char) {
        const canonical = typeof char.canonical_description === "string" ? char.canonical_description.trim() : ""
        const desc = typeof char.description === "string" ? char.description.trim() : ""
        const identityText = canonical.length > 0 ? canonical : (desc.length > 0 ? desc : "")
        if (identityText.length > 0) {
          const base = (prompt ?? "").trim()
          // image-to-video prompt is optional — start from empty if absent.
          prompt = base.length > 0
            ? `${base}\n\n${identityText}\n\n${IDENTITY_PRESERVE_SUFFIX}`
            : `${identityText}\n\n${IDENTITY_PRESERVE_SUFFIX}`
          // Mirror the final prompt into parsed.data so buildJobInputData
          // captures it in jobs.input_data.
          parsed.data.prompt = prompt
          if (prompt.length > 2000) {
            req.log.warn(
              { characterId: parsed.data.attachToCharacterId, finalPromptLength: prompt.length },
              "[image-to-video] character context injection produced a long prompt; consider trimming canonicalDescription",
            )
          }
        }
      }
    }

    const hasMultimodalRef = isS2 && (
      (referenceVideoUrls?.length ?? 0) > 0 ||
      (referenceAudioUrls?.length ?? 0) > 0 ||
      (referenceImageUrls?.length ?? 0) > 0
    )

    // imageUrl is required for all modes except VEO REFERENCE_2_VIDEO or Seedance 2 ref-only mode
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

    const mcpClient = extractMcpClient(req.body)
    // job_type is required for the reconcile cron to finalise the job
    // correctly — `lib/reconcile/replicate.ts` reads job_type to dispatch
    // into the right VIDEO_TYPES bucket in job-finalize.ts. Without it,
    // reconcile defaults to "generate-image" and tries to upload an LTX
    // video as an image. Always "image-to-video" here — this route only
    // serves i2v; the t2v route is `/v1/text-to-video`.
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        job_type: "image-to-video",
        status: "pending",
        input_data: buildJobInputData(parsed.data, "image-to-video"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
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
      loopTrim,
      enableTranslation,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
