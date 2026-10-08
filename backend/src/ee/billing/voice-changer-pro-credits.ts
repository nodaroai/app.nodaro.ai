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
import { speechCredits } from "@nodaro/shared"
import { speechLengthPricingEnabled } from "../../lib/config.js"
import { speechUnitBaseCredits } from "../../lib/speech-credits.js"
import { getModelCreditBaseCost } from "./credits.js"

/** Credits per MINUTE of stem audio per speech-to-speech slot — prorated per
 *  second, rounded up to the next credit (26.76 s at 40/min → 18). */
export const VOICE_CHANGER_PRO_MINUTE_MODEL = "voice-changer-pro"
/** Per 1K characters of re-spoken text, per Re-speak slot — the FLAT row,
 *  charged while length-based speech pricing is off (see
 *  `priceVoiceChangerProByLength` for the other branch). */
export const VOICE_CHANGER_PRO_RESPEAK_MODEL = "voice-changer-pro-respeak"
/** The smallest stem a slot is billed as — six seconds at the per-minute
 *  unit — so the floor scales with the unit when an admin retunes it. */
export const VOICE_CHANGER_PRO_MIN_BILLABLE_SEC = 6
export const VOICE_CHANGER_PRO_RESPEAK_CHARS_PER_UNIT = 1000

/**
 * The Re-speak engines and the text-to-speech model each one synthesises on —
 * the model whose per-100-characters row prices the speaker while length
 * pricing is on (D-VCP, decided 2026-10-06: a Re-speak speaker costs what the
 * same text costs on the Text to Speech node for the same model). v3 is the
 * default — the only engine before v4 existed, and what an older plugin that
 * sends no engine was running.
 */
export const RESPEAK_ENGINE_MODELS = { v3: "elevenlabs-v3", v4: "elevenlabs-v4" } as const
export type RespeakEngine = keyof typeof RESPEAK_ENGINE_MODELS
export const DEFAULT_RESPEAK_ENGINE: RespeakEngine = "v3"

/** The engine a slot runs on: `"v4"` when sent as such, else v3 (absent, null, or anything the plugin would not call an engine). */
export function respeakEngineOf(engine: unknown): RespeakEngine {
  return engine === "v4" ? "v4" : DEFAULT_RESPEAK_ENGINE
}

/** The text-to-speech model a Re-speak slot is priced on while length pricing is on. */
export function respeakEngineModel(engine: unknown): string {
  return RESPEAK_ENGINE_MODELS[respeakEngineOf(engine)]
}

export interface VoiceChangerProPricing {
  /** BASE credits per minute of stem audio (one STS slot), prorated per second. */
  unitPerMinute: number
  /** BASE credits per started 1K characters (one Re-speak slot) — the flat
   *  `voice-changer-pro-respeak` row: what a Re-speak slot is charged while
   *  length-based speech pricing is off. While it is on, `respeakCredits`
   *  are priced on the engine's text-to-speech rows instead (reported here
   *  unchanged so a reader of the result sees the row that exists). */
  respeakPer1K: number
  /** BASE floor per speech-to-speech slot AND for the whole reservation.
   *  Also the Re-speak per-slot floor while length pricing is off; while on,
   *  a Re-speak slot's floor is the speech floor on its engine's row. */
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
  /** Re-spoken characters per Re-speak slot. `null`/0 = UNKNOWN (the engine
   *  will derive the text itself): reserve one 1K bucket for the slot. */
  respeakChars: ReadonlyArray<number | null | undefined>
  /** The engine of each Re-speak slot, index-aligned with `respeakChars`
   *  (`"v3"` | `"v4"`); absent, shorter, null or unknown → v3. Read only
   *  while length pricing is on, where it picks the text-to-speech row the
   *  slot is priced on. Additive-optional: a plugin that predates it prices
   *  every slot as v3. */
  respeakEngines?: ReadonlyArray<string | null | undefined>
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
 * BASE credits for one Re-speak slot while length pricing is on: exactly the
 * Text to Speech node's formula over the slot's characters on the engine's
 * per-unit row — every started 100 characters, never fewer than the speech
 * floor, which replaces the six-second speech-to-speech floor for this slot.
 * An UNKNOWN count keeps today's ceiling in characters: one 1K bucket,
 * priced by the formula (the commit settles the measured count under it).
 */
export function respeakSlotCreditsByLength(perUnit: number, chars: number | null | undefined): number {
  const known = chars != null && Number.isFinite(chars) && chars > 0
  return speechCredits(known ? chars : VOICE_CHANGER_PRO_RESPEAK_CHARS_PER_UNIT, perUnit)
}

/**
 * Pure core of the length branch: the speech-to-speech slots and the
 * reservation floor exactly as `priceVoiceChangerPro`, each Re-speak slot on
 * its engine's per-unit amount (`respeakUnits`, one per engine, so an admin
 * retune of one text-to-speech row moves only that engine's speakers).
 */
export function priceVoiceChangerProByLength(
  unitPerMinute: number,
  respeakPer1K: number,
  respeakUnits: Readonly<Record<RespeakEngine, number>>,
  args: VoiceChangerProPricingArgs,
): VoiceChangerProPricing {
  const floor = voiceChangerProFloor(unitPerMinute)
  const stsCredits = args.stsSlotSeconds.map((s) => stsSlotCredits(unitPerMinute, floor, s))
  const respeakCredits = args.respeakChars.map((c, i) => respeakSlotCreditsByLength(respeakUnits[respeakEngineOf(args.respeakEngines?.[i])], c))
  const sum = stsCredits.reduce((a, b) => a + b, 0) + respeakCredits.reduce((a, b) => a + b, 0)
  return { unitPerMinute, respeakPer1K, floor, stsCredits, respeakCredits, reserveBase: Math.max(floor, sum) }
}

/**
 * Reads every unit through the credit layer (a `model_pricing` row wins over
 * the static seed; a missing identifier throws `PriceNotConfiguredError` —
 * there is no silent free path). Flag off: the two VCP rows, today's formula,
 * byte for byte. Flag on (SPEECH_LENGTH_PRICING_ENABLED): the Re-speak slots
 * are priced on the engines' text-to-speech rows, read through the one
 * speech row reader (`lib/speech-credits.ts`).
 */
export async function computeVoiceChangerProPricing(args: VoiceChangerProPricingArgs): Promise<VoiceChangerProPricing> {
  const [minute, respeak] = await Promise.all([
    getModelCreditBaseCost(VOICE_CHANGER_PRO_MINUTE_MODEL),
    getModelCreditBaseCost(VOICE_CHANGER_PRO_RESPEAK_MODEL),
  ])
  if (!speechLengthPricingEnabled()) return priceVoiceChangerPro(minute.creditCost, respeak.creditCost, args)
  const [v3, v4] = await Promise.all([
    speechUnitBaseCredits(RESPEAK_ENGINE_MODELS.v3),
    speechUnitBaseCredits(RESPEAK_ENGINE_MODELS.v4),
  ])
  return priceVoiceChangerProByLength(minute.creditCost, respeak.creditCost, { v3, v4 }, args)
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
