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
import { speechLengthPricingEnabled } from "../../lib/config.js"
import { speechUnitBaseCredits } from "../../lib/speech-credits.js"
import { getModelCreditBaseCost } from "./credits.js"
import {
  RESPEAK_ENGINE_MODELS,
  VOICE_CHANGER_PRO_MINUTE_MODEL,
  VOICE_CHANGER_PRO_RESPEAK_MODEL,
  priceVoiceChangerProFromUnits,
  type VoiceChangerProPricing,
  type VoiceChangerProPricingArgs,
} from "./voice-changer-pro-pricing.js"

// The units, the formula and the pure pricing live in voice-changer-pro-pricing.ts
// (no database read), shared with the whole-convert quote; re-exported here so
// every existing import keeps working.
export * from "./voice-changer-pro-pricing.js"

/**
 * Reads every unit through the credit layer (a `model_pricing` row wins over
 * the static seed; a missing identifier throws `PriceNotConfiguredError` —
 * there is no silent free path), then prices through
 * `priceVoiceChangerProFromUnits` — the function the whole-convert quote
 * (`voice-changer-pro:<slots>`) prices through too. Flag off: the two VCP rows,
 * today's formula, byte for byte. Flag on (SPEECH_LENGTH_PRICING_ENABLED): the
 * Re-speak slots are priced on the engines' text-to-speech rows, read through
 * the one speech row reader (`lib/speech-credits.ts`).
 */
export async function computeVoiceChangerProPricing(args: VoiceChangerProPricingArgs): Promise<VoiceChangerProPricing> {
  const lengthPricing = speechLengthPricingEnabled()
  const [minute, respeak, v3, v4] = await Promise.all([
    getModelCreditBaseCost(VOICE_CHANGER_PRO_MINUTE_MODEL),
    getModelCreditBaseCost(VOICE_CHANGER_PRO_RESPEAK_MODEL),
    lengthPricing ? speechUnitBaseCredits(RESPEAK_ENGINE_MODELS.v3) : undefined,
    lengthPricing ? speechUnitBaseCredits(RESPEAK_ENGINE_MODELS.v4) : undefined,
  ])
  return priceVoiceChangerProFromUnits({ minute: minute.creditCost, respeak: respeak.creditCost, v3, v4 }, lengthPricing, args)
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
  // Re-derived 2026-10-08 when the premium tier moved to claude-opus-5.5: the
  // plugin's token profile (≈ 850 in / 800 out per 1K source characters) costs
  // ≈ 10 base credits on its DIRECT lane — the worst case, since a KIE failure
  // falls back there at no extra charge — so 15 bounds it. The old 50 came
  // from a rate that matched neither of Opus 5's lanes.
  premium: 15,
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
