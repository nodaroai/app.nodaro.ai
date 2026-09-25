/**
 * A schedule in the person's words — the card headline, the panel's rule
 * titles, "Next run today at 11:35". Built from the rule's fields with the
 * app's dictionary (`useT`) and `Intl`, so Hebrew reads as Hebrew and clock
 * times follow the locale. Deliberately NOT in `@nodaro/shared`: words are
 * UI, the wire contract is the rule.
 */

import { localTimeIn, type ScheduleRule } from "@nodaro/shared"
import type { TFunction } from "@/lib/i18n"

/** A fixed Sunday, so weekday names come from Intl rather than a hand list. */
const A_SUNDAY_UTC = Date.UTC(2026, 0, 4, 12, 0, 0)

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** "9:00 AM" / "09:00" — a wall-clock time in the locale's own clock style. */
export function clockLabel(hour: number, minute: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
      .format(new Date(Date.UTC(2026, 0, 4, hour, minute)))
  } catch {
    return `${pad2(hour)}:${pad2(minute)}`
  }
}

/** "9 AM" / "09" — the hour alone, for the hour picker. */
export function hourLabel(hour: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4, hour)))
  } catch {
    return pad2(hour)
  }
}

/** "Mon" — weekday 0 = Sunday … 6 = Saturday, in the locale. */
export function weekdayShort(day: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(A_SUNDAY_UTC + day * 86_400_000))
  } catch {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day] ?? "?"
  }
}

/** One rule in words. */
export function describeScheduleRule(rule: ScheduleRule, t: TFunction, locale: string): string {
  const n = Math.max(1, rule.every ?? 1)
  const time = clockLabel(rule.hour ?? 0, rule.minute ?? 0, locale)
  const mm = pad2(rule.minute ?? 0)
  switch (rule.kind) {
    case "minutes":
      return n === 1 ? t("sched.everyMinute") : t("sched.everyNMinutes", { n })
    case "hours":
      return n === 1 ? t("sched.everyHourAt", { mm }) : t("sched.everyNHoursAt", { n, mm })
    case "days":
      return n === 1 ? t("sched.everyDayAt", { time }) : t("sched.everyNDaysAt", { n, time })
    case "weeks": {
      const days = (rule.weekdays ?? []).map((d) => weekdayShort(d, locale)).join(t("common.listComma"))
      return n === 1 ? t("sched.everyWeekOn", { days, time }) : t("sched.everyNWeeksOn", { n, days, time })
    }
    case "months": {
      const d = rule.dayOfMonth ?? 1
      return n === 1 ? t("sched.everyMonthOnDay", { d, time }) : t("sched.everyNMonthsOnDay", { n, d, time })
    }
    case "cron":
      return t("sched.customCron")
  }
}

/** The whole schedule in words: the one rule, or "N schedules". */
export function describeSchedule(rules: ReadonlyArray<ScheduleRule>, t: TFunction, locale: string): string {
  if (rules.length === 0) return t("sched.noSchedule")
  if (rules.length === 1) return describeScheduleRule(rules[0], t, locale)
  return t("sched.nSchedules", { n: rules.length })
}

/** "Tue, Sep 22" and "11:35 AM", in the schedule's timezone. */
export function formatRunMoment(run: Date, timezone: string, locale: string): { readonly day: string; readonly time: string } {
  try {
    return {
      day: new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: timezone }).format(run),
      time: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(run),
    }
  } catch {
    const local = localTimeIn(run, timezone)
    return { day: `${local.year}-${pad2(local.month)}-${pad2(local.day)}`, time: `${pad2(local.hour)}:${pad2(local.minute)}` }
  }
}

/** "Next run today at 11:35" / "Next run Tue, Sep 22 at 9:00 AM" / "No run in the next year". */
export function describeNextRun(next: Date | null, now: Date, timezone: string, locale: string, t: TFunction): string {
  if (!next) return t("sched.noUpcomingRun")
  const { day, time } = formatRunMoment(next, timezone, locale)
  const today = localTimeIn(next, timezone).epochDay === localTimeIn(now, timezone).epochDay
  return today ? t("sched.nextRunToday", { time }) : t("sched.nextRunOn", { date: day, time })
}

/** "in 20 minutes" / "in 3 hours" / "in 2 days" — how far away a run is, rounded DOWN (90 minutes is "in 1 hour", not two). */
export function relativeFromNow(run: Date, now: Date, locale: string, t: TFunction): string {
  const minutes = Math.floor((run.getTime() - now.getTime()) / 60_000)
  if (minutes < 1) return t("sched.inUnderAMinute")
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always" })
    if (minutes < 60) return rtf.format(minutes, "minute")
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return rtf.format(hours, "hour")
    return rtf.format(Math.floor(hours / 24), "day")
  } catch {
    return minutes < 60 ? `in ${minutes} min` : `in ${Math.floor(minutes / 60)} h`
  }
}

export function runsPerDayLabel(n: number, t: TFunction): string {
  return n === 1 ? t("sched.oneRunPerDay") : t("sched.runsPerDay", { n })
}

export function ruleCountLabel(n: number, t: TFunction): string {
  return n === 1 ? t("sched.oneRule") : t("sched.nRules", { n })
}
