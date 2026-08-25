import { describe, expect, it } from "vitest"
import { buildDayList, dayWindow, groupTurnFailures, isValidCalendarDay } from "../admin-copilot-gaps.js"

describe("isValidCalendarDay", () => {
  it("accepts real dates, leap day included", () => {
    expect(isValidCalendarDay("2026-08-26")).toBe(true)
    expect(isValidCalendarDay("2024-02-29")).toBe(true)
  })

  it("rejects month 13 (NaN parse → would 500 as toISOString throws)", () => {
    expect(isValidCalendarDay("2026-13-01")).toBe(false)
    expect(isValidCalendarDay("2026-00-10")).toBe(false)
  })

  it("rejects rollover dates V8 silently accepts (Feb 31 → Mar 3)", () => {
    expect(isValidCalendarDay("2026-02-31")).toBe(false)
    expect(isValidCalendarDay("2023-02-29")).toBe(false)
    expect(isValidCalendarDay("2026-04-31")).toBe(false)
  })
})

describe("dayWindow", () => {
  it("spans exactly [00:00Z, next 00:00Z)", () => {
    expect(dayWindow("2026-08-26")).toEqual({
      startIso: "2026-08-26T00:00:00.000Z",
      endIso: "2026-08-27T00:00:00.000Z",
    })
  })
})

describe("buildDayList", () => {
  it("runs oldest → newest and ends on now's UTC day", () => {
    expect(buildDayList(3, new Date("2026-08-26T13:45:00Z"))).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
    ])
  })

  it("a single day is just today", () => {
    expect(buildDayList(1, new Date("2026-08-26T00:00:00Z"))).toEqual(["2026-08-26"])
  })

  it("crosses month boundaries", () => {
    expect(buildDayList(3, new Date("2026-09-01T02:00:00Z"))).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ])
  })

  it("uses the UTC day, not the local one, near midnight", () => {
    // 23:59Z is still the 26th in UTC regardless of server timezone.
    const list = buildDayList(2, new Date("2026-08-26T23:59:59Z"))
    expect(list).toEqual(["2026-08-25", "2026-08-26"])
  })
})

describe("groupTurnFailures", () => {
  it("keeps multi-word titles verbatim", () => {
    const out = groupTurnFailures([
      { title: "Copilot turn failed: model overloaded", created_at: "2026-08-26T10:00:00Z" },
    ])
    expect(out).toEqual([
      { title: "Copilot turn failed: model overloaded", day: "2026-08-26", count: 1 },
    ])
  })

  it("aggregates same title within a day but splits across days", () => {
    const rows = [
      { title: "budget exceeded", created_at: "2026-08-25T09:00:00Z" },
      { title: "budget exceeded", created_at: "2026-08-25T11:00:00Z" },
      { title: "budget exceeded", created_at: "2026-08-26T08:00:00Z" },
    ]
    expect(groupTurnFailures(rows)).toEqual([
      { title: "budget exceeded", day: "2026-08-25", count: 2 },
      { title: "budget exceeded", day: "2026-08-26", count: 1 },
    ])
  })

  it("labels a null title (untitled)", () => {
    const out = groupTurnFailures([{ title: null, created_at: "2026-08-26T10:00:00Z" }])
    expect(out).toEqual([{ title: "(untitled)", day: "2026-08-26", count: 1 }])
  })

  it("two titles sharing a first word stay separate buckets", () => {
    const rows = [
      { title: "stream aborted by client", created_at: "2026-08-26T10:00:00Z" },
      { title: "stream error: overloaded", created_at: "2026-08-26T10:05:00Z" },
    ]
    expect(groupTurnFailures(rows)).toHaveLength(2)
  })
})
