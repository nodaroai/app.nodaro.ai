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
 * prices per unit, Mask Composite, and the LTX per-second rows. A speech
 * request's quote (`<model>:per-100-chars:<N>u`) is priced through its own,
 * stricter reader (`parseSpeechQuoteCreditId`), which bounds N by the model's
 * cap and follows the length-pricing flag.
 *
 * The editor's per-unit estimators (frontend `PRICING_UNIT_ESTIMATORS`) are
 * held to this list by the shared fixture `tools/fixtures/unit-quote-cases.json`:
 * a per-unit node whose rate is missing here is quoted at the upper bound, and
 * the parity suites fail.
 */
import {
  LTX_EXTEND_PER_SECOND_CREDIT_ID,
  LTX_RETAKE_PER_SECOND_CREDIT_ID,
  RENDER_NODE_TYPES,
  isSpeechLengthPriceId,
  parseSpeechQuoteCreditId,
  parseUnitQuoteCreditId,
  type UnitQuoteCreditIdParts,
} from "@nodaro/shared"
import { VIDEO_UTILITY_JOB_NAMES } from "./video-utility-credits.js"

/** The largest unit count a quote id may name: far above any run (a 180-minute render, a 300-second clip in 5-second steps). */
export const UNIT_QUOTE_MAX_UNITS = 100_000

/** The rates a whole-run quote may name. */
export const UNIT_QUOTE_RATE_IDS: ReadonlySet<string> = new Set([
  ...Object.values(RENDER_NODE_TYPES).flatMap((d) => d.creditIds),
  ...VIDEO_UTILITY_JOB_NAMES,
  "mask-composite",
  LTX_EXTEND_PER_SECOND_CREDIT_ID,
  LTX_RETAKE_PER_SECOND_CREDIT_ID,
])

/**
 * The (rate, units) of a whole-run quote id the server prices, or undefined:
 * not a quote id, a rate not charged per unit, a unit count out of range, or a
 * speech length price (read by the speech reader instead).
 */
export function parseRateQuoteCreditId(id: string): UnitQuoteCreditIdParts | undefined {
  if (isSpeechLengthPriceId(id)) return undefined
  const parts = parseUnitQuoteCreditId(id)
  if (!parts || !UNIT_QUOTE_RATE_IDS.has(parts.rateId) || parts.units > UNIT_QUOTE_MAX_UNITS) return undefined
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

/** The base of `units` of a rate whose one-unit base is `unitBase`: rounded up once, as a route reserves it. */
export function quoteBaseCredits(unitBase: number, units: number): number {
  return Math.ceil(unitBase * units)
}
