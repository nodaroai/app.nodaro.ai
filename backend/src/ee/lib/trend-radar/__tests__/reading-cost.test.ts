/**
 * reading-cost.ts: one candidate's reading is priced as the run's own
 * searches (one per platform, each at its charged price), and the summary
 * carries the runner's balance; a price that cannot be read is null, never 0.
 */
import { describe, it, expect, vi } from "vitest"
import { SOCIAL_SEARCH_CREDIT_COSTS, socialSearchCreditId } from "@nodaro/shared/social"

vi.mock("../../../billing/credits.js", () => ({
  getModelCreditCostFromDB: vi.fn(async (id: string) => ({ creditCost: SOCIAL_SEARCH_CREDIT_COSTS[id] ?? 0, isEnabled: true, tierRestriction: null })),
}))
vi.mock("../store.js", () => ({
  readRunnerCredits: vi.fn(async (runner: string | null) => (runner ? 36_977 : null)),
}))

const { RADAR_SEARCHES } = await import("../run.js")
const { creditsPerRead, readingCost } = await import("../reading-cost.js")

describe("reading cost", () => {
  it("prices a reading as the sum of its searches' charged prices", async () => {
    const asked: string[] = []
    const perRead = await creditsPerRead(async (id) => {
      asked.push(id)
      return 10
    })
    expect(asked).toEqual(RADAR_SEARCHES.map((s) => socialSearchCreditId(s.count)))
    expect(perRead).toBe(10 * RADAR_SEARCHES.length)
  })

  it("at the table's prices: three pages on TikTok and Instagram, one on YouTube", async () => {
    expect(await creditsPerRead()).toBe(140)
  })

  it("a price that cannot be read gives null, not a reading that looks free", async () => {
    expect(await creditsPerRead(async () => { throw new Error("no price") })).toBeNull()
  })

  it("answers searches per read, the price and the runner's balance", async () => {
    expect(await readingCost("runner-1")).toEqual({ searchesPerRead: 3, creditsPerRead: 140, runnerCredits: 36_977, maxSearchesPerDay: 5000, deepSearchesMax: 4, creditsPerDeepSearch: 60 })
    expect((await readingCost(null)).runnerCredits).toBeNull()
  })
})
