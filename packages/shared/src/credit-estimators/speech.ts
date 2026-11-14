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
 * A model whose rate is below one credit per 100 characters (a row holds
 * whole credits) quotes its row per 1,000 instead — `<model>:per-1k-chars`,
 * its sheet's `ratePer1kChars` (decided 2026-11-12). The count is the same
 * (started 100s, at least 8), and a request costs its hundreds × the row ÷ 10,
 * rounded up once (`speechRowCredits`). Its request quote keeps the one id
 * shape, `<model>:per-100-chars:<N>u`, N in started hundreds, so a client
 * that builds that id quotes every model alike.
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

/** Appended to a speech model's id to name its rate row quoted per 1,000 characters (`TtsCapabilities.ratePer1kChars`). */
export const SPEECH_PER_1K_CREDIT_SUFFIX = ":per-1k-chars"

/**
 * How many units (started 100 characters) one rate row of the model prices:
 * 10 for a model whose row is quoted per 1,000 characters, else 1. The
 * legacy alias resolved; an id with no speech sheet is 1.
 */
export function speechRowUnits(modelId: string): 1 | 10 {
  const id = canonicalTtsProvider(modelId)
  return (findTtsCapabilities(id) ?? findDialogueCapabilities(id))?.ratePer1kChars ? 10 : 1
}

/**
 * The price-row id of the rate the model a request runs as is charged at:
 * `<model>:per-100-chars` (one unit), or `<model>:per-1k-chars` for a model
 * quoted per 1,000 characters ({@link speechRowUnits}). The legacy
 * `elevenlabs` alias prices on turbo's row, as it runs on turbo; any other id
 * (including the dialogue model) is used as given.
 */
export function speechUnitCreditId(modelId: string): string {
  const id = canonicalTtsProvider(modelId)
  return `${id}${speechRowUnits(id) === 10 ? SPEECH_PER_1K_CREDIT_SUFFIX : SPEECH_UNIT_CREDIT_SUFFIX}`
}

/**
 * Base credits of `units` (started hundreds) at a rate row of `rowCredits`
 * that prices `rowUnits` units: `ceil(units × row ÷ rowUnits)`, in whole
 * numbers so it never rounds a hair high. With `rowUnits` 1 it is exactly
 * units × the row (every per-100 row is a whole number).
 */
export function speechRowCredits(units: number, rowCredits: number, rowUnits: number = 1): number {
  return rowUnits === 1 ? units * rowCredits : Math.ceil((units * rowCredits) / rowUnits)
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
 * Base credits for `chars` characters on `modelId` at its rate row
 * (`speechUnitCreditId(modelId)`, read as `rowCredits`): per-100 or per-1K,
 * whichever the model is quoted in. What every seam that reserves speech, and
 * every client that quotes it, computes.
 */
export function speechCreditsFor(modelId: string, chars: number, rowCredits: number): number {
  return speechRowCredits(speechPriceUnits(chars), rowCredits, speechRowUnits(modelId))
}

/**
 * The id of the exact charge of a whole request of `units` units on `modelId`:
 * `<model>:per-100-chars:<N>u`. Never a row of its own — a price lookup prices
 * it from the model's unit row × N as one whole, exactly as a request of that
 * length is reserved. Served only while length pricing is on, like the unit
 * row it is priced from.
 */
export function speechQuoteCreditId(modelId: string, units: number): string {
  // Always the per-100 shape, whatever the model's rate row: N is started hundreds.
  return unitQuoteCreditId(`${canonicalTtsProvider(modelId)}${SPEECH_UNIT_CREDIT_SUFFIX}`, units)
}

/** A `<model>:per-100-chars:<N>u` id, read back. */
export interface SpeechQuoteCreditIdParts {
  /** The speech model (canonical id) the request runs as. */
  model: string
  /** Its rate row: `<model>:per-100-chars`, or `<model>:per-1k-chars` for a model quoted per 1,000. */
  unitId: string
  /** Units priced: at least the floor, at most the model's per-request cap in started hundreds. */
  units: number
  /** How many units one `unitId` row prices (10 for a per-1,000 row, else 1): the request is `speechRowCredits(units, row, rowUnits)`. */
  rowUnits: 1 | 10
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
  return { model, unitId: speechUnitCreditId(model), units, rowUnits: speechRowUnits(model) }
}

/**
 * Whether an id is a length price of speech — a `<model>:per-100-chars` unit
 * row, a `<model>:per-1k-chars` rate row or a `<model>:per-100-chars:<N>u`
 * request quote — by its shape alone. All are served only while the server
 * prices speech by length.
 */
export function isSpeechLengthPriceId(id: string): boolean {
  return typeof id === "string" && /(?::per-100-chars(?::\d+u)?|:per-1k-chars)$/.test(id)
}

/**
 * The speech model a length price id is priced for — the id a request of
 * that model is reserved at, so the two are priced under the same id — or
 * undefined for any other id.
 */
export function speechLengthPriceModel(id: string): string | undefined {
  if (!isSpeechLengthPriceId(id)) return undefined
  return id.replace(/(?::per-100-chars(?::\d+u)?|:per-1k-chars)$/, "")
}
