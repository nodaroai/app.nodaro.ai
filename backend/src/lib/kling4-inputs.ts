import {
  isKling4Provider,
  kling4KeyframeFrameCap,
  pricedOutputDurationSec,
  KLING_4_MAX_MIDDLE_FRAMES,
  VIDEO_REF_LIMITS_BY_PROVIDER,
} from "@nodaro/shared/models"

/**
 * The input counts a Kling 4.0 run must respect before anything is reserved —
 * ONE rule, shared by the video routes (a 400 before the reservation) and the
 * DAG payload builder (a throw before any jobs row exists). KIE refuses each of
 * these at create time with a 422, which would otherwise surface as a failed
 * run after the reservation.
 *
 *   - `kling-4-keyframes`: start + in-between + end frames ≤ the duration's
 *     frame cap (3s → 4 … 9s or longer → 10; live-verified 2026-10-23: "duration
 *     3s allows at most 4 frames (first + keyframes + last), got 5"), and at
 *     most 8 in-between frames.
 *   - `kling-4`: images (a start or end frame counts as one) + videos +
 *     characters + voices ≤ 15 (docs.kie.ai/market/kling/v4-reference-to-video).
 *
 * Returns null when the run is legal, or for any other provider.
 */
export function kling4InputProblem(args: {
  provider: string | undefined
  /** The duration the run renders (already snapped), seconds. */
  durationSec: number | undefined
  hasStartFrame: boolean
  hasEndFrame: boolean
  referenceImageCount: number
  referenceVideoCount: number
  referenceAudioCount: number
  characterCount: number
}): { code: "validation_error"; message: string } | null {
  if (!isKling4Provider(args.provider)) return null
  if (args.provider === "kling-4-keyframes") {
    const durationSec = pricedOutputDurationSec(args.provider, args.durationSec)
    const cap = kling4KeyframeFrameCap(durationSec)
    const frames = (args.hasStartFrame ? 1 : 0) + (args.hasEndFrame ? 1 : 0) + args.referenceImageCount
    if (args.referenceImageCount > KLING_4_MAX_MIDDLE_FRAMES) {
      return {
        code: "validation_error",
        message: `Kling 4.0 Keyframes takes at most ${KLING_4_MAX_MIDDLE_FRAMES} in-between frames; ${args.referenceImageCount} are connected.`,
      }
    }
    if (frames > cap) {
      return {
        code: "validation_error",
        message:
          `Kling 4.0 Keyframes takes at most ${cap} frames in all (start + in-between + end) for a ${Math.round(durationSec)}s clip; ` +
          `${frames} are connected. Remove some frames or make the clip longer (9s or longer takes 10).`,
      }
    }
    return null
  }
  const materials = VIDEO_REF_LIMITS_BY_PROVIDER[args.provider as string]?.materials ?? 15
  const used =
    args.referenceImageCount +
    (args.hasStartFrame ? 1 : 0) +
    (args.hasEndFrame ? 1 : 0) +
    args.referenceVideoCount +
    args.referenceAudioCount +
    args.characterCount
  if (used > materials) {
    return {
      code: "validation_error",
      message:
        `Kling 4.0 takes at most ${materials} materials in all — reference images (a start or end frame counts as one), ` +
        `reference videos, characters and voice clips. This run has ${used}. Remove some.`,
    }
  }
  return null
}
