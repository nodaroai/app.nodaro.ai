/**
 * What a schedule WILL do — today's runs, the next few, how many a day — for
 * the node card and the panel's "When it runs" card. Everything here is the
 * server's own arithmetic (`@nodaro/shared` schedule-rules), so the preview
 * cannot promise a minute the cron will not fire.
 *
 * "Today" is the schedule's own day: midnight-to-midnight in its timezone,
 * not the browser's.
 */

import {
  localTimeIn,
  nextScheduleRuns,
  scheduleOccurrences,
  timezoneOffsetMinutes,
  type ScheduleRule,
} from "@nodaro/shared"

const DAY_MS = 86_400_000

export interface ScheduleDayMark {
  /** Minute of the schedule's day, 0–1439. */
  readonly minuteOfDay: number
  readonly past: boolean
}

/** Midnight of `now`'s date in the schedule's timezone, as an instant. */
export function startOfScheduleDay(now: Date, timezone: string): Date {
  const local = localTimeIn(now, timezone)
  const minuteFloor = Math.floor(now.getTime() / 60_000) * 60_000
  const guess = new Date(minuteFloor - (local.hour * 60 + local.minute) * 60_000)
  // The clocks may have changed between midnight and now; the offset
  // difference is exactly how far the guess is off.
  const drift = timezoneOffsetMinutes(now, timezone) - timezoneOffsetMinutes(guess, timezone)
  return new Date(guess.getTime() + drift * 60_000)
}

/**
 * Every run in the schedule's current day, as a position on a 24-hour bar.
 * The day ends at the NEXT local midnight — 23 or 25 hours away when the
 * clocks change — never at "24 hours from midnight".
 */
export function scheduleDayMarks(rules: ReadonlyArray<ScheduleRule>, timezone: string, now: Date): ScheduleDayMark[] {
  if (rules.length === 0) return []
  const dayStart = startOfScheduleDay(now, timezone)
  const nextMidnight = startOfScheduleDay(new Date(dayStart.getTime() + 36 * 3_600_000), timezone)
  const dayEnd = new Date(nextMidnight.getTime() - 60_000)
  return scheduleOccurrences({ rules, timezone }, dayStart, dayEnd, 1500).map((run) => {
    const local = localTimeIn(run, timezone)
    return { minuteOfDay: local.hour * 60 + local.minute, past: run.getTime() < now.getTime() }
  })
}

/** How many times the schedule runs in the next 24 hours — [now, now + 24 h).
 *  `scheduleOccurrences` includes BOTH ends, so the window stops 1 ms short:
 *  with `now + 24 h` itself included, a run at `now` was counted again a day
 *  later (an every-15-minutes schedule read 97 runs at every :00/:15/:30/:45
 *  minute, 96 otherwise). One millisecond — not a minute — so a `now` with
 *  seconds still reaches the minute 24 hours on. */
export function scheduleRunsPerDay(rules: ReadonlyArray<ScheduleRule>, timezone: string, now: Date): number {
  if (rules.length === 0) return 0
  return scheduleOccurrences({ rules, timezone }, now, new Date(now.getTime() + DAY_MS - 1), 5000).length
}

/**
 * The next `count` runs after `now`. `nextScheduleRuns` looks as far ahead
 * as the rules need (two periods of the slowest one, `previewHorizonMs`), so
 * a quarterly or yearly rule gets its "next run" in one pass.
 */
export function scheduleUpcomingRuns(rules: ReadonlyArray<ScheduleRule>, timezone: string, now: Date, count: number): Date[] {
  if (rules.length === 0 || count <= 0) return []
  return nextScheduleRuns({ rules, timezone }, now, count)
}

/** The next run after `now`, or null when there is none within a year. */
export function scheduleNextRun(rules: ReadonlyArray<ScheduleRule>, timezone: string, now: Date): Date | null {
  return scheduleUpcomingRuns(rules, timezone, now, 1)[0] ?? null
}
