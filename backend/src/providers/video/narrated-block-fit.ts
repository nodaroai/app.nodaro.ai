/** BASE credits (pre-markup) for assemble-narrated-video: 3 flat + 1 per 6
 *  blocks. 6→4, 24→7, 60→13. Single source of truth lives in
 *  `@nodaro/shared` (packages/shared/src/credit-estimators/video-utils.ts)
 *  so the frontend pre-run estimate can share it too — re-exported here so
 *  every existing backend import of this module keeps working unchanged. */
export { assembleNarratedVideoCredits } from "@nodaro/shared"

/** One block's fit plan. Audio is never cropped in any branch. */
export type BlockFitPlan =
  | { kind: "passthrough" }
  | { kind: "pad"; voiceDelaySec: number }
  | { kind: "slow"; factor: number; holdSec: number }

/**
 * Decide how one (clip, voice) block is fitted.
 * - no audio            → passthrough (clip used as-is, its own audio kept).
 * - voice <= clip       → keep the clip, center the voice with silence padding.
 * - voice >  clip       → slow the clip to the voice (capped), hold last frame
 *                         for any remainder beyond the cap.
 * Durations are the POST-TRIM clip duration (the provider trims seam frames
 * before calling this).
 */
export function planBlockFit(input: {
  videoDurationSec: number
  audioDurationSec: number | null
  maxSlowdown: number
}): BlockFitPlan {
  const { videoDurationSec, audioDurationSec, maxSlowdown } = input
  if (audioDurationSec == null) return { kind: "passthrough" }

  if (audioDurationSec <= videoDurationSec) {
    const voiceDelaySec = (videoDurationSec - audioDurationSec) / 2
    return { kind: "pad", voiceDelaySec }
  }

  const rawFactor = audioDurationSec / videoDurationSec
  const factor = Math.min(rawFactor, maxSlowdown)
  const stretchedVideoSec = videoDurationSec * factor
  const holdSec = Math.max(0, audioDurationSec - stretchedVideoSec)
  return { kind: "slow", factor, holdSec }
}
