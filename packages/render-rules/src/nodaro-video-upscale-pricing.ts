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
  isNodaroVideoUpscaleTier,
  type NodaroVideoUpscaleTier,
} from "@nodaro/shared/models"
import { normalizeVideoUpscaleResolution } from "@nodaro/shared/model-catalog"

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
 * The whole seconds a clip of `measuredSec` is billed for: its length rounded
 * up to a whole second, at least one. THE one place the rounding lives — how
 * a fraction of a second is billed is provisional until measured, and a change
 * here moves every lane (route, quote, workflow run, estimates) together.
 */
export function nodaroVideoUpscaleBilledSec(measuredSec: number): number {
  return Math.max(1, Math.ceil(measuredSec))
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
 * Is the clip the graph gives past the longest clip a run takes
 * ({@link NODARO_VIDEO_UPSCALE_MAX_SEC})? Such a run is refused before
 * anything is held, so no estimate prices it (decided 2026-11-12): the
 * server's run estimate leaves it out, the editor's Run confirm says the node
 * is not priced, and the node's pill shows no figure. A length the graph does
 * not know is never refused here — the run measures the clip.
 */
export function nodaroVideoUpscaleRefusesLength(durationSec: number | null | undefined): boolean {
  const sec = knownSec(durationSec)
  return sec !== undefined && sec > NODARO_VIDEO_UPSCALE_MAX_SEC
}

/**
 * The units an ESTIMATE quotes before the clip is measured (the editor's
 * badge, the server's run estimate): the length the graph gives (else
 * {@link NODARO_VIDEO_UPSCALE_ESTIMATE_FALLBACK_SEC}), billed as a run bills it.
 * Undefined for a length a run refuses ({@link nodaroVideoUpscaleRefusesLength}):
 * no estimate prices that run. The run itself measures the real clip.
 */
export function nodaroVideoUpscaleEstimateUnits(durationSec: number | null | undefined): number | undefined {
  if (nodaroVideoUpscaleRefusesLength(durationSec)) return undefined
  return nodaroVideoUpscaleUnits(nodaroVideoUpscaleBilledSec(knownSec(durationSec) ?? NODARO_VIDEO_UPSCALE_ESTIMATE_FALLBACK_SEC))
}

/**
 * The tier a request's or a node's `targetResolution` runs at — coerced as
 * every lane coerces it (`normalizeVideoUpscaleResolution`: "2K" is 2k, a value
 * this provider does not take is its default), unset = the default tier.
 */
export function nodaroVideoUpscaleTierOf(targetResolution: unknown): NodaroVideoUpscaleTier {
  const { targetResolution: tier } = normalizeVideoUpscaleResolution(NODARO_VIDEO_UPSCALE_PROVIDER, targetResolution)
  return isNodaroVideoUpscaleTier(tier) ? tier : NODARO_VIDEO_UPSCALE_DEFAULT_TIER
}
