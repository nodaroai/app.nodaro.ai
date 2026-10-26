import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"
import { unitRateBaseCredits } from "./credit-base-cost.js"

/**
 * Mask Erase (`POST /v1/mask-erase`, decided 2026-10-26): how long the mask
 * is, and so how many pricing units an erase is charged — one `mask-erase`
 * row per started 5 seconds of the mask, the video-utility unit. The row is
 * read from `model_pricing`, so an administrator's retune reaches every unit.
 *
 * A mask that cannot be read, or is longer than any mask the platform draws
 * (`MASK_ERASE_MAX_DURATION_SEC`, Video Mask's own longest clip), is refused
 * before anything is reserved: the worker must decode it, so it would fail
 * there anyway.
 */

/** Seconds of mask one pricing unit covers. */
export const MASK_ERASE_UNIT_SEC = 5
/** The longest mask an erase accepts, seconds (Video Mask's longest clip). */
export const MASK_ERASE_MAX_DURATION_SEC = 300

/** Pricing units for a mask `durationSec` long: one per started 5 seconds, at least one. Pure. */
export function maskEraseUnits(durationSec: number): number {
  const sec = Number.isFinite(durationSec) && durationSec > 0 ? Math.min(durationSec, MASK_ERASE_MAX_DURATION_SEC) : MASK_ERASE_MAX_DURATION_SEC
  // The epsilon absorbs float noise (a 10.0000001 s probe is 2 units, not 3).
  return Math.max(1, Math.ceil(sec / MASK_ERASE_UNIT_SEC - 1e-6))
}

export type MaskEraseLength =
  | { readonly ok: true; readonly durationSec: number; readonly units: number }
  | { readonly ok: false; readonly code: "invalid_video_duration" | "video_duration_exceeds_limit"; readonly message: string }

export async function measureMaskEraseLength(url: string): Promise<MaskEraseLength> {
  let durationSec: number
  try {
    durationSec = (await probeVideoSource(url)).durationSeconds
  } catch {
    return { ok: false, code: "invalid_video_duration", message: "Could not read the mask video. The file may be corrupted or an unsupported format." }
  }
  if (durationSec > MASK_ERASE_MAX_DURATION_SEC) {
    return {
      ok: false,
      code: "video_duration_exceeds_limit",
      message: `The mask is ${Math.ceil(durationSec)} seconds. Mask Erase takes up to ${MASK_ERASE_MAX_DURATION_SEC} seconds.`,
    }
  }
  return { ok: true, durationSec, units: maskEraseUnits(durationSec) }
}

/** BASE credits for `units` pricing units: the `mask-erase` row (one unit) times the count (`unitRateBaseCredits`). */
export async function maskEraseBaseCredits(units: number): Promise<number> {
  return unitRateBaseCredits("mask-erase", Math.max(1, units))
}
