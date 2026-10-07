import type { CompetitorCompareInput } from "@nodaro/shared"

/**
 * The periods the brand window compares, in the person's local days. Pure,
 * so the picker and its tests share it.
 */

export const PERIOD_PRESETS = ["week", "month", "calendarMonth", "day", "custom"] as const
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]

export interface Period {
  readonly from: Date
  readonly to: Date
}

/** The period looked at, and the one it is compared with (none for a single day). */
export interface Periods {
  readonly a: Period
  readonly b: Period | null
}

const DAY_MS = 86_400_000

/** The first moment of the day, local time. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** The last moment of the day, local time. */
export function endOfDay(d: Date): Date {
  return new Date(startOfDay(d).getTime() + DAY_MS - 1)
}

const daysAgo = (now: Date, n: number): Date => new Date(startOfDay(now).getTime() - n * DAY_MS)

/** The last `n` days ending today, and the `n` before them. */
function lastDays(now: Date, n: number): Periods {
  return {
    a: { from: daysAgo(now, n - 1), to: endOfDay(now) },
    b: { from: daysAgo(now, 2 * n - 1), to: endOfDay(daysAgo(now, n)) },
  }
}

/** The periods a preset means today. */
export function presetPeriods(preset: PeriodPreset, now: Date): Periods {
  switch (preset) {
    case "week":
      return lastDays(now, 7)
    case "month":
      return lastDays(now, 30)
    case "calendarMonth": {
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      return { a: { from: thisMonth, to: endOfDay(now) }, b: { from: lastMonth, to: new Date(thisMonth.getTime() - 1) } }
    }
    case "day":
      return { a: { from: startOfDay(now), to: endOfDay(now) }, b: null }
    case "custom":
      return lastDays(now, 7)
  }
}

/** A date input's value (`yyyy-mm-dd`) for a local day. */
export function dateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The local day a date input names; null for anything else. */
export function dayOf(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(d.getTime()) || dateInputValue(d) !== value ? null : d
}

/** A period from two date inputs, whole days; null when either is not a day or the period ends before it starts. */
export function periodOf(from: string, to: string): Period | null {
  const a = dayOf(from)
  const b = dayOf(to)
  if (!a || !b || b.getTime() < a.getTime()) return null
  return { from: a, to: endOfDay(b) }
}

/** The compare request for the periods. */
export function compareInput(periods: Periods): CompetitorCompareInput {
  return {
    from: periods.a.from.toISOString(),
    to: periods.a.to.toISOString(),
    ...(periods.b ? { vsFrom: periods.b.from.toISOString(), vsTo: periods.b.to.toISOString() } : {}),
  }
}

/** The earliest day the plan still keeps: `months` months before today. */
export function earliestDay(now: Date, months: number): Date {
  const d = startOfDay(now)
  d.setMonth(d.getMonth() - months)
  return d
}
