import { describe, it, expect } from "vitest"
import {
  isDateTimeField,
  parseDateValueMode,
  buildDateValueToken,
} from "../condition-row-editor"

describe("isDateTimeField", () => {
  it("matches exact canonical names case-insensitively", () => {
    expect(isDateTimeField("timestamp")).toBe(true)
    expect(isDateTimeField("Timestamp")).toBe(true)
    expect(isDateTimeField("TIMESTAMP")).toBe(true)
    expect(isDateTimeField("created_at")).toBe(true)
    expect(isDateTimeField("Created_At")).toBe(true)
    expect(isDateTimeField("updated_at")).toBe(true)
    expect(isDateTimeField("published_at")).toBe(true)
    expect(isDateTimeField("date")).toBe(true)
  })

  it("matches snake_case suffixes `_at` and `_date`", () => {
    expect(isDateTimeField("scraped_at")).toBe(true)
    expect(isDateTimeField("deleted_at")).toBe(true)
    expect(isDateTimeField("event_date")).toBe(true)
    expect(isDateTimeField("release_date")).toBe(true)
  })

  it("matches camelCase suffixes `At` and `Date`", () => {
    expect(isDateTimeField("createdAt")).toBe(true)
    expect(isDateTimeField("publishedDate")).toBe(true)
    expect(isDateTimeField("lastPostedAt")).toBe(true)
  })

  it("does not match words that merely end in the letters but not the suffix", () => {
    // "location" ends in "at" lowercase, but the suffix rule is
    // case-sensitive for "At"/"Date" and requires "_at"/"_date" for snake.
    expect(isDateTimeField("location")).toBe(false)
    expect(isDateTimeField("concat")).toBe(false)
    expect(isDateTimeField("update")).toBe(false)
    expect(isDateTimeField("mandate")).toBe(false)
  })

  it("returns false for unrelated fields", () => {
    expect(isDateTimeField("title")).toBe(false)
    expect(isDateTimeField("url")).toBe(false)
    expect(isDateTimeField("likesCount")).toBe(false)
    expect(isDateTimeField("")).toBe(false)
  })
})

describe("parseDateValueMode", () => {
  it("parses {{trigger.last_triggered_at}} as since-last-run", () => {
    expect(parseDateValueMode("{{trigger.last_triggered_at}}")).toEqual({
      mode: "since-last-run",
      n: 0,
    })
  })

  it("parses {{last_N_hours:3}} with the right N", () => {
    expect(parseDateValueMode("{{last_N_hours:3}}")).toEqual({
      mode: "last-hours",
      n: 3,
    })
  })

  it("parses {{last_N_days:7}}", () => {
    expect(parseDateValueMode("{{last_N_days:7}}")).toEqual({
      mode: "last-days",
      n: 7,
    })
  })

  it("parses {{last_N_weeks:2}}", () => {
    expect(parseDateValueMode("{{last_N_weeks:2}}")).toEqual({
      mode: "last-weeks",
      n: 2,
    })
  })

  it("tolerates internal whitespace in braces", () => {
    expect(parseDateValueMode("{{  last_N_hours:12  }}")).toEqual({
      mode: "last-hours",
      n: 12,
    })
  })

  it("falls back to custom for anything else (raw text, {{now}}, unknown token)", () => {
    expect(parseDateValueMode("")).toEqual({ mode: "custom", n: 0 })
    expect(parseDateValueMode("2024-01-01")).toEqual({ mode: "custom", n: 0 })
    expect(parseDateValueMode("{{now}}")).toEqual({ mode: "custom", n: 0 })
    expect(parseDateValueMode("{{last_N_fortnights:3}}")).toEqual({ mode: "custom", n: 0 })
  })
})

describe("buildDateValueToken", () => {
  it("emits {{trigger.last_triggered_at}} for since-last-run (ignores n)", () => {
    expect(buildDateValueToken("since-last-run", 0)).toBe("{{trigger.last_triggered_at}}")
    expect(buildDateValueToken("since-last-run", 99)).toBe("{{trigger.last_triggered_at}}")
  })

  it("emits the expected compact tokens for each window mode", () => {
    expect(buildDateValueToken("last-hours", 3)).toBe("{{last_N_hours:3}}")
    expect(buildDateValueToken("last-days", 7)).toBe("{{last_N_days:7}}")
    expect(buildDateValueToken("last-weeks", 2)).toBe("{{last_N_weeks:2}}")
  })

  it("emits empty string for custom (caller-managed free text)", () => {
    expect(buildDateValueToken("custom", 0)).toBe("")
  })

  it("round-trips with parseDateValueMode", () => {
    const cases: Array<[Parameters<typeof buildDateValueToken>[0], number]> = [
      ["since-last-run", 0],
      ["last-hours", 1],
      ["last-hours", 24],
      ["last-days", 1],
      ["last-days", 30],
      ["last-weeks", 1],
      ["last-weeks", 52],
    ]
    for (const [mode, n] of cases) {
      const token = buildDateValueToken(mode, n)
      const parsed = parseDateValueMode(token)
      expect(parsed.mode).toBe(mode)
      if (mode !== "since-last-run") expect(parsed.n).toBe(n)
    }
  })
})
