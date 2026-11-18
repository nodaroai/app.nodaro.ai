/**
 * How a Motion Transfer run is priced (decided 2026-11-18): from the length of
 * its DRIVING video as the server measures it, never a length the caller
 * declares.
 *
 * - Every model is refused below {@link MOTION_TRANSFER_MIN_SEC} and past its
 *   limit ({@link motionTransferMaxSec}: Kling 2.6 and Kling 3.0 take 10
 *   seconds while the character keeps the image's orientation — the default —
 *   and 30 while it follows the video's; Wan Animate takes 30). A clip up to
 *   `CLIP_PRICE_GRACE_SEC` past a limit is accepted and priced at it.
 * - A model and size with a per-second rate ({@link MOTION_TRANSFER_SECOND_RATES})
 *   is charged its rate row × the billed seconds ÷ the seconds the row prices,
 *   rounded up once, marked up once — the hold IS the charge.
 * - Every other model and size keeps its length tiers (Kling) or its flat
 *   price by size (Wan Animate), read from the measured length.
 *
 * Billed seconds are the measured length rounded up to a whole second after
 * the house grace ({@link motionTransferBilledSeconds}). The route, the
 * workflow run, the MCP verb (which calls the route) and both estimates read
 * this one module.
 */
import { buildMotionCreditModelIdentifier, motionTransferResolution } from "./credit-identifiers.js"
import { CLIP_PRICE_GRACE_SEC, gracedMeasuredSec } from "./priced-clip-seconds.js"

/** Float noise: a length that is arithmetic can land a hair past a limit, and must not be refused for it. */
const FLOAT_NOISE_SEC = 1e-9

/** The shortest driving video any Motion Transfer model takes. */
export const MOTION_TRANSFER_MIN_SEC = 3

/** The longest driving video Kling 2.6 / Kling 3.0 take while the character keeps the image's orientation. */
export const MOTION_TRANSFER_IMAGE_ORIENTATION_MAX_SEC = 10

/** The longest driving video any Motion Transfer model takes (Kling following the video's orientation, Wan Animate). */
export const MOTION_TRANSFER_MAX_SEC = 30

/** The orientation a run uses: `"video"` only when it says so; anything else (absent included) is the default, `"image"`. */
export function motionTransferOrientation(characterOrientation: unknown): "image" | "video" {
  return characterOrientation === "video" ? "video" : "image"
}

const isWanAnimate = (provider: string): boolean => provider === "wan-animate-move" || provider === "wan-animate-replace"

/** The longest driving video a run of `provider` at `characterOrientation` takes. */
export function motionTransferMaxSec(provider: string, characterOrientation: unknown): number {
  if (isWanAnimate(provider)) return MOTION_TRANSFER_MAX_SEC
  return motionTransferOrientation(characterOrientation) === "video" ? MOTION_TRANSFER_MAX_SEC : MOTION_TRANSFER_IMAGE_ORIENTATION_MAX_SEC
}

/** A per-second rate: the row that prices `rateSeconds` seconds of driving video. */
export interface MotionTransferSecondRate {
  readonly rateId: string
  readonly rateSeconds: number
}

/**
 * The models and sizes charged per second of their driving video, keyed
 * `<provider>:<charged size>`. Giving another model and size a per-second rate
 * is one entry here (plus its row); a model and size with no entry keeps its
 * tiers. A row prices four seconds so its value stays a whole credit, and
 * dividing by 4 is exact in floating point.
 */
export const MOTION_TRANSFER_SECOND_RATES: Readonly<Record<string, MotionTransferSecondRate>> = {
  "kling-3.0:720p": { rateId: "kling-3.0-motion:720p:per-4s", rateSeconds: 4 },
}

/** Every per-second rate row. */
export const MOTION_TRANSFER_RATE_IDS: readonly string[] = Object.values(MOTION_TRANSFER_SECOND_RATES).map((r) => r.rateId)

/**
 * The size a run is CHARGED at: the size it runs at (`motionTransferResolution`),
 * and for Kling any size but 1080p is charged as 720p (its rows have no other).
 */
function chargedSize(provider: string, resolution: unknown): string {
  const sized = motionTransferResolution(provider, typeof resolution === "string" && resolution !== "" ? resolution : "720p").resolution
  if (isWanAnimate(provider)) return sized
  return sized === "1080p" ? "1080p" : "720p"
}

/** The per-second rate a run of `provider` at `resolution` is charged at, or undefined for one priced by its tiers. */
export function motionTransferRateOf(provider: unknown, resolution: unknown): MotionTransferSecondRate | undefined {
  if (typeof provider !== "string") return undefined
  const key = `${provider}:${chargedSize(provider, resolution)}`
  return Object.prototype.hasOwnProperty.call(MOTION_TRANSFER_SECOND_RATES, key) ? MOTION_TRANSFER_SECOND_RATES[key] : undefined
}

/**
 * The whole seconds a driving video measured at `measuredSec` is billed for:
 * rounded up after forgiving `CLIP_PRICE_GRACE_SEC` past a whole second, at
 * least one. THE one rounding every lane reads.
 */
export function motionTransferBilledSeconds(measuredSec: number): number {
  return Math.max(1, Math.ceil(gracedMeasuredSec(measuredSec)))
}

/** A Motion Transfer run's price: the row it reserves and, for a per-second rate, the units of that row. */
export interface MotionTransferPrice {
  /** The row the run reserves (a tier, Wan Animate's size row, or a per-second rate row). */
  readonly creditId: string
  /** Units of the row the run is charged (billed seconds ÷ the rate's seconds); undefined for a row charged once. */
  readonly units?: number
}

/**
 * The price of a run of `provider` at `resolution` whose driving video is
 * billed for `billedSeconds` whole seconds.
 */
export function motionTransferPrice(provider: string, resolution: unknown, billedSeconds: number): MotionTransferPrice {
  const rate = motionTransferRateOf(provider, resolution)
  if (rate) return { creditId: rate.rateId, units: billedSeconds / rate.rateSeconds }
  return { creditId: buildMotionCreditModelIdentifier(provider, typeof resolution === "string" && resolution !== "" ? resolution : "720p", billedSeconds) }
}

/** What the length check answers for a measured driving video. */
export type MotionTransferLengthCheck =
  | { readonly ok: true; readonly billedSeconds: number }
  | { readonly ok: false; readonly code: "video_too_short" | "video_too_long"; readonly message: string }

/**
 * Whether a driving video measured at `measuredSec` can run on `provider` at
 * `characterOrientation`, and the seconds it is billed for. Shorter than
 * {@link MOTION_TRANSFER_MIN_SEC} is refused; past the limit by more than
 * `CLIP_PRICE_GRACE_SEC` is refused; a clip within that grace is billed at the
 * limit.
 */
export function checkMotionTransferLength(provider: string, characterOrientation: unknown, measuredSec: number): MotionTransferLengthCheck {
  if (measuredSec < MOTION_TRANSFER_MIN_SEC) {
    return {
      ok: false,
      code: "video_too_short",
      message: `The motion video is ${measuredSec.toFixed(1)} seconds. Motion Transfer needs a motion video of at least ${MOTION_TRANSFER_MIN_SEC} seconds.`,
    }
  }
  const max = motionTransferMaxSec(provider, characterOrientation)
  if (measuredSec > max + CLIP_PRICE_GRACE_SEC + FLOAT_NOISE_SEC) {
    const followVideo = !isWanAnimate(provider) && motionTransferOrientation(characterOrientation) === "image"
      ? ` (or ${MOTION_TRANSFER_MAX_SEC} seconds with the character following the video's orientation)`
      : ""
    return {
      ok: false,
      code: "video_too_long",
      message: `The motion video is ${measuredSec.toFixed(1)} seconds. This model takes at most ${max} seconds${followVideo}. Trim the video first.`,
    }
  }
  return { ok: true, billedSeconds: Math.min(max, motionTransferBilledSeconds(measuredSec)) }
}

/**
 * The billed seconds an ESTIMATE quotes before the video is measured: the
 * length the graph gives, at most the limit, billed as a run bills it; a
 * length it does not know quotes the limit — the most the run can be charged
 * (decided 2026-11-18), marked as an estimate by the caller.
 */
export function motionTransferEstimateSeconds(provider: string, characterOrientation: unknown, knownSec?: number | null): number {
  const max = motionTransferMaxSec(provider, characterOrientation)
  if (knownSec == null || !Number.isFinite(knownSec) || knownSec <= 0) return max
  return Math.min(max, motionTransferBilledSeconds(Math.max(MOTION_TRANSFER_MIN_SEC, knownSec)))
}

/** The price an estimate quotes ({@link motionTransferEstimateSeconds}), and whether it stood in for an unknown length. */
export function motionTransferEstimatePrice(
  provider: string,
  resolution: unknown,
  characterOrientation: unknown,
  knownSec?: number | null,
): MotionTransferPrice & { readonly lengthKnown: boolean } {
  const lengthKnown = knownSec != null && Number.isFinite(knownSec) && knownSec > 0
  return { ...motionTransferPrice(provider, resolution, motionTransferEstimateSeconds(provider, characterOrientation, knownSec)), lengthKnown }
}
