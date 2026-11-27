// The daily reading in the units an admin decides in: candidates read per day
// and the credits that costs. The server keeps the budget in searches
// (`thresholds.dailySearchBudget`); one candidate's reading is
// `searchesPerRead` of them, so the two convert exactly both ways.

import type { TrendRadarReadingCost } from "@nodaro/sdk/trend-radar"

/** The quick picks offered for candidates read per day. */
export const READ_PRESETS: readonly number[] = [200, 300, 600]

/** Whole candidates a search budget reads. */
export function readsOf(budget: number, searchesPerRead: number): number {
  return Number.isFinite(budget) && searchesPerRead > 0 ? Math.floor(budget / searchesPerRead) : Number.NaN
}

/** The search budget that reads `reads` candidates. */
export function budgetOf(reads: number, searchesPerRead: number): number {
  return Number.isFinite(reads) ? reads * searchesPerRead : Number.NaN
}

export interface ReadingOutlook {
  reads: number
  searches: number
  /** Candidates a day's run would really read: the budget, or fewer when fewer are open. */
  readToday: number
  /** Credits a day at most (the budget fully spent), or null with no price. */
  creditsPerDay: number | null
  /** Credits today's open candidates would take, or null with no price. */
  creditsToday: number | null
  /** Days between two readings of the same candidate, when the budget cannot read them all daily. */
  everyDays: number | null
  /** Whole days the runner's balance lasts at today's pace, or null when unknown or nothing is spent. */
  daysOfCredits: number | null
  /** The runner's balance does not cover one day. */
  short: boolean
}

export function readingOutlook(reads: number, cost: TrendRadarReadingCost, open: number | null): ReadingOutlook {
  const readToday = open === null ? reads : Math.min(reads, open)
  const perRead = cost.creditsPerRead
  const creditsToday = perRead === null ? null : readToday * perRead
  const everyDays = open !== null && reads > 0 && reads < open ? Math.ceil(open / reads) : null
  const balance = cost.runnerCredits
  const daysOfCredits = balance === null || !creditsToday ? null : Math.floor(balance / creditsToday)
  return {
    reads,
    searches: budgetOf(reads, cost.searchesPerRead),
    readToday,
    creditsPerDay: perRead === null ? null : reads * perRead,
    creditsToday,
    everyDays,
    daysOfCredits,
    short: daysOfCredits !== null && daysOfCredits < 1,
  }
}

/** Why a search budget cannot be saved, or null. */
export function budgetProblem(budget: number, cost: TrendRadarReadingCost | undefined): string | null {
  if (!cost) return Number.isInteger(budget) && budget >= 0 ? null : "Search budget per day needs a whole number of at least 0."
  const max = Math.floor(cost.maxSearchesPerDay / cost.searchesPerRead)
  if (!Number.isInteger(budget) || budget < 0) return "Trends read per day needs a whole number of at least 0."
  if (budget > cost.maxSearchesPerDay) return `Trends read per day is at most ${max.toLocaleString("en-US")}.`
  return null
}

/** The "Searches today" tile's hint: the budget, and in candidates once the summary says how many searches one takes. */
export function searchesHint(budget: number, searchesPerRead: number | undefined): string {
  if (!searchesPerRead) return `of ${budget} daily budget`
  return `of ${budget.toLocaleString("en-US")} · ${readsOf(budget, searchesPerRead).toLocaleString("en-US")} trends a day`
}
