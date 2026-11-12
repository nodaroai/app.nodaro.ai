/**
 * The one door to the node units' quotes (tools/units/README.md, "A unit's
 * quote"), a reviewed composer (tools/units/registry-composers.json):
 * `UNIT_QUOTES`, each unit's `quote.ts` under its type — its run route's own
 * body schema and pricing chain, the same chain its route.ts registers as its
 * preHandlers. `POST /v1/quote` (ee/routes/node-quote.ts) prices a unit
 * through it, beside its hand-written rows.
 *
 * Nothing here reads the collection while it loads.
 */
import { UNIT_QUOTES } from "../nodes/_generated/quotes.js"
import type { UnitQuote } from "../nodes/kit.js"

/** The quote of the unit of this node type; undefined for any other type (every legacy one). */
export function unitQuoteOf(type: string): UnitQuote | undefined {
  return Object.hasOwn(UNIT_QUOTES, type) ? UNIT_QUOTES[type] : undefined
}

/** Every unit type a quote can price, in the aggregate's order. */
export function unitQuotableTypes(): string[] {
  return Object.keys(UNIT_QUOTES)
}
