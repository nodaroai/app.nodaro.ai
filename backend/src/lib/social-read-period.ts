import { isValidTimezone, localTimeIn, SOCIAL_READ_DAY_PATTERN, timezoneOffsetMinutes, type SocialReadPeriod } from "@nodaro/shared"

/**
 * The time range Read Inspiration and Read Competitor read: the last N hours
 * or days, or one calendar day in the node's timezone (the browser's, stored
 * when the day was picked; UTC when it is missing). `[from, to)` in epoch
 * milliseconds.
 */
export interface SocialReadPeriodInput {
  readonly period: SocialReadPeriod
  readonly windowAmount: number
  readonly windowUnit: "hours" | "days"
  readonly day?: string
  readonly timezone?: string
}

export interface SocialReadRange {
  readonly from: number
  readonly to: number
}

const HOUR_MS = 3_600_000
/** The years a day may name: no post or scan is older, and a far-future date would overflow the date math. */
const FIRST_YEAR = 1970
const LAST_YEAR = 2100

function parseDay(day: string): { y: number; m: number; d: number } | null {
  if (!SOCIAL_READ_DAY_PATTERN.test(day)) return null
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  if (y < FIRST_YEAR || y > LAST_YEAR) return null
  const check = new Date(Date.UTC(y, m - 1, d))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null
  return { y, m, d }
}

/**
 * When a calendar day starts in a timezone, in epoch milliseconds. Two passes
 * settle the offset across a clock change; where the clocks spring forward AT
 * midnight (the day starts at 01:00), the second pass lands in the day before,
 * so the earliest guess that is inside the day wins.
 */
export function zonedDayStart(day: string, timezone: string | undefined): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  const midnightAsUtc = Date.UTC(y, m - 1, d)
  const zone = isValidTimezone(timezone) ? timezone : "UTC"
  const first = midnightAsUtc - timezoneOffsetMinutes(new Date(midnightAsUtc), zone) * 60_000
  const second = midnightAsUtc - timezoneOffsetMinutes(new Date(first), zone) * 60_000
  const epochDay = Math.floor(midnightAsUtc / 86_400_000)
  const inDay = (t: number) => localTimeIn(new Date(t), zone).epochDay === epochDay
  return [Math.min(first, second), Math.max(first, second)].find(inDay) ?? second
}

/** The day after `day` ("2026-12-31" → "2027-01-01"). */
function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** The range to read; null for a day that is not a real calendar date between 1970 and 2100. */
export function socialReadRange(input: SocialReadPeriodInput, now: number = Date.now()): SocialReadRange | null {
  if (input.period === "day") {
    const day = input.day ?? ""
    if (!parseDay(day)) return null
    const from = zonedDayStart(day, input.timezone)
    const to = zonedDayStart(nextDay(day), input.timezone)
    return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null
  }
  const hours = input.windowUnit === "days" ? input.windowAmount * 24 : input.windowAmount
  return { from: now - hours * HOUR_MS, to: now }
}
