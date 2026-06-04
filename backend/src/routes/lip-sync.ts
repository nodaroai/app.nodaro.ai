import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { LIP_SYNC_PROVIDERS, buildLipSyncCreditId, isPerSecondLipSyncProvider } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

const lipSyncBody = z.object({
  imageUrl: safeUrlSchema.optional(),     // Portrait/face image (required for KIE/SadTalker)
  videoUrl: safeUrlSchema.optional(),     // Video input (required for LatentSync/Video-Retalking)
  audioUrl: safeUrlSchema,                // Audio to sync
  prompt: z.string().max(500).optional(),
  userPrompt: z.string().max(8000).optional(),
  provider: z.enum(LIP_SYNC_PROVIDERS).optional(),
  // 1080p only valid for seedance-2 / seedance-2-fast; infinitalk caps at 720p.
  resolution: z.enum(["480p", "720p", "1080p"]).optional(),
  // Audio length in seconds — drives per-second credit reservation for
  // kling-avatar(-pro). If absent, we reserve the worst-case 5-min bucket
  // and refund the unused credits after the worker reconciles actual cost.
  audioDurationSec: z.number().min(0.1).max(600).optional(),
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
  // HeyGen Lipsync Precision params
  enableDynamicDuration: z.boolean().optional(),
  disableMusicTrack: z.boolean().optional(),
  enableSpeechEnhancement: z.boolean().optional(),
  // Sync Lipsync 2 Pro params
  syncMode: z.enum(["loop", "bounce", "cut_off", "silence", "remap"]).optional(),
  temperature: z.number().min(0).max(1).optional(),
  activeSpeaker: z.boolean().optional(),
  userId: z.string().uuid().optional(),
})

/**
 * Single source of truth for the lip-sync credit identifier — used by BOTH the
 * creditGuard preHandler and the in-handler reservation so the reserved price
 * can never drift from the charged price. Mirrors extend-video.ts's
 * resolveExtendVideoIdentifier().
 */
function resolveLipSyncIdentifier(body: Record<string, unknown> | undefined): string {
  const provider = (body?.provider as string) ?? "kling-avatar"
  if (provider === "infinitalk") {
    return `infinitalk:${(body?.resolution as string) ?? "720p"}`
  }
  // Seedance 2 / 2 Fast — billed per-second × resolution × ref. We ALWAYS pass
  // the audio as a reference, so the identifier always ends in -ref. Default to
  // the 8s tier for reservation; the worker decides actual duration (≤ audio).
  if (provider === "seedance-2" || provider === "seedance-2-fast") {
    return `${provider}:8s:${(body?.resolution as string) ?? "720p"}-ref`
  }
  // Per-second-billed providers (Kling AI Avatar 2.0, HeyGen Lipsync Precision,
  // Sync Lipsync 2 Pro) — bucketed by audio length. Missing audioDurationSec
  // falls back to the 5-min bucket (worst case); for Kling the worker refunds
  // the diff once actual KIE costTime is known. Data-driven off
  // PER_SECOND_LIP_SYNC_PROVIDERS so new per-second models wire themselves.
  if (isPerSecondLipSyncProvider(provider)) {
    const dur = typeof body?.audioDurationSec === "number" ? body.audioDurationSec : undefined
    return buildLipSyncCreditId(provider, dur)
  }
  return provider
}

export async function lipSyncRoutes(app: FastifyInstance) {
  app.post("/v1/lip-sync", {
    preHandler: creditGuard((req) => resolveLipSyncIdentifier(req.body as Record<string, unknown> | undefined)),
  }, async (req, reply) => {
    const parsed = lipSyncBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const {
      imageUrl, videoUrl, audioUrl, prompt, provider, resolution,
      audioDurationSec,
      guidanceScale, inferenceSteps, seed,
      pads, smooth, fps, resizeFactor,
      enhancer, preprocess, still, poseStyle, expressionScale,
      enableDynamicDuration, disableMusicTrack, enableSpeechEnhancement,
      syncMode, temperature, activeSpeaker,
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
    const modelIdentifier = resolveLipSyncIdentifier(req.body as Record<string, unknown> | undefined)
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
      audioDurationSec,
      guidanceScale, inferenceSteps, seed,
      pads, smooth, fps, resizeFactor,
      enhancer, preprocess, still, poseStyle, expressionScale,
      enableDynamicDuration, disableMusicTrack, enableSpeechEnhancement,
      syncMode, temperature, activeSpeaker,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
