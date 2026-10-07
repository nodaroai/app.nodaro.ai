/**
 * Voice Changer Pro pricing — the single source of truth for the recast
 * reservation (plugin route `computeCredits`) and the metered commit (plugin
 * handler), reached from the plugin through `tk.http.computeVoiceChangerProPricing`.
 *
 * Why a per-MINUTE unit (2026-09-15): the speech-to-speech vendor bills by the
 * length of the audio it is handed, and the per-speaker stem the engine sends
 * spans from the clip start to that speaker's LAST utterance (silence in the
 * gaps — `build-speaker-stem.ts`, `amix duration=longest`). A flat per-speaker
 * price therefore covered a fixed few seconds of audio whatever the clip length;
 * the platform lost money on every clip longer than that. Pricing the slot by
 * its stem length makes the charge follow the cost, and reading the unit from
 * `model_pricing` (DB row wins over the static seed) keeps it tunable in
 * /admin/models without a redeploy — which also retires the old split where the
 * admin row said one number and the plugin constant charged another.
 *
 * Returns BASE (pre-markup) credits: the credit guard applies the identifier's
 * effective markup at reserve, and the count-based commit branch of
 * `commitJobCredits` applies the same markup to the measured actual.
 */
import { getModelCreditBaseCost } from "./credits.js"

/** Credits per MINUTE of stem audio per speech-to-speech slot — prorated per
 *  second, rounded up to the next credit (26.76 s at 40/min → 18). */
export const VOICE_CHANGER_PRO_MINUTE_MODEL = "voice-changer-pro"
/** Per 1K characters of re-spoken text, per v3 (Re-speak) slot. */
export const VOICE_CHANGER_PRO_RESPEAK_MODEL = "voice-changer-pro-respeak"
/** The smallest stem a slot is billed as — six seconds at the per-minute
 *  unit — so the floor scales with the unit when an admin retunes it. */
export const VOICE_CHANGER_PRO_MIN_BILLABLE_SEC = 6
export const VOICE_CHANGER_PRO_RESPEAK_CHARS_PER_UNIT = 1000

export interface VoiceChangerProPricing {
  /** BASE credits per minute of stem audio (one STS slot), prorated per second. */
  unitPerMinute: number
  /** BASE credits per started 1K characters (one Re-speak slot). */
  respeakPer1K: number
  /** BASE floor per slot AND for the whole reservation. */
  floor: number
  /** Per-slot BASE credits, same order as `stsSlotSeconds`. */
  stsCredits: number[]
  /** Per-slot BASE credits, same order as `respeakChars`. */
  respeakCredits: number[]
  /** Sum of every slot, never below `floor` (pre-markup). */
  reserveBase: number
}

export interface VoiceChangerProPricingArgs {
  /** Stem length in seconds per speech-to-speech slot. `null`/0 = UNKNOWN
   *  (a blind caller sent no analysis): reserve one minute for the slot; the
   *  commit measures the real stem and settles under that ceiling. */
  stsSlotSeconds: ReadonlyArray<number | null | undefined>
  /** Re-spoken characters per v3 slot. `null`/0 = UNKNOWN (the engine will
   *  derive the text itself): reserve one 1K bucket for the slot. */
  respeakChars: ReadonlyArray<number | null | undefined>
}

export function voiceChangerProFloor(unitPerMinute: number): number {
  return Math.max(1, Math.ceil((unitPerMinute * VOICE_CHANGER_PRO_MIN_BILLABLE_SEC) / 60))
}

/** BASE credits for one speech-to-speech slot whose stem is `seconds` long. */
export function stsSlotCredits(unitPerMinute: number, floor: number, seconds: number | null | undefined): number {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return Math.max(floor, unitPerMinute)
  return Math.max(floor, Math.ceil((unitPerMinute * seconds) / 60))
}

/** BASE credits for one Re-speak slot synthesizing `chars` characters. */
export function respeakSlotCredits(respeakPer1K: number, floor: number, chars: number | null | undefined): number {
  if (chars == null || !Number.isFinite(chars) || chars <= 0) return Math.max(floor, respeakPer1K)
  return Math.max(floor, Math.ceil(chars / VOICE_CHANGER_PRO_RESPEAK_CHARS_PER_UNIT) * respeakPer1K)
}

/** Pure core, for callers that already hold the two units (tests, previews). */
export function priceVoiceChangerPro(
  unitPerMinute: number,
  respeakPer1K: number,
  args: VoiceChangerProPricingArgs,
): VoiceChangerProPricing {
  const floor = voiceChangerProFloor(unitPerMinute)
  const stsCredits = args.stsSlotSeconds.map((s) => stsSlotCredits(unitPerMinute, floor, s))
  const respeakCredits = args.respeakChars.map((c) => respeakSlotCredits(respeakPer1K, floor, c))
  const sum = stsCredits.reduce((a, b) => a + b, 0) + respeakCredits.reduce((a, b) => a + b, 0)
  return { unitPerMinute, respeakPer1K, floor, stsCredits, respeakCredits, reserveBase: Math.max(floor, sum) }
}

/**
 * Reads both units through `getModelCreditBaseCost` (a `model_pricing` row
 * wins over the static seed; a missing identifier throws
 * `PriceNotConfiguredError` — there is no silent free path).
 */
export async function computeVoiceChangerProPricing(args: VoiceChangerProPricingArgs): Promise<VoiceChangerProPricing> {
  const [minute, respeak] = await Promise.all([
    getModelCreditBaseCost(VOICE_CHANGER_PRO_MINUTE_MODEL),
    getModelCreditBaseCost(VOICE_CHANGER_PRO_RESPEAK_MODEL),
  ])
  return priceVoiceChangerPro(minute.creditCost, respeak.creditCost, args)
}

// ---------------------------------------------------------------------------
// The translate step ("Re-speak in another language", decided 2026-10-06).
//
// The plugin translates the detected transcript into one target language
// with a metered LLM call, then the normal recast re-speaks the translation
// with a v4 voice. The translate step is RESERVED at a ceiling sized from
// its SOURCE characters and COMMITTED at the model's measured usage — the
// recast's own count-metered shape (`commitJobCredits`'s count branch never
// collects above the reservation). The row `voice-changer-pro-translate` is
// the FLOOR of that commit, read here so an admin retune in /admin/models
// reaches the plugin without a redeploy; the per-tier ceilings are
// reservation BOUNDS, not prices, so they live in code beside the formula.
// The plugin keeps a twin of these constants as its fallback for a host that
// predates this member (the `computeVoiceChangerProPricing` pattern).
// ---------------------------------------------------------------------------

/** The metered translate step's FLOOR row (born-private; seeded by the plugin too). */
export const VOICE_CHANGER_PRO_TRANSLATE_MODEL = "voice-changer-pro-translate"
export type VcpTranslateTier = "economy" | "standard" | "premium"
/** Reservation ceiling in BASE credits per started 1K SOURCE characters, by
 *  translation tier. A ceiling, not a price: the worker commits the metered
 *  actual, never above it. */
export const TRANSLATE_CEILING_PER_1K: Readonly<Record<VcpTranslateTier, number>> = {
  economy: 5,
  standard: 10,
  premium: 50,
}
export const TRANSLATE_CHARS_PER_UNIT = 1000

export interface VoiceChangerProTranslatePricing {
  /** BASE floor — the `voice-changer-pro-translate` row (admin-tunable). */
  floor: number
  /** BASE reservation ceiling per started 1K source characters for the tier. */
  ceilingPer1K: number
  /** max(floor, ceil(sourceChars / 1000) × ceilingPer1K) — pre-markup. */
  reserveBase: number
}

/** BASE reservation ceiling for `sourceChars` characters of source text. A
 *  hostile count (NaN, ≤ 0, Infinity — the route prices a pre-Zod body)
 *  reserves the floor rather than throwing. */
export function translateReserveBase(floor: number, ceilingPer1K: number, sourceChars: number): number {
  if (!Number.isFinite(sourceChars) || sourceChars <= 0) return floor
  return Math.max(floor, Math.ceil(sourceChars / TRANSLATE_CHARS_PER_UNIT) * ceilingPer1K)
}

/** Pure core, for callers that already hold the floor (tests, previews). */
export function priceTranslate(floor: number, tier: VcpTranslateTier, sourceChars: number): VoiceChangerProTranslatePricing {
  const ceilingPer1K = TRANSLATE_CEILING_PER_1K[tier]
  return { floor, ceilingPer1K, reserveBase: translateReserveBase(floor, ceilingPer1K, sourceChars) }
}

/**
 * Reads the floor through `getModelCreditBaseCost` (a `model_pricing` row wins
 * over the static seed; a missing identifier throws `PriceNotConfiguredError`
 * — there is no silent free path).
 */
export async function computeVoiceChangerProTranslatePricing(
  args: { sourceChars: number; tier: VcpTranslateTier },
): Promise<VoiceChangerProTranslatePricing> {
  const floor = await getModelCreditBaseCost(VOICE_CHANGER_PRO_TRANSLATE_MODEL)
  return priceTranslate(floor.creditCost, args.tier, args.sourceChars)
}
