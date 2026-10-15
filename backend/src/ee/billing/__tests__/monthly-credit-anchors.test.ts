import { describe, it, expect } from "vitest"
import { latestMonthlyAnchor, monthlyAnchor } from "../monthly-credit-anchors.js"

const at = (iso: string) => new Date(iso)
const iso = (d: Date | null) => (d ? d.toISOString() : null)

describe("monthlyAnchor — period start + k calendar months, in UTC", () => {
  it("k = 0 is the period start itself", () => {
    expect(iso(monthlyAnchor(at("2026-03-10T08:15:00.000Z"), 0))).toBe("2026-03-10T08:15:00.000Z")
  })

  it("keeps the period start's day and UTC time of day", () => {
    const start = at("2026-01-15T10:23:45.678Z")
    expect(iso(monthlyAnchor(start, 1))).toBe("2026-02-15T10:23:45.678Z")
    expect(iso(monthlyAnchor(start, 7))).toBe("2026-08-15T10:23:45.678Z")
  })

  it("clamps a day the month does not have to its last day — and every month is computed from the start, never chained", () => {
    const start = at("2025-01-31T00:00:00.000Z")
    expect(iso(monthlyAnchor(start, 1))).toBe("2025-02-28T00:00:00.000Z")
    // From 31 again, not from the 28 the previous month was clamped to.
    expect(iso(monthlyAnchor(start, 2))).toBe("2025-03-31T00:00:00.000Z")
    expect(iso(monthlyAnchor(start, 3))).toBe("2025-04-30T00:00:00.000Z")
    expect(iso(monthlyAnchor(start, 4))).toBe("2025-05-31T00:00:00.000Z")
  })

  it("follows leap years both ways", () => {
    expect(iso(monthlyAnchor(at("2024-01-31T12:00:00.000Z"), 1))).toBe("2024-02-29T12:00:00.000Z")
    const leapDay = at("2028-02-29T06:00:00.000Z")
    expect(iso(monthlyAnchor(leapDay, 1))).toBe("2028-03-29T06:00:00.000Z")
    expect(iso(monthlyAnchor(leapDay, 12))).toBe("2029-02-28T06:00:00.000Z")
    expect(iso(monthlyAnchor(leapDay, 48))).toBe("2032-02-29T06:00:00.000Z")
  })

  it("crosses the year end", () => {
    const start = at("2025-12-31T23:59:59.999Z")
    expect(iso(monthlyAnchor(start, 1))).toBe("2026-01-31T23:59:59.999Z")
    expect(iso(monthlyAnchor(start, 2))).toBe("2026-02-28T23:59:59.999Z")
    expect(iso(monthlyAnchor(start, 12))).toBe("2026-12-31T23:59:59.999Z")
  })

  it("ignores daylight-saving changes: the anchor keeps the exact UTC time", () => {
    // US clocks change on 2026-03-08 and EU clocks on 2026-10-25 — UTC has no
    // such day, so no anchor moves by an hour across either.
    expect(iso(monthlyAnchor(at("2026-02-08T07:30:00.000Z"), 1))).toBe("2026-03-08T07:30:00.000Z")
    expect(iso(monthlyAnchor(at("2026-03-08T07:30:00.000Z"), 1))).toBe("2026-04-08T07:30:00.000Z")
    expect(iso(monthlyAnchor(at("2026-09-25T00:30:00.000Z"), 1))).toBe("2026-10-25T00:30:00.000Z")
    expect(iso(monthlyAnchor(at("2026-10-25T00:30:00.000Z"), 1))).toBe("2026-11-25T00:30:00.000Z")
  })

  it("refuses a k that is not a whole, non-negative number of months", () => {
    const start = at("2026-01-01T00:00:00.000Z")
    expect(() => monthlyAnchor(start, -1)).toThrow(RangeError)
    expect(() => monthlyAnchor(start, 1.5)).toThrow(RangeError)
    expect(() => monthlyAnchor(start, Number.NaN)).toThrow(RangeError)
  })
})

describe("latestMonthlyAnchor — the anchor a grant is due at", () => {
  const start = at("2026-03-10T00:00:05.000Z")
  const end = at("2027-03-10T00:00:05.000Z")

  it("nothing before the period starts", () => {
    expect(latestMonthlyAnchor(start, end, at("2026-03-09T23:59:59.000Z"))).toBeNull()
  })

  it("the period start itself during the first month (k = 0)", () => {
    expect(iso(latestMonthlyAnchor(start, end, start))).toBe("2026-03-10T00:00:05.000Z")
    expect(iso(latestMonthlyAnchor(start, end, at("2026-04-10T00:00:04.999Z")))).toBe("2026-03-10T00:00:05.000Z")
  })

  it("the next anchor from the very millisecond it is reached", () => {
    expect(iso(latestMonthlyAnchor(start, end, at("2026-04-10T00:00:05.000Z")))).toBe("2026-04-10T00:00:05.000Z")
  })

  it("this month's anchor once its day has come, last month's before it", () => {
    expect(iso(latestMonthlyAnchor(start, end, at("2026-10-15T12:00:00.000Z")))).toBe("2026-10-10T00:00:05.000Z")
    expect(iso(latestMonthlyAnchor(start, end, at("2026-10-09T12:00:00.000Z")))).toBe("2026-09-10T00:00:05.000Z")
  })

  it("a clamped month-end anchor counts from its clamped day", () => {
    const monthEnd = at("2025-01-31T00:00:00.000Z")
    const yearLater = at("2026-01-31T00:00:00.000Z")
    expect(iso(latestMonthlyAnchor(monthEnd, yearLater, at("2025-02-28T12:00:00.000Z")))).toBe("2025-02-28T00:00:00.000Z")
    expect(iso(latestMonthlyAnchor(monthEnd, yearLater, at("2025-03-30T12:00:00.000Z")))).toBe("2025-02-28T00:00:00.000Z")
    expect(iso(latestMonthlyAnchor(monthEnd, yearLater, at("2025-03-31T00:00:00.000Z")))).toBe("2025-03-31T00:00:00.000Z")
  })

  it("never the anchor at or after the period end — that grant belongs to the renewal", () => {
    // At the year end, and on a row whose period was never moved on.
    expect(iso(latestMonthlyAnchor(start, end, end))).toBe("2027-02-10T00:00:05.000Z")
    expect(iso(latestMonthlyAnchor(start, end, at("2027-05-01T00:00:00.000Z")))).toBe("2027-02-10T00:00:05.000Z")
  })

  it("a period that ends before (or as) it starts has no anchor", () => {
    expect(latestMonthlyAnchor(start, start, at("2026-06-01T00:00:00.000Z"))).toBeNull()
    expect(latestMonthlyAnchor(end, start, at("2027-06-01T00:00:00.000Z"))).toBeNull()
  })

  it("an unreadable date has no anchor", () => {
    expect(latestMonthlyAnchor(new Date(Number.NaN), end, at("2026-06-01T00:00:00.000Z"))).toBeNull()
    expect(latestMonthlyAnchor(start, new Date(Number.NaN), at("2026-06-01T00:00:00.000Z"))).toBeNull()
    expect(latestMonthlyAnchor(start, end, new Date(Number.NaN))).toBeNull()
  })
})
