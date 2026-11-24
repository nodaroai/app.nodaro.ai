/**
 * fal.ai provider pricing.
 *
 * fal bills per endpoint in one of three shapes:
 *  - `per_second` — `rate` is USD per second of OUTPUT media (e.g. lip-sync,
 *    video generation). Cost = seconds × rate.
 *  - `per_image`  — `rate` is USD per generated image. Cost = images × rate
 *    (defaults to 1 image when the caller doesn't pass a count).
 *  - `flat`       — fixed USD per request regardless of output size.
 *  - `per_16_frames` — `rate` is USD per started block of 16 INPUT frames
 *    (SAM 3 video). Cost = ceil(frames / 16) × rate.
 *
 * `FAL_PRICING` is keyed by our internal model id (NOT the fal endpoint slug) so
 * the rest of the codebase keeps a stable identifier even if fal renames an
 * endpoint. `falCostUsd` returns the raw provider USD cost (no markup) — the
 * credit layer applies markup downstream, mirroring the Replicate `extractCost`
 * convention. Unknown ids return `null` (cost unknown) rather than 0 so callers
 * can distinguish "free" from "not priced".
 */

export type FalBillingUnit = "per_second" | "per_image" | "flat" | "per_16_frames"

export interface FalPrice {
  unit: FalBillingUnit
  /** USD rate. Meaning depends on `unit` (per second / per image / flat). */
  rate: number
}

/**
 * fal endpoint pricing, keyed by our internal model id.
 * `sync-lipsync-v3` → fal endpoint `fal-ai/sync-lipsync/v3`, $0.13333/output-second.
 * `video-depth-anything` → fal endpoint `fal-ai/depth-anything-video`, $0.04/output-second.
 */
export const FAL_PRICING: Record<string, FalPrice> = {
  "sync-lipsync-v3": { unit: "per_second", rate: 0.13333 },
  "video-depth-anything": { unit: "per_second", rate: 0.04 },
  // `sam-3-video` → fal endpoint `fal-ai/sam-3/video-rle`.
  "sam-3-video": { unit: "per_16_frames", rate: 0.005 },
  // `sam-3.1-video` → fal endpoint `fal-ai/sam-3-1/video-rle`.
  "sam-3.1-video": { unit: "per_16_frames", rate: 0.01 },
  // `topaz-rhea:<target>` → fal endpoint `topaz/upscale/video/precision`
  // (model Rhea), per second of OUTPUT by the target's size, as fal lists it.
  "topaz-rhea:720p": { unit: "per_second", rate: 0.01 },
  "topaz-rhea:1080p": { unit: "per_second", rate: 0.02 },
  "topaz-rhea:4k": { unit: "per_second", rate: 0.06 },
}

/**
 * Compute the raw provider USD cost for a fal generation.
 *
 * @param id internal model id (a key of `FAL_PRICING`)
 * @param m  measured output: `seconds` for per_second, `images` for per_image,
 *           `frames` (input frames) for per_16_frames
 * @returns USD cost, or `null` when `id` has no pricing entry.
 */
export function falCostUsd(
  id: string,
  m: { seconds?: number; images?: number; frames?: number },
): number | null {
  const price = FAL_PRICING[id]
  if (!price) return null
  switch (price.unit) {
    case "per_second":
      return (m.seconds ?? 0) * price.rate
    case "per_image":
      return (m.images ?? 1) * price.rate
    case "flat":
      return price.rate
    case "per_16_frames":
      return Math.ceil((m.frames ?? 0) / 16) * price.rate
  }
}

/**
 * Gemini Omni Flash 1.2 Extend (`google/gemini-omni-flash/v1.2/extend`, our
 * `gemini-omni-flash-1-2-extend`): what fal bills a run, in USD, from the rates
 * measured on 2026-11-17 (fal's `x-fal-billable-units`, one unit $0.0273, which
 * the queue client does not surface): each new second at its resolution's
 * rate, plus the clip sent as input at about $0.0087 a second, plus the
 * model's thinking — measured at about $0.006 at 360p and $0.0098 at 720p (a
 * 4.06 s clip + 3 s billed 4.514 units at 360p and 10.651 at 720p). 1080p and
 * 4K were not measured: they take the 720p allowance, the larger one seen, so
 * the recorded cost is not understated there. Display and anomaly only: the
 * credit charge is the run's rows, never this.
 */
export const FAL_GEMINI_OMNI_EXTEND_USD_PER_ADDED_SEC: Readonly<Record<string, number>> = {
  "360p": 0.0273,
  "720p": 0.0819,
  "1080p": 0.1229,
  "4k": 0.2457,
}
const FAL_GEMINI_OMNI_EXTEND_USD_PER_SENT_SEC = 0.0087
/** The thinking allowance by resolution: measured at 360p and 720p; 1080p and 4K take 720p's (not measured). */
const FAL_GEMINI_OMNI_EXTEND_USD_THINKING: Readonly<Record<string, number>> = {
  "360p": 0.006,
  "720p": 0.0098,
  "1080p": 0.0098,
  "4k": 0.0098,
}

/** fal's bill for one Gemini Omni Flash 1.2 Extend run, in USD (null for a resolution it does not render). */
export function falGeminiOmniExtendCostUsd(m: { resolution: string; sentSec: number; addedSec: number }): number | null {
  const perAdded = FAL_GEMINI_OMNI_EXTEND_USD_PER_ADDED_SEC[m.resolution]
  if (perAdded === undefined) return null
  return perAdded * m.addedSec + FAL_GEMINI_OMNI_EXTEND_USD_PER_SENT_SEC * m.sentSec + FAL_GEMINI_OMNI_EXTEND_USD_THINKING[m.resolution]!
}
