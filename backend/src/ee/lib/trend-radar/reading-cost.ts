// @registry-enumerates prices the radar's own search credit ids via getModelCreditCostFromDB: credit ids, not node types, so not a @registry-lookup
/**
 * What a day's reading costs, so the admin sets the budget in candidates and
 * sees it in credits: one candidate's reading is the run's own searches
 * (`RADAR_SEARCHES`, one per platform), each priced at what the account the
 * run searches as is charged for it (the search's credit id at its charged
 * price), next to that account's balance.
 */
import { socialSearchCreditId } from "@nodaro/shared/social"
import { getModelCreditCostFromDB } from "../../billing/credits.js"
import { DEEP_SEARCHES_MAX, RADAR_SEARCHES } from "./run.js"
import { readRunnerCredits } from "./store.js"
import { DAILY_SEARCH_BUDGET_MAX, type TrendRadarReadingCost } from "./types.js"

/** The charged price of one credit id. */
export type PriceOf = (creditId: string) => Promise<number>

const chargedPrice: PriceOf = async (creditId) => (await getModelCreditCostFromDB(creditId)).creditCost

/** Credits one candidate's reading is charged, or null when a price cannot be read. */
export async function creditsPerRead(priceOf: PriceOf = chargedPrice): Promise<number | null> {
  try {
    const prices = await Promise.all(RADAR_SEARCHES.map((s) => priceOf(socialSearchCreditId(s.count))))
    return prices.reduce((sum, p) => sum + p, 0)
  } catch {
    return null
  }
}

/** Credits one search of the deeper count is charged (a full page count, as the platforms it deepens search), or null when the price cannot be read. */
export async function creditsPerDeepSearch(priceOf: PriceOf = chargedPrice): Promise<number | null> {
  const deepCount = Math.max(...RADAR_SEARCHES.map((s) => s.count)) as (typeof RADAR_SEARCHES)[number]["count"]
  try {
    return await priceOf(socialSearchCreditId(deepCount))
  } catch {
    return null
  }
}

export async function readingCost(runnerUserId: string | null, priceOf?: PriceOf): Promise<TrendRadarReadingCost> {
  const [perRead, perDeep, runnerCredits] = await Promise.all([creditsPerRead(priceOf), creditsPerDeepSearch(priceOf), readRunnerCredits(runnerUserId)])
  return {
    searchesPerRead: RADAR_SEARCHES.length,
    creditsPerRead: perRead,
    runnerCredits,
    maxSearchesPerDay: DAILY_SEARCH_BUDGET_MAX,
    deepSearchesMax: DEEP_SEARCHES_MAX,
    creditsPerDeepSearch: perDeep,
  }
}
