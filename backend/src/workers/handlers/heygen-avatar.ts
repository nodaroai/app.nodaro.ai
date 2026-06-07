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
import type { TtsEngineSettings, AvatarBackground } from "../../providers/heygen/video.js"
import type { AiAvatarEngine, AiAvatarResolution } from "@nodaro/shared"
import {
  withProgressRamp,
  uploadVideoMaybeWatermark,
  generateAndUploadThumbnail,
  setJobProgress,
  type HandlerFn,
} from "../shared.js"
import { finalizeJobWithMedia } from "../../lib/job-finalize.js"
import { capAudioForAvatar } from "./heygen-avatar-audio-cap.js"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"

export const handleAiAvatar: HandlerFn = async function handleAiAvatar(job, ctx) {
  const {
    avatarSource,
    engine,
    avatarId,
    imageUrl,
    speechMode,
    script,
    voiceId,
    voiceSpeed,
    pitch,
    volume,
    locale,
    ttsEngine,
    audioUrl,
    resolution,
    aspectRatio,
    fit,
    outputFormat,
    caption,
    captionStyle,
    background,
    removeBackground,
    motionPrompt,
    expressiveness,
    usageLogId,
  } = job.data as {
    jobId: string
    avatarSource?: "avatar" | "image"
    engine: AiAvatarEngine
    avatarId: string
    imageUrl?: string
    speechMode: "text" | "audio"
    script?: string
    voiceId?: string
    voiceSpeed?: number
    pitch?: number
    volume?: number
    locale?: string
    ttsEngine?: TtsEngineSettings
    audioUrl?: string
    resolution: AiAvatarResolution
    aspectRatio: "16:9" | "9:16"
    fit?: "cover" | "contain"
    outputFormat?: "mp4" | "webm"
    caption?: boolean
    captionStyle?: "default"
    background?: AvatarBackground
    removeBackground?: boolean
    motionPrompt?: string
    expressiveness?: "high" | "medium" | "low"
    usageLogId?: string | null
  }

  console.log(
    `[worker] ai-avatar ${ctx.jobId} (source: ${avatarSource ?? "avatar"}, engine: ${engine}, speechMode: ${speechMode}, resolution: ${resolution})`,
  )

  // AUDIO mode has no natural length cap on HeyGen's side, so a long audio is
  // both expensive and bounded by a 600s credit reserve. Before generating, cap
  // the driving audio to AI_AVATAR_MAX_AUDIO_SEC (600s): trim + re-host longer
  // clips, and surface a non-fatal warning. Best-effort — capAudioForAvatar
  // returns the ORIGINAL url (no warning) if probe/trim fails.
  let effectiveAudioUrl = audioUrl
  let audioCapWarning: string | undefined
  if (speechMode === "audio" && typeof audioUrl === "string" && audioUrl.length > 0) {
    const capped = await capAudioForAvatar(audioUrl, ctx.jobId, ctx.jobUserId)
    effectiveAudioUrl = capped.audioUrl
    audioCapWarning = capped.warning
  }

  // generateAvatarVideo() blocks internally (polls HeyGen until completed/failed),
  // so we wrap it in a progress ramp to keep the widget bar moving. HeyGen
  // doesn't surface live progress percentages, so the ramp is the only signal.
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => generateAvatarVideo({
      avatarSource,
      engine,
      avatarId,
      imageUrl,
      speechMode,
      script,
      voiceId,
      voiceSpeed,
      pitch,
      volume,
      locale,
      ttsEngine,
      audioUrl: effectiveAudioUrl,
      resolution,
      aspectRatio,
      fit,
      outputFormat,
      caption,
      captionStyle,
      background,
      removeBackground,
      motionPrompt,
      expressiveness,
      onTaskCreated: makeOnTaskCreated(ctx.jobId, "heygen"),
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
      // Non-fatal warning surfaced to the user (e.g. audio was trimmed to the
      // 600s cap). Stored on output_data so the ai-avatar node can show it.
      // Omitted entirely when there's nothing to warn about.
      ...(audioCapWarning ? { warningMessage: audioCapWarning } : {}),
    },
  })
  if (!ok) return
  console.log(
    `[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: heygen, cost: $${result.cost.toFixed(6)})`,
  )
}
