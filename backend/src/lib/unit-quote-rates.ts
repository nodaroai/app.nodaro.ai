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
 * model's minimum to its maximum — OmniHuman 2.0's 4 to 300), the Nodaro
 * Video Upscale tiers' four-second rows (a quarter-unit per billed second),
 * Motion Transfer's per-second rows (a quarter-unit per billed second of the
 * driving video), Video to Video's clip rows (HappyHorse Edit: an eighth of a
 * unit per started half-second of the clip; Wan 2.7 VideoEdit: a quarter-unit
 * per billed second), Audio Isolation's ten-second row (whole units, 1 to 180), and the Seedance 2.5 Extend two-second rows (half a unit per second sent and
 * added). A
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
  AUDIO_ISOLATION_MAX_UNITS,
  AUDIO_ISOLATION_RATE_ID,
  LIP_SYNC_AUDIO_RATES,
  MOTION_TRANSFER_MAX_SEC,
  MOTION_TRANSFER_MIN_SEC,
  MOTION_TRANSFER_SECOND_RATES,
  HAPPYHORSE_EDIT_MAX_SEC,
  HAPPYHORSE_EDIT_MIN_SEC,
  V2V_CLIP_RATES,
  WAN_VIDEOEDIT_MAX_SEC,
  WAN_VIDEOEDIT_MIN_SEC,
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
import {
  NODARO_VIDEO_UPSCALE_CREDIT_IDS,
  NODARO_VIDEO_UPSCALE_RATE_SECONDS,
  SEEDANCE_EXTEND_CONTEXT_MAX_SEC,
  SEEDANCE_EXTEND_RATE_CREDIT_IDS_BY_PROVIDER,
  SEEDANCE_EXTEND_MIN_SOURCE_SEC,
  SEEDANCE_EXTEND_RATE_SECONDS,
  SEEDANCE_EXTEND_SENT_PRICED_PROVIDERS,
  type SentPricedSeedanceExtendProvider,
  SPEAKER_FRAMES_CREDIT_ID,
  TOPAZ_VIDEO_UNIT_CREDIT_ID,
} from "@nodaro/render-rules"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { SCAN_PAGE_CREDIT_COSTS } from "@nodaro/shared/social"
import { NODARO_VIDEO_UPSCALE_MAX_SEC } from "@nodaro/shared/models"
import { DUBBING_MAX_MINUTES, DUBBING_MODEL_IDENTIFIERS } from "./dubbing-model.js"
import { VIDEO_UTILITY_JOB_NAMES } from "./video-utility-credits.js"
import { PODCAST_PACK_RATE_ID } from "./use-case/pack-price.js"

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
/**
 * A scan: whole Social Search pages. A brand scan reads one page per search,
 * at most 6 accounts + 6 platforms × 15 terms = 96; a topic scan at most 6
 * platforms × 3 pages. 300 bounds both with room to spare.
 */
const SCAN_PAGES: UnitQuoteRule = { maxUnits: 300, minUnits: 1, wholeUnits: true }
/**
 * A sent-priced extend (Seedance 2.5 / 2.5 Flash Extend): half a unit per
 * second sent and added. The fewest a run has is the shortest source it takes
 * (`SEEDANCE_EXTEND_MIN_SOURCE_SEC`, the floor the route and the worker
 * refuse under: 1.8 s, 2 s on Flash) plus the fewest seconds it adds (its catalog window); the
 * most, the whole 10-second window plus the most it adds.
 */
function seedanceExtendUnits(provider: SentPricedSeedanceExtendProvider): UnitQuoteRule {
  const added: readonly number[] = MODEL_CATALOG[provider]?.durations ?? []
  return {
    minUnits: (SEEDANCE_EXTEND_MIN_SOURCE_SEC[provider] + Math.min(...added)) / SEEDANCE_EXTEND_RATE_SECONDS,
    maxUnits: (SEEDANCE_EXTEND_CONTEXT_MAX_SEC + Math.max(...added)) / SEEDANCE_EXTEND_RATE_SECONDS,
    wholeUnits: false,
  }
}

/** Video to Video's clip rate rows with the unit counts a run of each can have. */
function v2vClipRateRules(): ReadonlyArray<readonly [string, UnitQuoteRule]> {
  const rules = new Map<string, UnitQuoteRule>()
  for (const [key, rate] of Object.entries(V2V_CLIP_RATES)) {
    if (rules.has(rate.rateId)) continue
    if (key.startsWith("happyhorse-edit:")) {
      rules.set(rate.rateId, { minUnits: HAPPYHORSE_EDIT_MIN_SEC / rate.rateSeconds, maxUnits: HAPPYHORSE_EDIT_MAX_SEC / rate.rateSeconds, wholeUnits: false })
    } else {
      // From the shortest clip, not the seeded break-even: which row a run takes follows the live rows,
      // so a repriced row can move the rate to any length the model takes.
      rules.set(rate.rateId, { minUnits: WAN_VIDEOEDIT_MIN_SEC / rate.rateSeconds, maxUnits: WAN_VIDEOEDIT_MAX_SEC / rate.rateSeconds, wholeUnits: false })
    }
  }
  return [...rules]
}

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
  // Seedance 2.5 and 2.5 Flash Extend: each resolution's row prices two seconds, so a run is
  // half a unit per second sent and added (any fraction: the source's seconds
  // are measured), from the shortest source a run takes plus the fewest
  // seconds it adds, up to the 10-second window plus the most it adds.
  ...SEEDANCE_EXTEND_SENT_PRICED_PROVIDERS.flatMap((provider) =>
    Object.values(SEEDANCE_EXTEND_RATE_CREDIT_IDS_BY_PROVIDER[provider]).map((id) => [id, seedanceExtendUnits(provider)] as const),
  ),
  ...DUBBING_MODEL_IDENTIFIERS.map((id) => [id, DUB_MINUTES] as const),
  [SPEAKER_FRAMES_CREDIT_ID, FRAME_BLOCKS] as const,
  // A brand's or a topic's scan: whole Social Search pages.
  ...Object.keys(SCAN_PAGE_CREDIT_COSTS).map((id) => [id, SCAN_PAGES] as const),
  // Motion Transfer, every model and size: each row prices four seconds, so a
  // run is a quarter-unit per billed second of its driving video, from the
  // shortest video a run takes to the longest. (A Wan Animate run its floor
  // row prices is charged that row once: its own id, not a quote of this one.)
  ...Object.values(MOTION_TRANSFER_SECOND_RATES).map((rate) => [
    rate.rateId,
    { minUnits: MOTION_TRANSFER_MIN_SEC / rate.rateSeconds, maxUnits: MOTION_TRANSFER_MAX_SEC / rate.rateSeconds, wholeUnits: false },
  ] as const),
  // The podcast pack: every started 15 seconds of the recording, at least one — whole units only.
  [PODCAST_PACK_RATE_ID, { maxUnits: UNIT_QUOTE_MAX_UNITS, minUnits: 1, wholeUnits: true }] as const,
  // Video to Video's clip rows (each prices four seconds). HappyHorse Edit: an
  // eighth of a unit per started half-second, from the shortest clip it takes
  // to the longest. Wan 2.7 VideoEdit: a quarter-unit per billed second, over
  // the clips it takes (below its break-even a run is charged its flat row).
  ...v2vClipRateRules(),
  // Audio Isolation: whole started ten-second units of its audio, one to the
  // 30-minute cap's 180.
  [AUDIO_ISOLATION_RATE_ID, { minUnits: 1, maxUnits: AUDIO_ISOLATION_MAX_UNITS, wholeUnits: true }] as const,
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
 * the rate's base × the units ÷ `rowUnits` (absent: 1), rounded up
 * (`quoteBaseCredits`): the base its route reserves. A speech model quoted per
 * 1,000 characters names its `:per-1k-chars` row, with N still in started
 * hundreds and `rowUnits` 10.
 */
export function parseQuoteCreditId(id: string): (UnitQuoteCreditIdParts & { rowUnits?: number }) | undefined {
  const speech = parseSpeechQuoteCreditId(id)
  if (speech) return { rateId: speech.unitId, units: speech.units, ...(speech.rowUnits !== 1 && { rowUnits: speech.rowUnits }) }
  return parseRateQuoteCreditId(id)
}

// The base of N units of a rate (`quoteBaseCredits`) and what a run of them is
// charged (`unitRateBaseCredits`) live beside the row lookup they read, so the
// charge and the quote compose the same two functions.
export { quoteBaseCredits, unitRateBaseCredits, unitRatePrice } from "./credit-base-cost.js"
