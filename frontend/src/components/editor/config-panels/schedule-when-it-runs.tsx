"use client"

import { useMemo } from "react"
import type { ScheduleRule } from "@nodaro/shared/workflow"

import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { useNowMinute } from "@/hooks/use-now-minute"
import { scheduleDayMarks, scheduleRunsPerDay, scheduleUpcomingRuns } from "@/lib/schedule-preview"
import { describeSchedule, formatRunMoment, relativeFromNow, runsPerDayLabel } from "@/lib/schedule-words"

const HOUR_TICKS = ["00", "06", "12", "18", "24"]

/**
 * The panel's "When it runs" card: the schedule in words, runs per day, today
 * on a 24-hour bar (past grey, upcoming pink — the schedule's own day, in its
 * timezone) and the next three runs. All of it is the server's arithmetic on
 * the rules the server will run (already normalised by the caller), so what
 * is shown is what will happen. This card alone subscribes to the minute
 * tick, so the rest of the panel never re-renders under a person's typing.
 */
export function ScheduleWhenItRuns({
  rules,
  timezone,
  timezoneReadable,
  locale,
}: {
  readonly rules: ReadonlyArray<ScheduleRule>
  readonly timezone: string
  readonly timezoneReadable: boolean
  readonly locale: string
}) {
  const t = useT()
  const now = useNowMinute()
  const rulesKey = JSON.stringify(rules)
  const preview = useMemo(
    () =>
      timezoneReadable
        ? {
            marks: scheduleDayMarks(rules, timezone, now),
            perDay: scheduleRunsPerDay(rules, timezone, now),
            upcoming: scheduleUpcomingRuns(rules, timezone, now, 3),
          }
        : { marks: [], perDay: 0, upcoming: [] },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rules compared by content, not identity
    [rulesKey, timezone, timezoneReadable, now],
  )

  return (
    <div className="rounded-xl border border-border overflow-hidden" data-testid="schedule-when-it-runs">
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">{t("sched.whenItRuns")}</p>
          <p className="text-[15px] font-semibold leading-snug text-foreground text-pretty">{describeSchedule(rules, t, locale)}</p>
        </div>
        {timezoneReadable && (
          <span className="shrink-0 rounded-full bg-[#ff0073]/10 px-2.5 py-1 text-[11px] font-semibold text-[#ff0073]">
            {runsPerDayLabel(preview.perDay, t)}
          </span>
        )}
      </div>

      {!timezoneReadable ? (
        <p className="px-4 pb-3.5 text-xs text-destructive" data-testid="schedule-timezone-unreadable">
          {t("sched.cannotRunTimezone", { tz: timezone })}
        </p>
      ) : (
        <>
          <div className="px-4 pb-3">
            <div className="relative h-8 rounded-lg border border-border/70 bg-muted/30" role="img" aria-label={t("sched.whenItRuns")}>
              {preview.marks.map((mark, i) => (
                <span
                  key={`${mark.minuteOfDay}-${i}`}
                  data-testid={mark.past ? "run-mark-past" : "run-mark-upcoming"}
                  className={cn("absolute top-1.5 bottom-1.5 w-0.5 rounded-sm", mark.past ? "bg-muted-foreground/30" : "bg-[#ff0073]")}
                  style={{ insetInlineStart: `${(mark.minuteOfDay / 1440) * 100}%` }}
                />
              ))}
              <div className="absolute inset-0 flex pointer-events-none">
                <div className="flex-1 border-e border-border/50" />
                <div className="flex-1 border-e border-border/50" />
                <div className="flex-1 border-e border-border/50" />
                <div className="flex-1" />
              </div>
            </div>
            <div className="mt-1 flex justify-between text-[11px] font-semibold tracking-wider text-muted-foreground" dir="ltr">
              {HOUR_TICKS.map((tick) => <span key={tick}>{tick}</span>)}
            </div>
          </div>

          <div className="border-t border-border/70 bg-muted/20 px-4 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">{t("sched.upcoming")}</p>
            {preview.upcoming.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">{t("sched.noUpcomingRun")}</p>
            ) : (
              <ul className="flex flex-col">
                {preview.upcoming.map((run) => {
                  const { day, time } = formatRunMoment(run, timezone, locale)
                  return (
                    <li key={run.toISOString()} className="flex items-center gap-2.5 py-1 text-xs">
                      <span className="size-1.5 rounded-full bg-[#ff0073] shrink-0" />
                      <span className="flex-1 font-medium text-foreground">{day}, {time}</span>
                      <span className="text-muted-foreground">{relativeFromNow(run, now, locale, t)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
