/**
 * How a Motion Transfer run is priced (decided 2026-11-18): from the length of
 * its DRIVING video as the server reads it, never a length the caller
 * declares.
 *
 * - Every model is refused below {@link MOTION_TRANSFER_MIN_SEC} and past its
 *   limit ({@link motionTransferMaxSec}: Kling 2.6 and Kling 3.0 take 10
 *   seconds while the character keeps the image's orientation — the default —
 *   and 30 while it follows the video's; Wan Animate takes 30). A clip up to
 *   `CLIP_PRICE_GRACE_SEC` past a limit is accepted and priced at it.
 * - Every model and size is charged per second of that video
 *   ({@link MOTION_TRANSFER_SECOND_RATES}): its rate row × the billed seconds
 *   ÷ the seconds the row prices, rounded up once, marked up once — the hold
 *   IS the charge.
 * - Wan Animate keeps its flat price by size as a FLOOR: a run is charged the
 *   larger of its rate's figure and its floor row, compared as base credits
 *   ({@link motionTransferChargedPrice}), and the run is
 *   charged at the row that won — the floor row once, or the rate row × its
 *   units — so the usage log, the whole-run quote id (`<rate>:<N>u`) and the
 *   flat row's own price each name exactly what was charged.
 *
 * Billed seconds are the length rounded up to a whole second after the house
 * grace ({@link motionTransferBilledSeconds}). The route, the workflow run,
 * the MCP verb (which calls the route) and both estimates read this one
 * module. The old length-tier rows (`buildMotionCreditModelIdentifier`) are no
 * run's price any more; they stay for older code and saved quotes.
 */
import { motionTransferResolution } from "./credit-identifiers.js"
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

/** A per-second rate: the row that prices `rateSeconds` seconds of driving video, and the floor a run of it never goes below. */
export interface MotionTransferSecondRate {
  readonly rateId: string
  readonly rateSeconds: number
  /**
   * The row a run of this model and size is never charged below (Wan Animate:
   * its flat price for the size the request names); absent when the rate
   * alone prices the run (Kling).
   */
  readonly floorId?: string
}

/** Every rate row prices four seconds, so its value stays a whole credit and dividing by 4 is exact in floating point. */
const PER_4S = 4

/**
 * The rate of every model and size, keyed `<provider>:<charged size>`.
 * Wan Animate Move runs at 720p only (its catalog entry lists that one size,
 * so `motionTransferResolution` sends and charges any size it names as 720p).
 */
export const MOTION_TRANSFER_SECOND_RATES: Readonly<Record<string, MotionTransferSecondRate>> = {
  "kling:720p": { rateId: "motion-transfer:720p:per-4s", rateSeconds: PER_4S },
  "kling:1080p": { rateId: "motion-transfer:1080p:per-4s", rateSeconds: PER_4S },
  "kling-3.0:720p": { rateId: "kling-3.0-motion:720p:per-4s", rateSeconds: PER_4S },
  "kling-3.0:1080p": { rateId: "kling-3.0-motion:1080p:per-4s", rateSeconds: PER_4S },
  "wan-animate-replace:480p": { rateId: "wan-animate-replace:480p:per-4s", rateSeconds: PER_4S, floorId: "wan-animate-replace" },
  "wan-animate-replace:580p": { rateId: "wan-animate-replace:580p:per-4s", rateSeconds: PER_4S, floorId: "wan-animate-replace:580p" },
  "wan-animate-replace:720p": { rateId: "wan-animate-replace:720p:per-4s", rateSeconds: PER_4S, floorId: "wan-animate-replace:720p" },
  "wan-animate-move:720p": { rateId: "wan-animate-move:720p:per-4s", rateSeconds: PER_4S, floorId: "wan-animate-move:720p" },
}

/** Every per-second rate row, once each. */
export const MOTION_TRANSFER_RATE_IDS: readonly string[] = [...new Set(Object.values(MOTION_TRANSFER_SECOND_RATES).map((r) => r.rateId))]

/** Every floor row a per-second rate names, once each. */
export const MOTION_TRANSFER_FLOOR_IDS: readonly string[] = [
  ...new Set(Object.values(MOTION_TRANSFER_SECOND_RATES).flatMap((r) => (r.floorId === undefined ? [] : [r.floorId]))),
]

/** The model a run of `provider` runs: a model Motion Transfer has, else its default (Kling 2.6), as the route and the workflow run resolve it. */
function runProvider(provider: unknown): string {
  return typeof provider === "string" && Object.keys(MOTION_TRANSFER_SECOND_RATES).some((k) => k.startsWith(`${provider}:`)) ? provider : "kling"
}

/**
 * The size a run is CHARGED at: the size it runs at (`motionTransferResolution`),
 * and for Kling any size but 1080p is charged as 720p (its rows have no other).
 */
function chargedSize(provider: string, resolution: unknown): string {
  const sized = motionTransferResolution(provider, typeof resolution === "string" && resolution !== "" ? resolution : "720p").resolution
  if (isWanAnimate(provider)) return sized
  return sized === "1080p" ? "1080p" : "720p"
}

/** The per-second rate a run of `provider` at `resolution` is charged at; a model Motion Transfer does not have is priced as its default (Kling 2.6). */
export function motionTransferRateOf(provider: unknown, resolution: unknown): MotionTransferSecondRate {
  const model = runProvider(provider)
  const key = `${model}:${chargedSize(model, resolution)}`
  // Every size `motionTransferResolution` answers has an entry (motion-transfer-pricing.test.ts); a size it does not is priced at the model's 720p.
  return MOTION_TRANSFER_SECOND_RATES[key] ?? MOTION_TRANSFER_SECOND_RATES[`${model}:720p`]!
}

/**
 * The whole seconds a driving video read at `measuredSec` is billed for:
 * rounded up after forgiving `CLIP_PRICE_GRACE_SEC` past a whole second, at
 * least one. THE one rounding every lane reads.
 */
export function motionTransferBilledSeconds(measuredSec: number): number {
  return Math.max(1, Math.ceil(gracedMeasuredSec(measuredSec)))
}

/** A Motion Transfer run's price: the row it is charged at and, for a rate row, the units of it. */
export interface MotionTransferPrice {
  /** The row the run reserves: a per-second rate row, or (once {@link motionTransferChargedPrice} chose it) a floor row. */
  readonly creditId: string
  /** Units of the rate row the run is charged (billed seconds ÷ the rate's seconds); undefined for a floor row, charged once. */
  readonly units?: number
  /** The floor row the rate is compared with (Wan Animate) before the run is charged; undefined once chosen, and for Kling. */
  readonly floorId?: string
}

/**
 * The rate price of a run of `provider` at `resolution` whose driving video is
 * billed for `billedSeconds` whole seconds: the rate row and its units, and
 * the floor row it is compared with ({@link motionTransferChargedPrice}).
 */
export function motionTransferPrice(provider: string, resolution: unknown, billedSeconds: number): MotionTransferPrice {
  const rate = motionTransferRateOf(provider, resolution)
  return { creditId: rate.rateId, units: billedSeconds / rate.rateSeconds, ...(rate.floorId !== undefined ? { floorId: rate.floorId } : {}) }
}

/**
 * The row a run is CHARGED at — THE floor rule every lane reads: a price with
 * no floor is its rate; one with a floor is charged its floor row when the
 * floor's figure is at least the rate's figure for the run (a tie goes to the
 * floor: the same credits, at today's row), else its rate row × the units.
 * `perSecond` and `floor` must be figures of the same kind — both base credits
 * (the server: the rate row × the units rounded up once, and the floor row)
 * or both charged credits (the editor, from the server's quotes). A figure
 * that is not known leaves the rate (whose own lookup refuses an unpriced
 * row).
 */
export function motionTransferChargedPrice(
  price: MotionTransferPrice,
  figures: { readonly perSecond: number | undefined; readonly floor: number | undefined },
): MotionTransferPrice {
  const rate: MotionTransferPrice = { creditId: price.creditId, ...(price.units !== undefined ? { units: price.units } : {}) }
  if (price.floorId === undefined || figures.perSecond === undefined || figures.floor === undefined) return rate
  return figures.floor >= figures.perSecond ? { creditId: price.floorId } : rate
}

/**
 * {@link motionTransferChargedPrice} from base rows (`baseOf`: a row's base
 * credits, undefined when it is priced nowhere), with the base credits the
 * run is charged, as base credits: the rate row × the units rounded up once,
 * or the floor row.
 */
export function motionTransferBaseCharge(
  price: MotionTransferPrice,
  baseOf: (creditId: string) => number | undefined,
): MotionTransferPrice & { readonly baseCredits: number | undefined } {
  const rateBase = baseOf(price.creditId)
  const perSecond = rateBase === undefined ? undefined : Math.ceil(rateBase * (price.units ?? 1))
  const floor = price.floorId === undefined ? undefined : baseOf(price.floorId)
  const charged = motionTransferChargedPrice(price, { perSecond, floor })
  return { ...charged, baseCredits: charged.units === undefined ? floor : perSecond }
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
