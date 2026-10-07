import { describe, it, expect } from "vitest"
import { socialReadRange, zonedDayStart } from "../social-read-period.js"

const NOW = Date.parse("2026-10-07T12:00:00Z")

describe("socialReadRange", () => {
  it("a window reaches back from now, in hours or days", () => {
    expect(socialReadRange({ period: "window", windowAmount: 24, windowUnit: "hours" }, NOW)).toEqual({ from: Date.parse("2026-10-06T12:00:00Z"), to: NOW })
    expect(socialReadRange({ period: "window", windowAmount: 7, windowUnit: "days" }, NOW)).toEqual({ from: Date.parse("2026-09-30T12:00:00Z"), to: NOW })
  })

  it("a day is that calendar day in the node's timezone", () => {
    // Israel is UTC+3 in October (summer time).
    expect(socialReadRange({ period: "day", windowAmount: 1, windowUnit: "days", day: "2026-10-06", timezone: "Asia/Jerusalem" }, NOW)).toEqual({
      from: Date.parse("2026-10-05T21:00:00Z"),
      to: Date.parse("2026-10-06T21:00:00Z"),
    })
    expect(socialReadRange({ period: "day", windowAmount: 1, windowUnit: "days", day: "2026-10-06", timezone: "America/New_York" }, NOW)).toEqual({
      from: Date.parse("2026-10-06T04:00:00Z"),
      to: Date.parse("2026-10-07T04:00:00Z"),
    })
  })

  it("a day with no timezone, or an unknown one, is the UTC day", () => {
    const utcDay = { from: Date.parse("2026-10-06T00:00:00Z"), to: Date.parse("2026-10-07T00:00:00Z") }
    expect(socialReadRange({ period: "day", windowAmount: 1, windowUnit: "days", day: "2026-10-06" }, NOW)).toEqual(utcDay)
    expect(socialReadRange({ period: "day", windowAmount: 1, windowUnit: "days", day: "2026-10-06", timezone: "Mars/Olympus" }, NOW)).toEqual(utcDay)
  })

  it("a day the clocks change on is 23 or 25 hours long", () => {
    // Israel leaves summer time on 2026-10-25 (02:00 → 01:00).
    const r = socialReadRange({ period: "day", windowAmount: 1, windowUnit: "days", day: "2026-10-25", timezone: "Asia/Jerusalem" }, NOW)
    expect(r && (r.to - r.from) / 3_600_000).toBe(25)
  })

  it("where the clocks spring forward AT midnight, the day starts at 01:00 and lasts 23 hours", () => {
    // Chile starts summer time on 2026-09-06: 00:00 (UTC-4) becomes 01:00 (UTC-3).
    const r = socialReadRange({ period: "day", windowAmount: 1, windowUnit: "days", day: "2026-09-06", timezone: "America/Santiago" }, NOW)
    expect(r).toEqual({ from: Date.parse("2026-09-06T04:00:00Z"), to: Date.parse("2026-09-07T03:00:00Z") })
    // The day before ends where this one starts: it keeps its last hour.
    const before = socialReadRange({ period: "day", windowAmount: 1, windowUnit: "days", day: "2026-09-05", timezone: "America/Santiago" }, NOW)
    expect(before?.to).toBe(r?.from)
  })

  it("a year outside 1970-2100 reads nothing (and never throws)", () => {
    expect(socialReadRange({ period: "day", windowAmount: 1, windowUnit: "days", day: "9999-12-31" }, NOW)).toBeNull()
    expect(socialReadRange({ period: "day", windowAmount: 1, windowUnit: "days", day: "1969-12-31" }, NOW)).toBeNull()
  })

  it("a day that is not a calendar date reads nothing", () => {
    expect(socialReadRange({ period: "day", windowAmount: 1, windowUnit: "days", day: "2026-02-30" }, NOW)).toBeNull()
    expect(socialReadRange({ period: "day", windowAmount: 1, windowUnit: "days", day: "6.10.2026" }, NOW)).toBeNull()
    expect(socialReadRange({ period: "day", windowAmount: 1, windowUnit: "days" }, NOW)).toBeNull()
  })

  it("a year's last day ends at the next year's first", () => {
    expect(socialReadRange({ period: "day", windowAmount: 1, windowUnit: "days", day: "2026-12-31" }, NOW)).toEqual({
      from: Date.parse("2026-12-31T00:00:00Z"),
      to: Date.parse("2027-01-01T00:00:00Z"),
    })
  })
})

describe("zonedDayStart", () => {
  it("is local midnight", () => {
    expect(new Date(zonedDayStart("2026-01-15", "Asia/Tokyo")).toISOString()).toBe("2026-01-14T15:00:00.000Z")
  })
})
