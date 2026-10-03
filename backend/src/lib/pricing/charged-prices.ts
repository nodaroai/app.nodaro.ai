/**
 * The prices users are charged, for the core surfaces that list them:
 * `GET /v1/models`, MCP `list_models` and `GET /v1/nodes`.
 *
 * A listed price has to be the price a run is charged. It used to be the base
 * price from the catalog, so the list and the Run button disagreed whenever an
 * admin priced a model above its base (listed 150, charged 165). The numbers
 * now come from `ee/billing/credits.ts :: getChargedPriceTable`, the batch twin
 * of the lookup the Run button and every reservation use.
 *
 * The billing module is loaded with a dynamic `import()`, and only when the
 * edition has a credit system — the `middleware/credit-guard.ts` pattern — so
 * a community build never loads it. Without a credit system nothing is
 * charged: every lookup answers undefined, and the surfaces show no prices.
 */
import { hasCredits } from "../config.js"

export interface ChargedPrices {
  /**
   * The credits charged for `units` of `identifier` (1 by default; a rate row
   * such as a per-second price takes the seconds), or undefined when the
   * identifier is priced nowhere or the edition charges nothing. `units`
   * multiply the base before it is marked up, the way a route that computes
   * its price reserves it.
   */
  credits(identifier: string, units?: number): number | undefined
}

const NO_PRICES: ChargedPrices = { credits: () => undefined }

let creditsModulePromise: Promise<typeof import("../../ee/billing/credits.js")> | null = null
function loadCreditsModule(): Promise<typeof import("../../ee/billing/credits.js")> {
  return (creditsModulePromise ??= import("../../ee/billing/credits.js"))
}

export async function loadChargedPrices(): Promise<ChargedPrices> {
  if (!hasCredits()) return NO_PRICES
  const { getChargedPriceTable, chargedCredits } = await loadCreditsModule()
  const table = await getChargedPriceTable()
  return { credits: (identifier, units) => chargedCredits(table, identifier, units) }
}
