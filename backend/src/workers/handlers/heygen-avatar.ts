/**
 * Worker handler for the `ai-avatar` job type.
 *
 * Calls HeyGen's generateAvatarVideo() — which internally polls /v3/videos
 * to completion — then re-hosts the expiring result URL to R2, generates a
 * thumbnail, and finalizes the job with metered USD cost so the billing layer
 * can compute the exact credit charge and refund any surplus from the reserved
 * hold.
 *
 * Modeled on handleSpeechToVideo in video-ai.ts (same withProgressRamp +
 * uploadVideoMaybeWatermark + finalizeJobWithMedia shape), but without the
 * cinematography/identity hint folding — the `script` field is verbatim TTS
 * and must never be augmented.
 */

import { generateAvatarVideo } from "../../providers/heygen/video.js"
import type { AiAvatarEngine, AiAvatarResolution } from "@nodaro/shared"
import {
  withProgressRamp,
  uploadVideoMaybeWatermark,
  generateAndUploadThumbnail,
  setJobProgress,
  type HandlerFn,
} from "../shared.js"
import { finalizeJobWithMedia } from "../../lib/job-finalize.js"

export const handleAiAvatar: HandlerFn = async function handleAiAvatar(job, ctx) {
  const {
    engine,
    avatarId,
    speechMode,
    script,
    voiceId,
    voiceSpeed,
    audioUrl,
    resolution,
    aspectRatio,
    caption,
    usageLogId,
  } = job.data as {
    jobId: string
    engine: AiAvatarEngine
    avatarId: string
    speechMode: "text" | "audio"
    script?: string
    voiceId?: string
    voiceSpeed?: number
    audioUrl?: string
    resolution: AiAvatarResolution
    aspectRatio: "16:9" | "9:16"
    caption?: boolean
    usageLogId?: string | null
  }

  console.log(
    `[worker] ai-avatar ${ctx.jobId} (engine: ${engine}, speechMode: ${speechMode}, resolution: ${resolution})`,
  )

  // generateAvatarVideo() blocks internally (polls HeyGen until completed/failed),
  // so we wrap it in a progress ramp to keep the widget bar moving. HeyGen
  // doesn't surface live progress percentages, so the ramp is the only signal.
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => generateAvatarVideo({
      engine,
      avatarId,
      speechMode,
      script,
      voiceId,
      voiceSpeed,
      audioUrl,
      resolution,
      aspectRatio,
      caption,
    }),
  )
  await setJobProgress(job, ctx.jobId, 50)

  // HeyGen result URLs are signed + expiring — re-host to R2 immediately.
  const r2Url = await uploadVideoMaybeWatermark(
    result.videoUrl,
    ctx.jobId,
    ctx.jobUserId,
    ctx.shouldWatermark,
  )
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  // Pass result.cost (USD) + meteredCost:true so commitJobCredits computes the
  // actual credit charge from the provider's USD cost and refunds any surplus
  // below the reserved hold (bucket ceiling).
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "ai-avatar",
    result: {
      url: result.videoUrl,
      cost: result.cost,
      meteredCost: result.meteredCost,
      providerUsed: "heygen",
    },
    mediaUrl: r2Url,
    extraOutputData: {
      thumbnailUrl: thumbUrl,
      durationSec: result.durationSec,
    },
  })
  if (!ok) return
  console.log(
    `[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: heygen, cost: $${result.cost.toFixed(6)})`,
  )
}
