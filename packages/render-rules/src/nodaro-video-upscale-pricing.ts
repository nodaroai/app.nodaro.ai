/**
 * How a Nodaro Video Upscale run is priced (decided 2026-11-11).
 *
 * A flat price per second of the clip, by tier: 3.75 (1080p), 7.5 (2K) and
 * 15 (4K) base credits a second. The run is charged the clip's billed seconds
 * at its tier's rate, the total rounded up to a whole credit ONCE, then marked
 * up once by the deployment's pricing settings — the hold IS the charge (the
 * clip is measured before anything is held, and the price does not depend on
 * anything the run learns later).
 *
 * `model_pricing.credit_cost` holds whole credits, so a rate like 3.75 cannot be
 * a row. Each tier's row is therefore the price of FOUR seconds (15 / 30 / 60)
 * and a run is `unitRateBaseCredits(row, billedSec / 4)`: the row × a quarter
 * per second, one rounding at the end. Dividing by 4 is exact in binary
 * floating point, so the product never lands a hair above a whole credit (a
 * per-100-seconds row would: 375 × 0.04 = 15.000000000000002). The rows are
 * admin-editable like any other; a retune moves the hold, the quote and the
 * charge together.
 */
import {
  NODARO_VIDEO_UPSCALE_DEFAULT_TIER,
  NODARO_VIDEO_UPSCALE_MAX_SEC,
  NODARO_VIDEO_UPSCALE_PROVIDER,
  NODARO_VIDEO_UPSCALE_TRANSPARENT_TIERS,
  NODARO_VIDEO_UPSCALE_TRANSPARENT_MAX_FACTOR,
  isNodaroVideoUpscaleTier,
  nodaroVideoUpscaleBoxFor,
  nodaroVideoUpscaleModeTakes,
  type NodaroVideoUpscaleMode,
  type NodaroVideoUpscaleModeTier,
  type NodaroVideoUpscaleTier,
  type TopazVideoResolution,
} from "@nodaro/shared/models"
import { rheaExpectedFrame, topazRheaBilledSec, TOPAZ_RHEA_FALLBACK_FPS, TOPAZ_RHEA_MAX_OUTPUT_GIGAPIXELS } from "./topaz-rhea-pricing"
import { normalizeVideoUpscaleResolution } from "@nodaro/shared/model-catalog"
import { CONTAINER_FALLBACK_GRACE_SEC } from "./made-clip-overshoot"
import type { MeasuredFileReading } from "./video-output-length"

/** The seconds one rate row prices. */
export const NODARO_VIDEO_UPSCALE_RATE_SECONDS = 4

/** The rate row of each tier: the price of {@link NODARO_VIDEO_UPSCALE_RATE_SECONDS} seconds. */
export const NODARO_VIDEO_UPSCALE_CREDIT_IDS: Readonly<Record<NodaroVideoUpscaleTier, string>> = {
  "1080p": "nodaro-video-upscale:1080p:per-4s",
  "2k": "nodaro-video-upscale:2k:per-4s",
  "4k": "nodaro-video-upscale:4k:per-4s",
}

/** The rate row a run at `tier` is charged a multiple of. */
export function nodaroVideoUpscaleCreditId(tier: NodaroVideoUpscaleTier): string {
  return NODARO_VIDEO_UPSCALE_CREDIT_IDS[tier]
}

/** Is `id` one of the tiers' rate rows? */
export function isNodaroVideoUpscaleCreditId(id: unknown): boolean {
  return typeof id === "string" && (Object.values(NODARO_VIDEO_UPSCALE_CREDIT_IDS) as string[]).includes(id)
}

/**
 * How far past a whole second a clip measured by its CONTAINER is still billed
 * as that second: a run bills the video stream's length, and only when that
 * cannot be read does it measure the container, which a made clip's audio can
 * run past its planned length by up to this much (`MADE_CLIP_OVERSHOOT_SEC`).
 * A quote reads a made clip at its planned length plus one frame, so without
 * this a container a hair past a second would bill a second the quote did not
 * name.
 */
export const NODARO_VIDEO_UPSCALE_CONTAINER_GRACE_SEC = CONTAINER_FALLBACK_GRACE_SEC

/** Float noise: a container length that is arithmetic can land a hair past the edge, and must not round up for it. */
const FLOAT_NOISE_SEC = 1e-9

/**
 * The whole seconds a clip of `measuredSec` is billed for, by what was
 * measured (`reading`): the video stream's length rounded up to a whole
 * second, at least one; the container's (a clip whose stream length could not
 * be read) less {@link NODARO_VIDEO_UPSCALE_CONTAINER_GRACE_SEC} first. THE one
 * place the rounding lives — how a fraction of a second is billed is
 * provisional until measured, and a change here moves every lane (route,
 * quote, workflow run, estimates) together.
 */
export function nodaroVideoUpscaleBilledSec(measuredSec: number, reading: MeasuredFileReading = "video-stream"): number {
  const sec = reading === "container" ? measuredSec - NODARO_VIDEO_UPSCALE_CONTAINER_GRACE_SEC - FLOAT_NOISE_SEC : measuredSec
  return Math.max(1, Math.ceil(sec))
}

/** The units of the tier's rate row a clip billed for `billedSec` whole seconds is charged. */
export function nodaroVideoUpscaleUnits(billedSec: number): number {
  return billedSec / NODARO_VIDEO_UPSCALE_RATE_SECONDS
}

/** The clip length an estimate prices when the graph does not know it (as Topaz's estimate). */
export const NODARO_VIDEO_UPSCALE_ESTIMATE_FALLBACK_SEC = 10

/** A length the graph gives, when it is one: finite and above 0. */
function knownSec(durationSec: number | null | undefined): number | undefined {
  return durationSec != null && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : undefined
}

/**
 * Is the clip the graph KNOWS past the longest clip a run takes
 * ({@link NODARO_VIDEO_UPSCALE_MAX_SEC})? Such a run is refused before
 * anything is held, so no estimate prices it (decided 2026-11-12): the
 * server's run estimate leaves it out, the editor's Run confirm says the node
 * is not priced, and the node's pill shows no figure. Pass only a length the
 * graph knows (an upload, a measured Library clip, a take's recorded length:
 * the measured walk's `knownOnly` reading). A planned length is an upper bound
 * (a slack per clip made, Combine Videos' trims not taken off), never proof a
 * run is refused: it is quoted at the cap instead
 * ({@link nodaroVideoUpscaleEstimateUnits}). A length the graph does not know
 * is never refused here — the run measures the clip.
 */
export function nodaroVideoUpscaleRefusesLength(durationSec: number | null | undefined): boolean {
  const sec = knownSec(durationSec)
  return sec !== undefined && sec > NODARO_VIDEO_UPSCALE_MAX_SEC
}

/**
 * The units an ESTIMATE quotes before the clip is measured (the editor's
 * badge, the server's run estimate): the length the graph gives — the measured
 * walk's, planned lengths included — (else
 * {@link NODARO_VIDEO_UPSCALE_ESTIMATE_FALLBACK_SEC}), at most the longest clip
 * a run takes, billed as a run bills it. A planned length past that limit is
 * quoted at it: the run then bills at most that, or refuses the clip and
 * charges nothing. A KNOWN length past the limit is no run at all; the callers
 * leave it out first ({@link nodaroVideoUpscaleRefusesLength}).
 */
export function nodaroVideoUpscaleEstimateUnits(durationSec: number | null | undefined): number {
  const sec = knownSec(durationSec) ?? NODARO_VIDEO_UPSCALE_ESTIMATE_FALLBACK_SEC
  return nodaroVideoUpscaleUnits(nodaroVideoUpscaleBilledSec(Math.min(sec, NODARO_VIDEO_UPSCALE_MAX_SEC)))
}

/**
 * The tier a request's or a node's `targetResolution` runs at — coerced as
 * every lane coerces it (`normalizeVideoUpscaleResolution`: "2K" is 2k, a value
 * this provider does not take is its default), unset = the default tier.
 */
export function nodaroVideoUpscaleTierOf(targetResolution: unknown): NodaroVideoUpscaleTier {
  const { targetResolution: tier } = normalizeVideoUpscaleResolution(NODARO_VIDEO_UPSCALE_PROVIDER, targetResolution, "sharp")
  return isNodaroVideoUpscaleTier(tier) ? tier : NODARO_VIDEO_UPSCALE_DEFAULT_TIER
}

// ─── Modes (decided 2026-11-24) ─────────────────────────────────────────
//
// SHARP is everything above, unchanged: the tier's four-second row × whole
// billed seconds ÷ 4. TRANSPARENT has its own one-second rows, one per tier
// ({@link NODARO_VIDEO_UPSCALE_TRANSPARENT_CREDIT_IDS}; 2K seeded at 4K's
// rate, a row of its own so it can be retuned), × the clip's exact length
// (`topazRheaBilledSec`, 1/64 s steps), rounded up once. Every lane reads the mode through
// `nodaroVideoUpscaleModeOf` (@nodaro/shared) and the price through the three
// functions below, so no lane can price one mode and run the other.

/**
 * The tier a request's or a node's `targetResolution` runs at in `mode`:
 * coerced as every lane coerces it (`normalizeVideoUpscaleResolution` with the
 * mode: "2K" is 2k, a tier the mode does not take — sharp's 720p — is the
 * default), unset = 1080p in both modes.
 */
export function nodaroVideoUpscaleModeTierOf(mode: NodaroVideoUpscaleMode, targetResolution: unknown): NodaroVideoUpscaleModeTier {
  if (mode === "sharp") return nodaroVideoUpscaleTierOf(targetResolution)
  const { targetResolution: tier } = normalizeVideoUpscaleResolution(NODARO_VIDEO_UPSCALE_PROVIDER, targetResolution, mode)
  return nodaroVideoUpscaleModeTakes(mode, tier) ? tier : NODARO_VIDEO_UPSCALE_DEFAULT_TIER
}

/** Transparent's own rows: the price of ONE second of the clip at each tier. */
export const NODARO_VIDEO_UPSCALE_TRANSPARENT_CREDIT_IDS: Readonly<Record<NodaroVideoUpscaleModeTier, string>> = {
  "720p": "nodaro-video-upscale:transparent:720p:per-sec",
  "1080p": "nodaro-video-upscale:transparent:1080p:per-sec",
  "2k": "nodaro-video-upscale:transparent:2k:per-sec",
  "4k": "nodaro-video-upscale:transparent:4k:per-sec",
}

/** The engine target whose listed rate records a transparent run's provider cost (2K and 4K share one). Never a price. */
export function nodaroVideoUpscaleTransparentRateTarget(tier: NodaroVideoUpscaleModeTier): TopazVideoResolution {
  return tier === "720p" || tier === "1080p" ? tier : "4k"
}

/** The row a run in `mode` at `tier` is charged a multiple of (sharp at a tier it does not take: its default's). */
export function nodaroVideoUpscaleModeCreditId(mode: NodaroVideoUpscaleMode, tier: NodaroVideoUpscaleModeTier): string {
  if (mode === "sharp") return nodaroVideoUpscaleCreditId(isNodaroVideoUpscaleTier(tier) ? tier : NODARO_VIDEO_UPSCALE_DEFAULT_TIER)
  return NODARO_VIDEO_UPSCALE_TRANSPARENT_CREDIT_IDS[tier]
}

/** The seconds a clip of `measuredSec` is billed in `mode`: whole seconds (sharp), the exact length in 1/64 s steps (transparent). */
export function nodaroVideoUpscaleModeBilledSec(mode: NodaroVideoUpscaleMode, measuredSec: number, reading: MeasuredFileReading = "video-stream"): number {
  return mode === "sharp" ? nodaroVideoUpscaleBilledSec(measuredSec, reading) : topazRheaBilledSec(measuredSec, reading)
}

/** The units of the mode's row a clip billed `billedSec` seconds is charged: a quarter per second (sharp's four-second rows), one per second (transparent). */
export function nodaroVideoUpscaleModeUnits(mode: NodaroVideoUpscaleMode, billedSec: number): number {
  return mode === "sharp" ? nodaroVideoUpscaleUnits(billedSec) : billedSec
}

/** Is `id` a row some mode of Nodaro Video Upscale is charged on? */
export function isNodaroVideoUpscaleModeCreditId(id: unknown): boolean {
  return isNodaroVideoUpscaleCreditId(id) || (typeof id === "string" && (Object.values(NODARO_VIDEO_UPSCALE_TRANSPARENT_CREDIT_IDS) as string[]).includes(id))
}

/** An estimate's units in `mode` (the length the graph gives, else 10 s, at most 60 s), billed as a run in that mode bills it. */
export function nodaroVideoUpscaleModeEstimateUnits(mode: NodaroVideoUpscaleMode, durationSec: number | null | undefined): number {
  if (mode === "sharp") return nodaroVideoUpscaleEstimateUnits(durationSec)
  const sec = knownSec(durationSec) ?? NODARO_VIDEO_UPSCALE_ESTIMATE_FALLBACK_SEC
  return nodaroVideoUpscaleModeUnits(mode, topazRheaBilledSec(Math.min(sec, NODARO_VIDEO_UPSCALE_MAX_SEC)))
}

/** What a transparent run at `tier` does with a source of this size: the factor it sends, or why it is refused. */
export type NodaroVideoUpscaleTransparentPlan =
  | { readonly ok: true; readonly factor: number; readonly frame: { readonly width: number; readonly height: number } }
  | { readonly ok: false; readonly reason: "already_at_tier" }
  | { readonly ok: false; readonly reason: "too_small"; readonly largestTier: NodaroVideoUpscaleModeTier | undefined }

/** The decimals the factor is sent with (rounded UP, so the frame reaches the box; the delivery trims any overshoot). */
const FACTOR_SCALE = 10_000

/** The exact factor that fits a clip inside a box (the largest that keeps both sides within it). */
function fitFactor(source: { readonly width: number; readonly height: number }, box: { readonly width: number; readonly height: number }): number {
  return Math.min(box.width / source.width, box.height / source.height)
}

/**
 * Transparent's factor (decided 2026-11-24): the largest that fits the clip
 * INSIDE the tier's box — the same box Sharp delivers into
 * (`nodaroVideoUpscaleBoxFor`: 1280×720, 1920×1080, 2560×1440 or 3840×2160,
 * turned for a portrait clip) — so one tier is one frame in either mode. Sent
 * rounded up to four decimals; the delivered frame is source × factor, each
 * side even, never past the box. Refused when the clip already fills the box
 * (an exact factor of 1 or less), and when it would need more than 4× (naming
 * the largest tier 4× reaches, if any) — never a smaller frame than the tier
 * promises. The bare `topaz-rhea` provider keeps its short-side rule.
 */
export function nodaroVideoUpscaleTransparentPlan(
  source: { readonly width: number; readonly height: number },
  tier: NodaroVideoUpscaleModeTier,
): NodaroVideoUpscaleTransparentPlan {
  if (!(source.width > 0) || !(source.height > 0)) return { ok: false, reason: "already_at_tier" }
  const exact = fitFactor(source, nodaroVideoUpscaleBoxFor(source, tier))
  if (exact <= 1) return { ok: false, reason: "already_at_tier" }
  if (exact > NODARO_VIDEO_UPSCALE_TRANSPARENT_MAX_FACTOR) {
    const reachable = NODARO_VIDEO_UPSCALE_TRANSPARENT_TIERS.filter((t) => {
      const f = fitFactor(source, nodaroVideoUpscaleBoxFor(source, t))
      return f > 1 && f <= NODARO_VIDEO_UPSCALE_TRANSPARENT_MAX_FACTOR
    })
    return { ok: false, reason: "too_small", largestTier: reachable[reachable.length - 1] }
  }
  const factor = Math.ceil(exact * FACTOR_SCALE - 1e-6) / FACTOR_SCALE
  const box = nodaroVideoUpscaleBoxFor(source, tier)
  const frame = rheaExpectedFrame(source, factor)
  return { ok: true, factor, frame: { width: Math.min(frame.width, box.width), height: Math.min(frame.height, box.height) } }
}

/**
 * Can Transparent serve this clip at this tier, from what is known of it: its
 * displayed frame (needed: `undefined` without it — not known), and, when
 * known, its frame rate and length for the output bound
 * (`TOPAZ_RHEA_MAX_OUTPUT_GIGAPIXELS`). False when the clip already fills the
 * tier's frame, would need more than 4×, or is past the bound. Fed to
 * `nodaroVideoUpscaleEffectiveMode` by every lane.
 */
export function nodaroVideoUpscaleTransparentServes(
  clip: { readonly width: number; readonly height: number; readonly fps?: number; readonly sec?: number } | undefined,
  tier: NodaroVideoUpscaleModeTier,
): boolean | undefined {
  if (!clip || !(clip.width > 0) || !(clip.height > 0)) return undefined
  const planned = nodaroVideoUpscaleTransparentPlan(clip, tier)
  if (!planned.ok) return false
  if (clip.sec !== undefined && Number.isFinite(clip.sec) && clip.sec > 0) {
    const fps = clip.fps !== undefined && Number.isFinite(clip.fps) && clip.fps > 0 ? clip.fps : TOPAZ_RHEA_FALLBACK_FPS
    if ((planned.frame.width * planned.frame.height * Math.ceil(clip.sec * fps)) / 1e9 > TOPAZ_RHEA_MAX_OUTPUT_GIGAPIXELS) return false
  }
  return true
}
