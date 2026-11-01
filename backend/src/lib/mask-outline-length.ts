import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"
import { unitRateBaseCredits } from "./credit-base-cost.js"

/**
 * Mask Outline (`POST /v1/mask-outline`, decided 2026-11-01): how long the
 * clip the rings are drawn on is, and so how many pricing units a run is
 * charged — one `mask-outline` row per started 5 seconds of the clip, the
 * video-utility unit (as Mask Erase). The row is read from `model_pricing`,
 * so an administrator's retune reaches every unit.
 *
 * A clip that cannot be read, or is longer than any clip the platform masks
 * (`MASK_OUTLINE_MAX_DURATION_SEC`, Video Mask's own longest clip), is refused
 * before anything is reserved: the worker must decode it, so it would fail
 * there anyway.
 */

/** Seconds of clip one pricing unit covers. */
export const MASK_OUTLINE_UNIT_SEC = 5
/** The longest clip an outline run accepts, seconds (Video Mask's longest clip). */
export const MASK_OUTLINE_MAX_DURATION_SEC = 300

/** Pricing units for a clip `durationSec` long: one per started 5 seconds, at least one. Pure. */
export function maskOutlineUnits(durationSec: number): number {
  const sec = Number.isFinite(durationSec) && durationSec > 0 ? Math.min(durationSec, MASK_OUTLINE_MAX_DURATION_SEC) : MASK_OUTLINE_MAX_DURATION_SEC
  // The epsilon absorbs float noise (a 10.0000001 s probe is 2 units, not 3).
  return Math.max(1, Math.ceil(sec / MASK_OUTLINE_UNIT_SEC - 1e-6))
}

export type MaskOutlineLength =
  | { readonly ok: true; readonly durationSec: number; readonly units: number }
  | { readonly ok: false; readonly code: "invalid_video_duration" | "video_duration_exceeds_limit"; readonly message: string }

export async function measureMaskOutlineLength(url: string): Promise<MaskOutlineLength> {
  let durationSec: number
  try {
    durationSec = (await probeVideoSource(url)).durationSeconds
  } catch {
    return { ok: false, code: "invalid_video_duration", message: "Could not read the video. The file may be corrupted or an unsupported format." }
  }
  if (durationSec > MASK_OUTLINE_MAX_DURATION_SEC) {
    return {
      ok: false,
      code: "video_duration_exceeds_limit",
      message: `The video is ${Math.ceil(durationSec)} seconds. Mask Outline takes up to ${MASK_OUTLINE_MAX_DURATION_SEC} seconds.`,
    }
  }
  return { ok: true, durationSec, units: maskOutlineUnits(durationSec) }
}

/** BASE credits for `units` pricing units: the `mask-outline` row (one unit) times the count (`unitRateBaseCredits`). */
export async function maskOutlineBaseCredits(units: number): Promise<number> {
  return unitRateBaseCredits("mask-outline", Math.max(1, units))
}
