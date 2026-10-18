/**
 * `statedPrices()` — the charged prices every generated or registered text
 * states: `docsPricing` over the server's own price-table rule at the hosted
 * deployment's settings. See `docs-pricing.ts` for why text prices this way.
 */
import { chargedCredits, chargedPriceTableFrom } from "./credits.js"
import { docsPricing, loadDocsPriceSettings, type ChargeOf, type RateOf } from "./docs-pricing.js"

export interface StatedPrices {
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
