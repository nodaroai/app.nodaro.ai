/** Calendar days as YYYY-MM-DD strings — no time zone, no clock. */

const DAY_MS = 86_400_000
/** The longest range the page offers is 90 days; anything past this is not a real range. */
const MAX_DAYS = 120

/** The day `by` days after `day` (negative: before). */
export function shiftDay(day: string, by: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Every day from `first` to `last`, each with its row or a zero one: Google
 * leaves out the days with nothing in them, and a chart that drew only the
 * days it got would squeeze a quiet week into a few points.
 */
export function everyDay<T extends { date: string }>(rows: readonly T[], first: string, last: string, zero: (date: string) => T): T[] {
  const span = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY_MS) + 1
  // A date Google never sends (or a garbled one) must not become a year of empty days.
  if (!Number.isFinite(span) || span < 1 || span > MAX_DAYS) return [...rows]
  const byDate = new Map(rows.map((row) => [row.date, row]))
  return Array.from({ length: span }, (_, i) => {
    const day = shiftDay(first, i)
    return byDate.get(day) ?? zero(day)
  })
}
