/**
 * Length-based speech pricing — the shape of the price, not its value.
 *
 * A speech request (Text to Speech, Text to Dialogue, and the voiced-video
 * add-on) is priced per STARTED 100 characters of the text actually sent,
 * with a minimum number of units per request. The amount of one unit is a
 * `model_pricing` row per model — `<model id>:per-100-chars`, admin-editable
 * — and never lives here. A client that reads that row (GET /v1/models,
 * credits.model-costs) computes exactly what the server reserves with
 * `speechCredits(chars, row)`.
 *
 * Why 100 and not 1,000: the per-request error is at most one unit, and a
 * whole number of units times a charged unit price never under-quotes the
 * charge (the same property the per-second video rows rely on).
 *
 * Decided 2026-10-06. Every name here is a published contract.
 */
import { canonicalTtsProvider } from "../tts-capabilities.js"

/** Characters per price unit. */
export const SPEECH_PRICE_UNIT_CHARS = 100

/** The minimum units a request is priced at, however short its text. */
export const SPEECH_FLOOR_UNITS = 8

/** Appended to a speech model's id to name its per-unit price row. */
export const SPEECH_UNIT_CREDIT_SUFFIX = ":per-100-chars"

/**
 * The price-row id of one unit for the model a request runs as. The legacy
 * `elevenlabs` alias prices on turbo's row, as it runs on turbo; any other id
 * (including the dialogue model) is used as given.
 */
export function speechUnitCreditId(modelId: string): string {
  return `${canonicalTtsProvider(modelId)}${SPEECH_UNIT_CREDIT_SUFFIX}`
}

/**
 * Units a text of `chars` characters is priced at: every started 100, and
 * never fewer than the floor. A count that is not a finite non-negative
 * number (node data written straight into workflow JSON) is the floor.
 */
export function speechPriceUnits(chars: number): number {
  const started = Number.isFinite(chars) && chars > 0 ? Math.ceil(chars / SPEECH_PRICE_UNIT_CHARS) : 0
  return Math.max(SPEECH_FLOOR_UNITS, started)
}

/** Base credits for `chars` characters at `perUnitCredits` per unit (the model's `:per-100-chars` row). */
export function speechCredits(chars: number, perUnitCredits: number): number {
  return speechPriceUnits(chars) * perUnitCredits
}
