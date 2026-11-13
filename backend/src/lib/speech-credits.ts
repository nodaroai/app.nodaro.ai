/**
 * Length-based speech pricing — the backend half: ONE character count and ONE
 * reader of the model's `:per-100-chars` row, for every seam that reserves
 * speech credits (the two REST route guards, the orchestrator's override, the
 * voiced-video add-on) and for the worker that records what a job cost.
 *
 * The count is the text the worker SENDS: clamped to the cap of the model the
 * request runs as (the route clamps first — routes/text-to-speech.ts), then
 * its tags as that model takes them — stripped when it performs none,
 * rewritten to its own tags on an angle-tag model (`speakableText`; the worker
 * does the same after — workers/handlers/audio-ai.ts). Style direction is
 * never counted (decided 2026-11-12). UTF-16 code units, like every cap check. Dialogue is the sum of its line texts, unstripped (v3 performs
 * tags). Anything that is not text counts 0 → the floor.
 *
 * The amount of a unit is the `model_pricing` row (admin-editable), read
 * through `baseCreditCostFor` (core-safe: ee/ by dynamic import). The formula
 * is `@nodaro/shared`'s `speechCredits`, so a client reading the same row
 * computes the same number.
 */
import { dialogueProviderOf, getDialogueCapabilities } from "@nodaro/shared/models"
import { getTtsCapabilities } from "@nodaro/shared/model-catalog"
import { speechCredits, speechCreditsFor, speechUnitCreditId, isSpeechLengthPriceId, speechLengthPriceModel, parseVoiceChangerProQuoteCreditId, VOICE_CHANGER_PRO_QUOTE_RATE_ID } from "@nodaro/shared/credits"
import { sentDialogueChars, sentSpeechText } from "@nodaro/prompts/prompt-fields"
import { ttsModelKey } from "../providers/elevenlabs/tts-models.js"
import { speechLengthPricingEnabled } from "./config.js"
import { parseRateQuoteCreditId } from "./unit-quote-rates.js"
import { baseCreditCostFor } from "./credit-base-cost.js"

/** The default dialogue model's credit id (v3 dialogue); another dialogue model passes its own id, resolved by `dialogueProviderOf`. */
export const DIALOGUE_CREDIT_ID = "elevenlabs-dialogue"

/**
 * The text-to-speech model a request RUNS as: the legacy alias resolved; a
 * missing, unknown or non-string id (node data written straight into workflow
 * JSON) runs as the fallback model — the egress seam's own rule
 * (`ttsModelKey`, providers/elevenlabs/tts-models.ts), so the model priced is
 * the model whose wire id is sent.
 */
export function speechRunsAs(provider: unknown): string {
  return ttsModelKey(typeof provider === "string" ? provider : undefined)
}

/**
 * May a PUBLIC price read serve `identifier`? A `:per-100-chars` row is a rate a
 * client may only apply while this server charges by length, and a
 * `:per-100-chars:<N>u` id is the exact charge of a request of N units by that
 * rule — both are served only while SPEECH_LENGTH_PRICING_ENABLED is on, and
 * their absence is how every client (the editor's pill, Studio, VCP) learns
 * the flag's state. Every other id is always served. The reservation path does
 * not ask this.
 */
export function speechUnitRowServed(identifier: string): boolean {
  return !isSpeechLengthPriceId(identifier) || speechLengthPricingEnabled()
}

/**
 * The id a price is marked up at: a speech length price (a unit row, a request
 * quote) at the model it prices — the id the routes' guard and the job
 * override mark a speech reservation up at — a whole-run quote of a per-unit
 * rate (`<rateId>:<units>u`) at its rate, the id that run's guard marks up at,
 * a whole Voice Changer Pro convert (`voice-changer-pro:<slots>`) at
 * `voice-changer-pro`, and every other id at itself. So a per-service margin
 * applies to a quote exactly as it applies to the charge.
 */
export function priceMarginKey(identifier: string): string {
  // A whole-convert quote (`voice-changer-pro:<slots>`) at the id its route's guard marks up at.
  if (parseVoiceChangerProQuoteCreditId(identifier)) return VOICE_CHANGER_PRO_QUOTE_RATE_ID
  const rateId = parseRateQuoteCreditId(identifier)?.rateId ?? identifier
  return speechLengthPriceModel(rateId) ?? rateId
}

/**
 * Characters of `text` the worker will send on `provider` — `sentSpeechText`,
 * the one rule the sender reads too: its tags as the model takes them (kept,
 * rewritten or stripped) and the model's cap (on an angle-tag model applied
 * AFTER the rewrite, which can lengthen the text).
 */
export function billableSpeechChars(provider: unknown, text: unknown): number {
  if (typeof text !== "string") return 0
  return sentSpeechText(text, getTtsCapabilities(speechRunsAs(provider))).length
}

/** Characters of a dialogue script: each line as it is sent, summed, at most the total cap of the dialogue model it runs as (`sentDialogueChars`). */
export function billableDialogueChars(lines: unknown, provider?: unknown): number {
  // Each line as it is sent (on Gemini 3.8 its tags rewritten, then the cap), summed, at most the model's total cap.
  return sentDialogueChars(lines, getDialogueCapabilities(provider))
}

/**
 * BASE (pre-markup) credits of ONE unit on the model `provider` runs as — for a
 * caller that already holds a character count and prices it with
 * `speechCredits(chars, unit)`: Voice Changer Pro's Re-speak slots, whose count
 * is the text the engine sends per speaker, never one request body to clamp
 * or strip. A request with its text in hand reads `speechBaseCredits`, which
 * counts it the way the worker sends it.
 */
export async function speechUnitBaseCredits(provider: unknown): Promise<number> {
  return baseCreditCostFor(speechUnitRowId(provider))
}

/** The rate row id of the model `provider` runs as (`:per-100-chars`, or `:per-1k-chars` for a model quoted per 1,000) — the row `speechUnitBaseCredits` reads. */
export function speechUnitRowId(provider: unknown): string {
  return speechUnitCreditId(speechRunsAs(provider))
}

/** BASE (pre-markup) credits a text-to-speech request on `provider` reserves: its started hundreds at the model's rate row, rounded up once. */
export async function speechBaseCredits(provider: unknown, text: unknown): Promise<number> {
  const row = await speechUnitBaseCredits(provider)
  return speechCreditsFor(speechRunsAs(provider), billableSpeechChars(provider, text), row)
}

/** BASE (pre-markup) credits a dialogue request on `provider` (a dialogue model id; default v3 dialogue) reserves. */
export async function dialogueBaseCredits(lines: unknown, provider?: unknown): Promise<number> {
  const model = dialogueProviderOf(provider)
  const row = await baseCreditCostFor(speechUnitCreditId(model))
  // Its rate row: per 100 characters, or per 1,000 on a model quoted so (Gemini) — the same row as one speaker.
  return speechCreditsFor(model, billableDialogueChars(lines, model), row)
}
