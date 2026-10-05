import { describe, expect, it } from "vitest"
import { compareInput, dateInputValue, dayOf, earliestDay, endOfDay, periodOf, presetPeriods } from "../period-presets"

// A Monday at noon, local time, so no preset crosses a day boundary by accident.
const NOW = new Date(2026, 9, 5, 12, 0, 0)
const day = (d: Date) => dateInputValue(d)

describe("presetPeriods", () => {
  it("last 7 days against the 7 before them, whole days", () => {
    const { a, b } = presetPeriods("week", NOW)
    expect([day(a.from), day(a.to)]).toEqual(["2026-09-29", "2026-10-05"])
    expect([day(b!.from), day(b!.to)]).toEqual(["2026-09-22", "2026-09-28"])
    expect(a.from.getHours()).toBe(0)
    expect(a.to.getTime()).toBe(endOfDay(NOW).getTime())
    expect(b!.to.getTime() + 1).toBe(a.from.getTime())
  })

  it("last 30 days against the 30 before them", () => {
    const { a, b } = presetPeriods("month", NOW)
    expect([day(a.from), day(a.to)]).toEqual(["2026-09-06", "2026-10-05"])
    expect([day(b!.from), day(b!.to)]).toEqual(["2026-08-07", "2026-09-05"])
  })

  it("this month so far against the whole of last month", () => {
    const { a, b } = presetPeriods("calendarMonth", NOW)
    expect([day(a.from), day(a.to)]).toEqual(["2026-10-01", "2026-10-05"])
    expect([day(b!.from), day(b!.to)]).toEqual(["2026-09-01", "2026-09-30"])
    expect(presetPeriods("calendarMonth", new Date(2026, 0, 15)).b!.from.getFullYear()).toBe(2025)
  })

  it("one day stands alone, with nothing to compare", () => {
    const { a, b } = presetPeriods("day", NOW)
    expect([day(a.from), day(a.to)]).toEqual(["2026-10-05", "2026-10-05"])
    expect(b).toBeNull()
  })
})

describe("date inputs", () => {
  it("reads a day and refuses what is not one", () => {
    expect(day(dayOf("2026-02-28")!)).toBe("2026-02-28")
    expect(dayOf("2026-02-30")).toBeNull()
    expect(dayOf("yesterday")).toBeNull()
    expect(dayOf("")).toBeNull()
  })

  it("makes a period of whole days, and none when it ends before it starts", () => {
    const p = periodOf("2026-09-01", "2026-09-07")!
    expect([day(p.from), day(p.to)]).toEqual(["2026-09-01", "2026-09-07"])
    expect(p.to.getHours()).toBe(23)
    expect(periodOf("2026-09-07", "2026-09-01")).toBeNull()
    expect(periodOf("2026-09-01", "nope")).toBeNull()
  })

  it("the earliest day the plan keeps is whole months back", () => {
    expect(day(earliestDay(NOW, 3))).toBe("2026-07-05")
    expect(day(earliestDay(new Date(2026, 2, 31), 1))).toBe("2026-03-03")
  })
})

describe("compareInput", () => {
  it("sends both periods as ISO instants, and only the first when there is nothing to compare", () => {
    const two = compareInput(presetPeriods("week", NOW))
    expect(two.from).toBe(presetPeriods("week", NOW).a.from.toISOString())
    expect(two.vsTo).toBe(presetPeriods("week", NOW).b!.to.toISOString())
    const one = compareInput(presetPeriods("day", NOW))
    expect(one.vsFrom).toBeUndefined()
    expect(one.vsTo).toBeUndefined()
  })
})
