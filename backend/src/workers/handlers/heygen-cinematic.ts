/**
 * Worker handler for the `cinematic-avatar` job type.
 *
 * Calls HeyGen's generateCinematicAvatar() — which internally polls
 * /v1/video_status.get to completion — then re-hosts the expiring result URL
 * to R2, generates a thumbnail, and finalizes the job with metered USD cost so
 * the billing layer computes the exact credit charge and refunds any surplus
 * from the reserved hold.
 *
 * Modeled on handleAiAvatar in heygen-avatar.ts (same withProgressRamp +
 * uploadVideoMaybeWatermark + finalizeJobWithMedia shape). Unlike ai-avatar the
 * duration is a USER PARAMETER known at submit time, so the reserve id is EXACT
 * and the surplus refund in the common case is zero.
 */

import { generateCinematicAvatar } from "../../providers/heygen/cinematic.js"
import type { CinematicResolution } from "@nodaro/shared"
import {
  withProgressRamp,
  uploadVideoMaybeWatermark,
  generateAndUploadThumbnail,
  setJobProgress,
  type HandlerFn,
} from "../shared.js"
import { finalizeJobWithMedia } from "../../lib/job-finalize.js"

export const handleCinematicAvatar: HandlerFn = async function handleCinematicAvatar(job, ctx) {
  const {
    prompt,
    avatarLooks,
    duration,
    autoDuration,
    aspectRatio,
    resolution,
    enhancePrompt,
  } = job.data as {
    jobId: string
    prompt: string
    avatarLooks: string[]
    duration?: number
    autoDuration?: boolean
    aspectRatio?: "16:9" | "9:16" | "1:1"
    resolution?: CinematicResolution
    enhancePrompt?: boolean
    usageLogId?: string | null
  }

  console.log(
    `[worker] cinematic-avatar ${ctx.jobId} (resolution: ${resolution ?? "720p"}, duration: ${autoDuration ? "auto" : (duration ?? 10)}s)`,
  )

  // generateCinematicAvatar() blocks internally (polls HeyGen until
  // completed/failed), so we wrap it in a progress ramp to keep the widget
  // bar moving. HeyGen doesn't surface live progress percentages for
  // cinematic_avatar, so the ramp is the only signal.
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () =>
      generateCinematicAvatar({
        prompt,
        avatarLooks,
        duration,
        autoDuration,
        aspectRatio,
        resolution,
        enhancePrompt,
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
  // below the reserved hold. Because duration is exact here, the hold and
  // actual usually coincide modulo markup — so the refund is typically zero.
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "cinematic-avatar",
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
