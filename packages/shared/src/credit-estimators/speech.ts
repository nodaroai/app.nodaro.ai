/**
 * Length-based speech pricing — the shape of the price, not its value.
 *
 * A speech request (Text to Speech, Text to Dialogue, and the voiced-video
 * add-on) is priced per STARTED 100 characters of the text actually sent,
 * with a minimum number of units per request. The amount of one unit is a
 * `model_pricing` row per model — `<model id>:per-100-chars`, admin-editable
 * — and never lives here. `speechCredits(chars, row)` is the list price of a
 * request at a catalog row. An instance prices the WHOLE request and rounds it
 * once, so the price it serves for one unit times the units is only an upper
 * bound of what the request costs there. The exact charge of a
 * request of N units is served under its own id, `speechQuoteCreditId(model,
 * N)` (`<model>:per-100-chars:<N>u`), by the same price lookups that serve the
 * unit row (credits.model-costs, GET /v1/credits/model-cost): a client quotes
 * that answer rather than multiplying.
 *
 * Why 100 and not 1,000: the per-request error is at most one unit, and a
 * whole number of units times a charged unit price never under-quotes the
 * charge (the same property the per-second video rows rely on).
 *
 * Decided 2026-10-06. Every name here is a published contract.
 */
import { canonicalTtsProvider, findTtsCapabilities } from "../tts-capabilities.js"
import { findDialogueCapabilities } from "../dialogue-capabilities.js"
import { unitQuoteCreditId } from "./unit-quote.js"

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

/**
 * The id of the exact charge of a whole request of `units` units on `modelId`:
 * `<model>:per-100-chars:<N>u`. Never a row of its own — a price lookup prices
 * it from the model's unit row × N as one whole, exactly as a request of that
 * length is reserved. Served only while length pricing is on, like the unit
 * row it is priced from.
 */
export function speechQuoteCreditId(modelId: string, units: number): string {
  return unitQuoteCreditId(speechUnitCreditId(modelId), units)
}

/** A `<model>:per-100-chars:<N>u` id, read back. */
export interface SpeechQuoteCreditIdParts {
  /** The speech model (canonical id) the request runs as. */
  model: string
  /** Its `<model>:per-100-chars` unit row. */
  unitId: string
  /** Units priced: at least the floor, at most the model's per-request cap in started hundreds. */
  units: number
}

const SPEECH_QUOTE_ID = /^(.+):per-100-chars:(\d{1,6})u$/

/**
 * The parts of a `<model>:per-100-chars:<N>u` id, or undefined for any other id
 * — including a model that is not a speech model under its canonical id, and a
 * unit count no request on that model can be priced at (below the floor, or
 * above the model's cap in started hundreds).
 */
export function parseSpeechQuoteCreditId(id: string): SpeechQuoteCreditIdParts | undefined {
  if (typeof id !== "string") return undefined
  const m = SPEECH_QUOTE_ID.exec(id)
  if (!m) return undefined
  const model = m[1]!
  if (canonicalTtsProvider(model) !== model) return undefined
  const caps = findTtsCapabilities(model) ?? findDialogueCapabilities(model)
  if (!caps) return undefined
  const units = Number(m[2])
  if (!Number.isInteger(units) || units < SPEECH_FLOOR_UNITS || units > speechPriceUnits(caps.maxChars)) return undefined
  return { model, unitId: speechUnitCreditId(model), units }
}

/**
 * Whether an id is a length price of speech — a `<model>:per-100-chars` unit
 * row or a `<model>:per-100-chars:<N>u` request quote — by its shape alone.
 * Both are served only while the server prices speech by length.
 */
export function isSpeechLengthPriceId(id: string): boolean {
  return typeof id === "string" && /:per-100-chars(?::\d+u)?$/.test(id)
}

/**
 * The speech model a length price id is priced for — the id a request of
 * that model is reserved at, so the two are priced under the same id — or
 * undefined for any other id.
 */
export function speechLengthPriceModel(id: string): string | undefined {
  if (!isSpeechLengthPriceId(id)) return undefined
  return id.replace(/:per-100-chars(?::\d+u)?$/, "")
}
