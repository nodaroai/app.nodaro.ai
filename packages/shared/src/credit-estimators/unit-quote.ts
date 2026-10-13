/**
 * The price of a whole run priced per unit, as ONE id.
 *
 * Some runs are charged a multiple of a one-unit price row: minutes of an
 * Apply EDL or Speaker View render, 5-second steps of a Trim / Loop / Combine
 * / Mask Composite result, seconds of an LTX extend or retake, started
 * hundreds of a speech text. The server prices such a run as a whole — the
 * row's base × the units, marked up ONCE and rounded up once — so a client
 * that multiplies the served one-unit price (already rounded up) by the units
 * can quote more than the run is charged.
 *
 * `unitQuoteCreditId(rateId, units)` names that whole price:
 * `<rateId>:<units>u`. `POST /v1/credits/model-costs` and
 * `GET /v1/credits/model-cost` answer it with the figure the run is charged,
 * for a rate the server charges per unit and a unit count a run can have;
 * any other id lands in `missing`. A client quotes that answer rather than
 * multiplying. (A speech request's id, `<model>:per-100-chars:<N>u`, is this
 * id on the model's per-100-characters row.)
 *
 * Units may be fractional — a retake window is set to the frame — and are
 * written exactly as JavaScript prints the number, so the server reads back
 * the same value the client priced.
 */

/** `<rateId>:<units>u` — the id of the whole price of `units` of `rateId`. */
export function unitQuoteCreditId(rateId: string, units: number): string {
  return `${rateId}:${String(units)}u`
}

/** A `<rateId>:<units>u` id, read back. */
export interface UnitQuoteCreditIdParts {
  /** The one-unit price row. */
  rateId: string
  /** How many of it the run is priced at (a positive number, possibly fractional). */
  units: number
}

const UNIT_QUOTE_ID = /^(.+):(\d{1,7}(?:\.\d{1,20})?)u$/

/**
 * The parts of a `<rateId>:<units>u` id by its shape alone, or undefined. Which
 * rates the server prices this way, and at how many units, is the server's to
 * say: an id it does not price lands in `missing`.
 */
export function parseUnitQuoteCreditId(id: string): UnitQuoteCreditIdParts | undefined {
  if (typeof id !== "string") return undefined
  const m = UNIT_QUOTE_ID.exec(id)
  if (!m) return undefined
  const units = Number(m[2])
  if (!Number.isFinite(units) || units <= 0) return undefined
  return { rateId: m[1]!, units }
}
