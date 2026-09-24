import { describe, it, expect } from "vitest"
import type { ScheduleRule } from "@nodaro/shared"
import {
  scheduleDayMarks,
  scheduleNextRun,
  scheduleRunsPerDay,
  scheduleUpcomingRuns,
  startOfScheduleDay,
} from "../schedule-preview"

const at = (iso: string) => new Date(iso)
const every20: ScheduleRule[] = [{ id: "a", kind: "minutes", every: 20 }]

describe("startOfScheduleDay — midnight in the schedule's own timezone", () => {
  it("is the zone's midnight, not the browser's", () => {
    expect(startOfScheduleDay(at("2026-07-01T06:30:00Z"), "Asia/Jerusalem").toISOString()).toBe("2026-06-30T21:00:00.000Z")
    expect(startOfScheduleDay(at("2026-07-01T06:30:00Z"), "UTC").toISOString()).toBe("2026-07-01T00:00:00.000Z")
    // 23:30Z on July 1st is already July 2nd in Jerusalem.
    expect(startOfScheduleDay(at("2026-07-01T23:30:00Z"), "Asia/Jerusalem").toISOString()).toBe("2026-07-01T21:00:00.000Z")
  })

  it("is right on the day the clocks change", () => {
    // New York springs forward on 2026-03-08 at 02:00; midnight that day is 05:00Z.
    expect(startOfScheduleDay(at("2026-03-08T15:00:00Z"), "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z")
    // …and falls back on 2026-11-01; midnight that day is 04:00Z (still EDT).
    expect(startOfScheduleDay(at("2026-11-01T15:00:00Z"), "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z")
  })
})

describe("scheduleDayMarks — today on a 24-hour bar", () => {
  it("every 20 minutes is 72 marks, positioned by local minute, past ones before now", () => {
    const now = at("2026-07-01T06:30:00Z") // 09:30 in Jerusalem
    const marks = scheduleDayMarks(every20, "Asia/Jerusalem", now)
    expect(marks).toHaveLength(72)
    expect(marks[0]).toEqual({ minuteOfDay: 0, past: true })
    expect(marks.filter((m) => m.past)).toHaveLength(29) // 00:00 … 09:20
    expect(marks.find((m) => m.minuteOfDay === 9 * 60 + 40)).toEqual({ minuteOfDay: 580, past: false })
  })

  it("the day ends at the NEXT local midnight — a 25-hour fall-back day keeps its late run, a 23-hour spring-forward day takes none of tomorrow's", () => {
    const lateDaily: ScheduleRule[] = [{ id: "a", kind: "days", every: 1, hour: 23, minute: 30 }]
    // New York 2026-11-01 is 25 hours long: 23:30 local is 04:30Z on the 2nd, past "midnight + 24 h".
    expect(scheduleDayMarks(lateDaily, "America/New_York", at("2026-11-01T15:00:00Z"))).toEqual([{ minuteOfDay: 23 * 60 + 30, past: false }])
    // New York 2026-03-08 is 23 hours long: tomorrow's 00:20 run must not appear at the bar's left edge.
    const marks = scheduleDayMarks(every20, "America/New_York", at("2026-03-08T15:00:00Z"))
    expect(marks.filter((m) => m.minuteOfDay < 60 && !m.past)).toEqual([])
    expect(marks).toHaveLength(23 * 3)
  })

  it("no rules, no marks", () => {
    expect(scheduleDayMarks([], "UTC", at("2026-07-01T06:30:00Z"))).toEqual([])
  })
})

describe("runs per day and the next runs", () => {
  // The window is [now, now + 24 h). It once included both ends, so a run AT
  // `now` was counted again a day later: an every-15-minutes schedule read 97
  // at every quarter-hour minute (and the card test failed whenever CI ran it
  // on one — a flaky gate on main).
  it("counts the same runs at every minute of the day — a run at `now` is not counted twice", () => {
    const every15: ScheduleRule[] = [{ id: "q", kind: "minutes", every: 15 }]
    const daily9: ScheduleRule[] = [{ id: "d", kind: "days", every: 1, hour: 9, minute: 0 }]
    const base = Date.parse("2026-09-24T00:00:00Z")
    for (let m = 0; m < 1440; m++) {
      const now = new Date(base + m * 60_000)
      expect(scheduleRunsPerDay(every15, "UTC", now), now.toISOString()).toBe(96)
      expect(scheduleRunsPerDay(daily9, "UTC", now), now.toISOString()).toBe(1)
    }
    // a `now` with seconds still reaches the minute 24 hours on: from 06:30:30
    // the window ends at 06:30:29.999 tomorrow, so tomorrow's 06:30 run counts
    // (a window a whole minute short would stop at 06:29 and read 95)
    expect(scheduleRunsPerDay(every15, "UTC", at("2026-09-24T06:30:30Z"))).toBe(96)
  })

  it("counts the next 24 hours", () => {
    expect(scheduleRunsPerDay(every20, "UTC", at("2026-07-01T06:30:00Z"))).toBe(72)
    expect(scheduleRunsPerDay([{ id: "a", kind: "days", every: 1, hour: 9, minute: 0 }], "UTC", at("2026-07-01T06:30:00Z"))).toBe(1)
  })

  it("lists the next runs, in order, in real time", () => {
    const runs = scheduleUpcomingRuns(every20, "UTC", at("2026-07-01T06:30:00Z"), 3).map((d) => d.toISOString())
    expect(runs).toEqual(["2026-07-01T06:40:00.000Z", "2026-07-01T07:00:00.000Z", "2026-07-01T07:20:00.000Z"])
  })

  it("looks as far ahead as the rules need — a yearly rule gets its next run eleven months out, well past any fixed two-month window", () => {
    const yearly: ScheduleRule[] = [{ id: "a", kind: "months", every: 12, hour: 9, minute: 0, dayOfMonth: 1 }]
    expect(scheduleNextRun(yearly, "UTC", at("2026-02-02T00:00:00Z"))?.toISOString()).toBe("2027-01-01T09:00:00.000Z")
    const halfYearly: ScheduleRule[] = [{ id: "a", kind: "months", every: 6, hour: 0, minute: 0, dayOfMonth: 1 }]
    expect(scheduleNextRun(halfYearly, "UTC", at("2026-09-22T12:00:00Z"))?.toISOString()).toBe("2027-01-01T00:00:00.000Z")
    expect(scheduleNextRun([], "UTC", at("2026-09-22T12:00:00Z"))).toBeNull()
  })
})
