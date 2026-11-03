/**
 * Business days for the counter-notice restore window (lib/business-days.ts):
 * the federal holidays as observed, counting across weekends, a holiday week
 * and the year's end, New York dates for a receipt, and a window that opens
 * late enough and closes early enough for every reading of the statute, and
 * always holds at least two weekdays.
 */
import { describe, it, expect } from "vitest"
import {
  addBusinessDays,
  isUsFederalHoliday,
  isWeekend,
  newYorkDate,
  nextWeekday,
  restoreWindow,
  usFederalHolidays,
  windowPosition,
} from "../business-days.js"

describe("usFederalHolidays", () => {
  it("2026, as observed (Independence Day on a Saturday is observed the Friday before)", () => {
    expect(usFederalHolidays(2026)).toEqual([
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-05-25",
      "2026-06-19",
      "2026-07-03",
      "2026-09-07",
      "2026-10-12",
      "2026-11-11",
      "2026-11-26",
      "2026-12-25",
    ])
  })

  it("2027: a Saturday holiday moves to the Friday, a Sunday one to the Monday; 2028's New Year's Day is observed on 2027-12-31", () => {
    const holidays = usFederalHolidays(2027)
    expect(holidays).toContain("2027-06-18")
    expect(holidays).toContain("2027-07-05")
    expect(holidays).toContain("2027-12-24")
    expect(isUsFederalHoliday("2027-12-31")).toBe(true)
    expect(isUsFederalHoliday("2027-12-30")).toBe(false)
  })
})

describe("addBusinessDays", () => {
  it("counts from the day after, across a weekend", () => {
    expect(isWeekend("2026-11-07")).toBe(true)
    expect(addBusinessDays("2026-11-06", 1, { holidaysAreBusinessDays: true })).toBe("2026-11-09")
    expect(addBusinessDays("2026-11-07", 1, { holidaysAreBusinessDays: true })).toBe("2026-11-09")
  })

  it("Thanksgiving week: a holiday is skipped only when holidays are not business days", () => {
    expect(addBusinessDays("2026-11-23", 10, { holidaysAreBusinessDays: false })).toBe("2026-12-08")
    expect(addBusinessDays("2026-11-23", 10, { holidaysAreBusinessDays: true })).toBe("2026-12-07")
  })

  it("the year's end: Christmas and New Year's Day both fall inside the count", () => {
    expect(addBusinessDays("2026-12-18", 10, { holidaysAreBusinessDays: false })).toBe("2027-01-05")
    expect(addBusinessDays("2026-12-18", 14, { holidaysAreBusinessDays: true })).toBe("2027-01-07")
  })

  it("refuses a count that is not a positive whole number, and a date that is not one", () => {
    expect(() => addBusinessDays("2026-11-06", 0, { holidaysAreBusinessDays: true })).toThrow()
    expect(() => addBusinessDays("2026-11-06", 1.5, { holidaysAreBusinessDays: true })).toThrow()
    expect(() => addBusinessDays("2026-02-30", 1, { holidaysAreBusinessDays: true })).toThrow()
  })
})

describe("newYorkDate", () => {
  it("dates an instant where it lands in New York, in winter and in summer time", () => {
    expect(newYorkDate(new Date("2026-11-07T03:30:00Z"))).toBe("2026-11-06")
    expect(newYorkDate(new Date("2026-11-07T05:30:00Z"))).toBe("2026-11-07")
    expect(newYorkDate(new Date("2026-07-01T03:00:00Z"))).toBe("2026-06-30")
  })
})

describe("restoreWindow", () => {
  it("opens once ten full business days have passed (holidays not counted) and closes on the 14th weekday", () => {
    // Received Monday 23 November 2026, 15:00 in New York; Thanksgiving falls inside.
    expect(restoreWindow(new Date("2026-11-23T20:00:00Z"))).toEqual({ receivedOn: "2026-11-23", opensOn: "2026-12-09", closesOn: "2026-12-11" })
  })

  it("a receipt late on a Friday evening in New York is that Friday's, though it is Saturday in UTC", () => {
    expect(restoreWindow(new Date("2026-11-07T02:00:00Z")).receivedOn).toBe("2026-11-06")
  })

  it("for every receipt date from 2026 to 2035: timely under every reading, on weekdays, and at least two weekdays long", () => {
    for (let t = Date.UTC(2026, 0, 1, 17); t < Date.UTC(2036, 0, 1); t += 86_400_000) {
      const window = restoreWindow(new Date(t))
      const at = window.receivedOn
      // Ten full business days have passed under the stricter reading (holidays not counted), so under the other too.
      expect(window.opensOn > addBusinessDays(at, 10, { holidaysAreBusinessDays: false }), at).toBe(true)
      // Not after the 14th business day under either reading.
      expect(window.closesOn <= addBusinessDays(at, 14, { holidaysAreBusinessDays: true }), at).toBe(true)
      expect(window.closesOn <= addBusinessDays(at, 14, { holidaysAreBusinessDays: false }), at).toBe(true)
      expect(isWeekend(window.opensOn) || isWeekend(window.closesOn), at).toBe(false)
      // Never empty: the window holds the opening day and at least one more weekday.
      expect(addBusinessDays(window.opensOn, 1, { holidaysAreBusinessDays: true }) <= window.closesOn, at).toBe(true)
    }
  })
})

describe("nextWeekday", () => {
  it("is the next day that is not a Saturday or a Sunday, holidays included", () => {
    expect(nextWeekday("2026-12-10")).toBe("2026-12-11")
    expect(nextWeekday("2026-12-11")).toBe("2026-12-14")
    expect(nextWeekday("2026-11-25")).toBe("2026-11-26")
  })
})

describe("windowPosition", () => {
  it("before the first day, inside the window, after the last day", () => {
    const window = { opensOn: "2026-12-08", closesOn: "2026-12-11" }
    expect(windowPosition(window, "2026-12-07")).toBe("before")
    expect(windowPosition(window, "2026-12-08")).toBe("open")
    expect(windowPosition(window, "2026-12-11")).toBe("open")
    expect(windowPosition(window, "2026-12-12")).toBe("after")
  })
})
