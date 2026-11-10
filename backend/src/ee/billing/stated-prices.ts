/**
 * `statedPrices()` — the charged prices every generated or registered text
 * states: `docsPricing` over the server's own price-table rule at the hosted
 * deployment's settings. See `docs-pricing.ts` for why text prices this way.
 */
import { chargedCredits, chargedPriceTableFrom, meteredLlmEstimateIgnoringSwitch, type ChargedPriceTable } from "./credits.js"
import { parseMeteredLlmId } from "./metered-llm-id.js"
import type { LlmKeyQuote } from "../../lib/pricing/charged-prices.js"
import { docsPricing, loadDocsPriceSettings, type ChargeOf, type RateOf } from "./docs-pricing.js"

export interface StatedPrices {
  /** A metered LLM key's quote whatever the switch says (only on `hostedStatedPrices`; see `ChargedPrices.llmQuote`). */
  llmQuote?(identifier: string): LlmKeyQuote | null
  /** The credits charged for `units` of `identifier` (1 by default), or undefined when it is priced nowhere. */
  credits(identifier: string, units?: number): number | undefined
  /** The exact credits one unit of a per-unit rate adds to a run's total (`rateOf`). */
  rate: RateOf
  chargeOf: ChargeOf
  rateOf: RateOf
}

let stated: StatedPrices | null = null

/** Built once per process from `docs-price-settings.json`. */
export function statedPrices(): StatedPrices {
  if (stated) return stated
  const settings = loadDocsPriceSettings()
  const { chargeOf, rateOf } = docsPricing(chargedPriceTableFrom(new Map(), settings), chargedCredits, settings.charged)
  stated = { chargeOf, rateOf, rate: rateOf, credits: (identifier, units = 1) => chargeOf([{ id: identifier, units }]) }
  return stated
}

let statedTable: ChargedPriceTable | null = null

/**
 * The server's price table at the hosted deployment's settings — the table
 * {@link statedPrices} prices one id from — for a figure stored in the
 * repository that sums many charges: a built-in template's listed price
 * (`template-card-prices.ts`). Each id is charged as `chargedPriceTableFrom`
 * charges it over `STATIC_CREDIT_COSTS`, except an id of the settings'
 * `charged` snapshot (one the deployment charges differently from the in-repo
 * rule), which is charged its snapshot figure per unit: a whole number of
 * units is that many times the figure, and any other amount throws, since a
 * snapshot is a figure, never a rule (`docsPricing`).
 */
export function statedPriceTable(): ChargedPriceTable {
  if (statedTable) return statedTable
  const settings = loadDocsPriceSettings()
  const table = chargedPriceTableFrom(new Map(), settings)
  const snapshot = settings.charged
  statedTable = {
    ...table,
    base: (identifier) => snapshot[identifier] ?? table.base(identifier),
    charge: (identifier, baseCredits) => {
      const figure = snapshot[identifier]
      if (figure === undefined) return table.charge(identifier, baseCredits)
      if (baseCredits % figure !== 0) {
        throw new Error(`"${identifier}" is priced from the charged snapshot (${figure}), which cannot price ${baseCredits / figure} units`)
      }
      return baseCredits
    },
  }
  return statedTable
}

let hosted: StatedPrices | null = null

/**
 * {@link statedPrices} as the HOSTED deployment prices, for text generated
 * into the repository (the node skills' `**Credit cost:**` line): a metered
 * LLM price key at its estimate whatever this process's edition or rollback
 * switch says — metered pricing is the hosted default (D6), and a generated
 * file must not depend on the environment it was generated in (the CI drift
 * gate runs without an edition). Every other id exactly as `statedPrices`.
 * Text built at runtime (MCP tool descriptions) asks `statedPrices`, which
 * follows the switch.
 */
export function hostedStatedPrices(): StatedPrices {
  if (hosted) return hosted
  const base = statedPrices()
  const settings = loadDocsPriceSettings()
  hosted = {
    ...base,
    credits: (identifier, units = 1) =>
      (units === 1 ? meteredLlmEstimateIgnoringSwitch(identifier, settings) : undefined) ?? base.credits(identifier, units),
    llmQuote: (identifier) => {
      if (!parseMeteredLlmId(identifier)) return null
      const credits = meteredLlmEstimateIgnoringSwitch(identifier, settings)
      return credits === undefined ? { kind: "unpriced" } : { kind: "estimate", credits }
    },
  }
  return hosted
}
