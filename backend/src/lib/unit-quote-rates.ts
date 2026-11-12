/**
 * The one-unit price rows a run is charged a MULTIPLE of — the rates a whole-run
 * quote id (`<rateId>:<units>u`, `@nodaro/shared` `unitQuoteCreditId`) may name.
 *
 * Every lane charges such a run as one whole: the row's base × the units,
 * rounded up, marked up ONCE at the row's own id — the route guards
 * (`creditGuard(() => rateId, { computeCredits })`), the workflow run's credit
 * overrides and the server's run estimate (`chargedCredits(prices, id, units)`).
 * The price lookups answer a quote id the same way, so a client quotes the
 * charge instead of the served one-unit price × the units (which is rounded up
 * per unit, and can come to more).
 *
 * Derived, never hand-listed per node: every render's rows
 * (`RENDER_NODE_TYPES[*].creditIds`), every video utility the shared estimator
 * prices per unit, Mask Composite, Video Overlay's video row, the LTX per-second rows, and the dubbing
 * per-minute rows (whole started minutes only, at most the longest span a dub
 * may cover — `<row>:2.5u` is not a count a dub is charged at), Speaker
 * Frames' per-block row (whole started blocks of 1,000 sampled frames), each
 * per-second lip-sync rate (`LIP_SYNC_AUDIO_RATES`: whole seconds, from the
 * model's minimum to its maximum — OmniHuman 2.0's 4 to 300), and the Nodaro
 * Video Upscale tiers' four-second rows (a quarter-unit per billed second). A
 * speech request's quote (`<model>:per-100-chars:<N>u`) is priced through its own,
 * stricter reader (`parseSpeechQuoteCreditId`), which bounds N by the model's
 * cap and follows the length-pricing flag.
 *
 * The editor's per-unit estimators (frontend `PRICING_UNIT_ESTIMATORS`) are
 * held to this list by the shared fixture `tools/fixtures/unit-quote-cases.json`:
 * a per-unit node whose rate is missing here is quoted at the upper bound, and
 * the parity suites fail.
 */
import {
  LIP_SYNC_AUDIO_RATES,
  LTX_EXTEND_PER_SECOND_CREDIT_ID,
  LTX_RETAKE_PER_SECOND_CREDIT_ID,
  VIDEO_OVERLAY_PRICING,
  isSpeechLengthPriceId,
  parseSpeechQuoteCreditId,
  parseUnitQuoteCreditId,
  type UnitQuoteCreditIdParts,
} from "@nodaro/shared/credits"
import {
  RENDER_NODE_TYPES,
} from "@nodaro/shared/nodes"
import { NODARO_VIDEO_UPSCALE_CREDIT_IDS, NODARO_VIDEO_UPSCALE_RATE_SECONDS, SPEAKER_FRAMES_CREDIT_ID, TOPAZ_VIDEO_UNIT_CREDIT_ID } from "@nodaro/render-rules"
import { NODARO_VIDEO_UPSCALE_MAX_SEC } from "@nodaro/shared/models"
import { DUBBING_MAX_MINUTES, DUBBING_MODEL_IDENTIFIERS } from "./dubbing-model.js"
import { VIDEO_UTILITY_JOB_NAMES } from "./video-utility-credits.js"

/** The largest unit count a quote id may name: far above any run (a 180-minute render, a 300-second clip in 5-second steps). */
export const UNIT_QUOTE_MAX_UNITS = 100_000

/** Which unit counts a rate's whole-run quote may name. */
export interface UnitQuoteRule {
  /** The most units a run of this rate can have. */
  readonly maxUnits: number
  /** The fewest units a run of this rate can have (a per-second lip-sync rate's minimum); 0 when any count goes. */
  readonly minUnits?: number
  /** Whether a run is charged whole units only (started minutes of a dub), so a fractional count is no run's. */
  readonly wholeUnits: boolean
}

const ANY_UNITS: UnitQuoteRule = { maxUnits: UNIT_QUOTE_MAX_UNITS, wholeUnits: false }
const DUB_MINUTES: UnitQuoteRule = { maxUnits: DUBBING_MAX_MINUTES, wholeUnits: true }
/** Speaker Frames: started blocks of 1,000 sampled frames — whole blocks only. */
const FRAME_BLOCKS: UnitQuoteRule = { maxUnits: UNIT_QUOTE_MAX_UNITS, wholeUnits: true }

/** Every rate a whole-run quote may name, with the unit counts it accepts. */
export const UNIT_QUOTE_RATES: ReadonlyMap<string, UnitQuoteRule> = new Map([
  ...[
    ...Object.values(RENDER_NODE_TYPES).flatMap((d) => d.creditIds),
    ...VIDEO_UTILITY_JOB_NAMES,
    "mask-composite",
    VIDEO_OVERLAY_PRICING.VIDEO_CREDIT_ID,
    LTX_EXTEND_PER_SECOND_CREDIT_ID,
    LTX_RETAKE_PER_SECOND_CREDIT_ID,
  ].map((id) => [id, ANY_UNITS] as const),
  // Topaz video upscale: whole Topaz units (its hold, lib/topaz-video-plan.ts).
  [TOPAZ_VIDEO_UNIT_CREDIT_ID, { maxUnits: UNIT_QUOTE_MAX_UNITS, wholeUnits: true }] as const,
  // Nodaro Video Upscale: each tier's row prices four seconds, so a run is a
  // quarter-unit per billed second (2.5 units for 10 s), up to the longest clip.
  ...Object.values(NODARO_VIDEO_UPSCALE_CREDIT_IDS).map((id) => [
    id,
    { maxUnits: NODARO_VIDEO_UPSCALE_MAX_SEC / NODARO_VIDEO_UPSCALE_RATE_SECONDS, wholeUnits: false },
  ] as const),
  ...DUBBING_MODEL_IDENTIFIERS.map((id) => [id, DUB_MINUTES] as const),
  [SPEAKER_FRAMES_CREDIT_ID, FRAME_BLOCKS] as const,
  // A per-second lip-sync rate: the whole seconds a run of it can be billed.
  ...Object.values(LIP_SYNC_AUDIO_RATES).map(
    (rate) => [rate.rateId, { maxUnits: rate.maxSeconds, minUnits: rate.minSeconds, wholeUnits: true }] as const,
  ),
])

/** The rates a whole-run quote may name. */
export const UNIT_QUOTE_RATE_IDS: ReadonlySet<string> = new Set(UNIT_QUOTE_RATES.keys())

/**
 * The (rate, units) of a whole-run quote id the server prices, or undefined:
 * not a quote id, a rate not charged per unit, a unit count the rate's runs
 * cannot have, or a speech length price (read by the speech reader instead).
 */
export function parseRateQuoteCreditId(id: string): UnitQuoteCreditIdParts | undefined {
  if (isSpeechLengthPriceId(id)) return undefined
  const parts = parseUnitQuoteCreditId(id)
  const rule = parts && UNIT_QUOTE_RATES.get(parts.rateId)
  if (!parts || !rule || parts.units > rule.maxUnits || parts.units < (rule.minUnits ?? 0) || (rule.wholeUnits && !Number.isInteger(parts.units))) return undefined
  return parts
}

/**
 * The (rate, units) of ANY whole-run quote id the price lookups answer — a
 * speech request (`<model>:per-100-chars:<N>u`, through its own reader) or a
 * per-unit rate — or undefined for every other id. The base of such an id is
 * the rate's base × the units, rounded up: the base its route reserves.
 */
export function parseQuoteCreditId(id: string): UnitQuoteCreditIdParts | undefined {
  const speech = parseSpeechQuoteCreditId(id)
  if (speech) return { rateId: speech.unitId, units: speech.units }
  return parseRateQuoteCreditId(id)
}

// The base of N units of a rate (`quoteBaseCredits`) and what a run of them is
// charged (`unitRateBaseCredits`) live beside the row lookup they read, so the
// charge and the quote compose the same two functions.
export { quoteBaseCredits, unitRateBaseCredits, unitRatePrice } from "./credit-base-cost.js"
