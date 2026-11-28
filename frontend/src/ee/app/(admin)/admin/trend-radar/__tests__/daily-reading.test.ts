import { describe, it, expect } from "vitest"
import type { TrendRadarReadingCost } from "@nodaro/sdk/trend-radar"
import { budgetOf, budgetProblem, readingOutlook, readsOf, searchesHint } from "../daily-reading"

const COST: TrendRadarReadingCost = { searchesPerRead: 3, creditsPerRead: 140, runnerCredits: 36_977, maxSearchesPerDay: 5000, deepSearchesMax: 4, creditsPerDeepSearch: 66 }

describe("daily reading", () => {
  it("converts candidates and searches exactly, a budget between two reads rounding down", () => {
    expect(budgetOf(300, 3)).toBe(900)
    expect(readsOf(900, 3)).toBe(300)
    expect(readsOf(901, 3)).toBe(300)
    expect(readsOf(Number.NaN, 3)).toBeNaN()
    expect(budgetOf(Number.NaN, 3)).toBeNaN()
  })

  it("all open candidates read daily: credits for what is open, the balance in days", () => {
    const o = readingOutlook(300, COST, 120)
    expect(o).toMatchObject({ searches: 900, readToday: 120, creditsPerDay: 42_000, creditsToday: 16_800, everyDays: null, daysOfCredits: 2, short: false })
  })

  it("more open than the budget reads: how often each is read, and a balance short of one day", () => {
    const o = readingOutlook(300, COST, 600)
    expect(o.everyDays).toBe(2)
    expect(o.creditsToday).toBe(42_000)
    expect(o.daysOfCredits).toBe(0)
    expect(o.short).toBe(true)
  })

  it("no price or no runner: no credits and no days, never a reading that looks free", () => {
    expect(readingOutlook(200, { ...COST, creditsPerRead: null }, 50)).toMatchObject({ creditsPerDay: null, creditsToday: null, daysOfCredits: null, short: false })
    expect(readingOutlook(200, { ...COST, runnerCredits: null }, 50)).toMatchObject({ daysOfCredits: null, short: false })
    expect(readingOutlook(0, COST, 50)).toMatchObject({ creditsToday: 0, daysOfCredits: null, everyDays: null })
  })

  it("refuses a budget that is not a whole count or past the server's cap", () => {
    expect(budgetProblem(900, COST)).toBeNull()
    expect(budgetProblem(Number.NaN, COST)).toBe("Trends read per day needs a whole number of at least 0.")
    expect(budgetProblem(6000, COST)).toBe("Trends read per day is at most 1,666.")
    expect(budgetProblem(-3, undefined)).toBe("Search budget per day needs a whole number of at least 0.")
  })

  it("the tile's hint says the budget in candidates once the summary knows the searches per read", () => {
    expect(searchesHint(900, 3)).toBe("of 900 · 300 trends a day")
    expect(searchesHint(60, undefined)).toBe("of 60 daily budget")
  })
})
