/**
 * What a run priced PER UNIT costs, as the editor quotes it: the server's own
 * price for the whole run (`<rateId>:<units>u`, `@nodaro/shared`
 * `unitQuoteCreditId`), never the served one-unit price × the units.
 *
 * The server charges such a run as one whole — the row's base × the units,
 * marked up once and rounded up once — while a served one-unit price is
 * already rounded up, so multiplying it by the units can quote more than the
 * run is charged (a 60-minute preview render at a 1-credit row, for one). The
 * whole price is asked for under its own id and quoted as it comes back.
 *
 * Until it is cached (a cold cache, or a server that does not price the id),
 * the quote is the one-unit price × the units rounded up — never below the
 * charge, so a balance check can only refuse too early, never let a run
 * through that its reservation then refuses.
 *
 * Pure: the prices are passed in, as the run estimate's cache reader or a
 * hook's query results.
 */
import { unitQuoteCreditId } from "@nodaro/shared"

/** The id of the whole price of `units` of `rateId`, or undefined for a single unit (the row is its own price). */
export function unitQuoteIdFor(rateId: string | undefined, units: number): string | undefined {
  if (!rateId || !Number.isFinite(units) || units <= 0 || units === 1) return undefined
  return unitQuoteCreditId(rateId, units)
}

/**
 * The credits of `units` of `rateId`: the cached whole price, else the cached
 * one-unit price × the units rounded up; undefined when neither is cached.
 */
export function unitQuoteCredits(
  rateId: string | undefined,
  units: number,
  priceOf: (creditId: string) => number | undefined,
): number | undefined {
  if (!rateId) return undefined
  const quoteId = unitQuoteIdFor(rateId, units)
  const whole = quoteId === undefined ? undefined : priceOf(quoteId)
  if (whole !== undefined) return whole
  const unit = priceOf(rateId)
  return unit === undefined ? undefined : unit * upperUnits(units)
}

/** The units an upper-bound quote multiplies by: whole units, at least one. */
export function upperUnits(units: number): number {
  return Number.isFinite(units) && units >= 1 ? Math.ceil(units) : 1
}
