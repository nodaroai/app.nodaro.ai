/**
 * Voice Changer Pro pricing — the PURE half: the units, the formula and the
 * one function that picks the formula. No database read lives here, so both
 * the convert route's reservation (through `computeVoiceChangerProPricing`,
 * voice-changer-pro-credits.ts) and the whole-convert price quote
 * (`voice-changer-pro:<slots>`, priced by the credit layer's price lookups in
 * credits.ts) call the SAME function — `priceVoiceChangerProFromUnits` — over
 * the same rows, and the quote cannot drift from the charge.
 *
 * See voice-changer-pro-credits.ts for why a recast slot is priced per minute
 * of its stem. Everything here is BASE (pre-markup) credits.
 */
import { speechCredits } from "@nodaro/shared"
import { speechUnitRowId } from "../../lib/speech-credits.js"


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

/**
 * How much more speech a TRANSLATED Re-speak slot is RESERVED for than its
 * transcript holds: a translated line may be re-rendered once with a shorter
 * rewrite, so the reservation covers 1.5× the transcript's characters, rounded
 * up (decided 2026-10-07). Reserve-only: the commit prices the characters
 * actually synthesized, both renders included, under that ceiling — so the
 * metered commit never passes `respeakTranslated`.
 *
 * The ONE copy the platform prices with: the convert route's reservation
 * (through `computeVoiceChangerProPricing`, `tk.http`) and the whole-convert
 * quote (`voice-changer-pro:…,respeak-v4t-<chars>`) both apply it here. The
 * plugin keeps a twin only as the fallback for a host without the
 * `voiceChangerProRespeakSlotArgs` capability.
 */
export const TRANSLATED_RESPEAK_RESERVE_FACTOR = 1.5

/**
 * The characters a Re-speak slot is RESERVED for: its transcript, × the
 * translated allowance when it speaks a translation — on v4 only, the one
 * engine that speaks one (the convert route reads a target language on v4
 * alone). An unknown count stays unknown (one bucket, priced by the formula).
 */
export function respeakReservedChars(
  chars: number | null | undefined,
  engine: unknown,
  translated: boolean | null | undefined,
): number | null | undefined {
  const knownCount = chars != null && Number.isFinite(chars) && chars > 0
  if (!knownCount || translated !== true || respeakEngineOf(engine) !== "v4") return chars
  return Math.ceil(chars * TRANSLATED_RESPEAK_RESERVE_FACTOR)
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
  /**
   * Whether each Re-speak slot speaks a translation, index-aligned with
   * `respeakChars`; absent, shorter, null or false → not translated. RESERVE
   * ONLY: a translated v4 slot is reserved for `respeakReservedChars` of its
   * transcript (×{@link TRANSLATED_RESPEAK_RESERVE_FACTOR}); the metered commit
   * never sends it, its counts are what was synthesized. Additive-optional: a
   * plugin that predates it multiplies the characters itself.
   */
  respeakTranslated?: ReadonlyArray<boolean | null | undefined>
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

/** The rows a convert is priced from. `v3` / `v4` are read only while length pricing is on. */
export interface VoiceChangerProUnits {
  /** `voice-changer-pro` — BASE credits per minute of stem audio. */
  readonly minute: number
  /** `voice-changer-pro-respeak` — BASE credits per started 1K characters (the flat Re-speak row). */
  readonly respeak: number
  /** Each Re-speak engine's text-to-speech per-100-characters row. */
  readonly v3: number
  readonly v4: number
}

/** The row id of each unit — the ids the reservation and the quote both read. */
export const VOICE_CHANGER_PRO_UNIT_ROWS: Readonly<Record<keyof VoiceChangerProUnits, string>> = {
  minute: VOICE_CHANGER_PRO_MINUTE_MODEL,
  respeak: VOICE_CHANGER_PRO_RESPEAK_MODEL,
  v3: speechUnitRowId(RESPEAK_ENGINE_MODELS.v3),
  v4: speechUnitRowId(RESPEAK_ENGINE_MODELS.v4),
}

/** The units a convert reads under the length-pricing switch: the two VCP rows, plus the engines' speech rows while it is on. */
export function voiceChangerProUnitKeys(lengthPricing: boolean): ReadonlyArray<keyof VoiceChangerProUnits> {
  return lengthPricing ? ["minute", "respeak", "v3", "v4"] : ["minute", "respeak"]
}

/**
 * THE convert price: flag off, the two VCP rows (`priceVoiceChangerPro`); flag
 * on (SPEECH_LENGTH_PRICING_ENABLED), each Re-speak slot on its engine's
 * text-to-speech row (`priceVoiceChangerProByLength`). `v3` / `v4` are not read
 * while the flag is off. Under either, a slot sent as translated
 * (`respeakTranslated`) is priced on its reserved characters
 * (`respeakReservedChars`).
 */
export function priceVoiceChangerProFromUnits(
  units: Pick<VoiceChangerProUnits, "minute" | "respeak"> & Partial<Pick<VoiceChangerProUnits, "v3" | "v4">>,
  lengthPricing: boolean,
  args: VoiceChangerProPricingArgs,
): VoiceChangerProPricing {
  // A translated slot is priced on the characters it is reserved for (both branches).
  const priced: VoiceChangerProPricingArgs = args.respeakTranslated?.some((t) => t === true)
    ? {
        ...args,
        respeakChars: args.respeakChars.map((c, i) => respeakReservedChars(c, args.respeakEngines?.[i], args.respeakTranslated?.[i])),
      }
    : args
  if (!lengthPricing) return priceVoiceChangerPro(units.minute, units.respeak, priced)
  if (units.v3 === undefined || units.v4 === undefined) {
    throw new Error("priceVoiceChangerProFromUnits: length pricing needs both engines' speech rows")
  }
  return priceVoiceChangerProByLength(units.minute, units.respeak, { v3: units.v3, v4: units.v4 }, priced)
}
