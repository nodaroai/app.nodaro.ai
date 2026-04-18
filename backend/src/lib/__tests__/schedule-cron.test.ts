import { describe, it, expect } from "vitest"
import { matchesCronField, matchesCronMinute, parseIntervalToMs } from "../schedule-cron.js"

// ---------------------------------------------------------------------------
// matchesCronField — atomic field-level cron matcher
// ---------------------------------------------------------------------------

describe("matchesCronField", () => {
  describe("wildcard", () => {
    it("matches any value", () => {
      expect(matchesCronField("*", 0, 0, 59)).toBe(true)
      expect(matchesCronField("*", 30, 0, 59)).toBe(true)
      expect(matchesCronField("*", 59, 0, 59)).toBe(true)
    })
  })

  describe("simple number", () => {
    it("matches exact value", () => {
      expect(matchesCronField("15", 15, 0, 59)).toBe(true)
      expect(matchesCronField("15", 14, 0, 59)).toBe(false)
      expect(matchesCronField("0", 0, 0, 59)).toBe(true)
    })

    it("returns false for unparseable values", () => {
      expect(matchesCronField("abc", 5, 0, 59)).toBe(false)
      expect(matchesCronField("", 5, 0, 59)).toBe(false)
    })
  })

  describe("ranges", () => {
    it("matches values inside range (inclusive)", () => {
      expect(matchesCronField("1-5", 1, 0, 59)).toBe(true)
      expect(matchesCronField("1-5", 3, 0, 59)).toBe(true)
      expect(matchesCronField("1-5", 5, 0, 59)).toBe(true)
    })

    it("rejects values outside range", () => {
      expect(matchesCronField("1-5", 0, 0, 59)).toBe(false)
      expect(matchesCronField("1-5", 6, 0, 59)).toBe(false)
    })

    it("returns false for malformed range", () => {
      expect(matchesCronField("1-", 3, 0, 59)).toBe(false)
      expect(matchesCronField("-5", 3, 0, 59)).toBe(false)
      expect(matchesCronField("a-b", 3, 0, 59)).toBe(false)
    })
  })

  describe("comma-separated values", () => {
    it("matches any of the comma-separated values", () => {
      expect(matchesCronField("0,15,30,45", 0, 0, 59)).toBe(true)
      expect(matchesCronField("0,15,30,45", 30, 0, 59)).toBe(true)
      expect(matchesCronField("0,15,30,45", 45, 0, 59)).toBe(true)
      expect(matchesCronField("0,15,30,45", 10, 0, 59)).toBe(false)
    })

    it("supports mixed types within commas (number + range)", () => {
      expect(matchesCronField("1,5-10,20", 1, 0, 59)).toBe(true)
      expect(matchesCronField("1,5-10,20", 7, 0, 59)).toBe(true)
      expect(matchesCronField("1,5-10,20", 20, 0, 59)).toBe(true)
      expect(matchesCronField("1,5-10,20", 11, 0, 59)).toBe(false)
    })
  })

  describe("step values: */N (the common case)", () => {
    it("matches every Nth from 0", () => {
      expect(matchesCronField("*/5", 0, 0, 59)).toBe(true)
      expect(matchesCronField("*/5", 5, 0, 59)).toBe(true)
      expect(matchesCronField("*/5", 10, 0, 59)).toBe(true)
      expect(matchesCronField("*/5", 4, 0, 59)).toBe(false)
      expect(matchesCronField("*/5", 7, 0, 59)).toBe(false)
    })
  })

  describe("step values: start-end/step (regression: was always false)", () => {
    // Before the fix, the range branch ran before the step branch. Field
    // "1-10/2" entered the range branch, split on "-" into ["1", "10/2"],
    // and Number("10/2") was NaN — so the field NEVER matched, and any
    // schedule using start-end/step syntax silently never fired.

    it("matches values inside range at step intervals", () => {
      expect(matchesCronField("1-10/2", 1, 0, 59)).toBe(true)
      expect(matchesCronField("1-10/2", 3, 0, 59)).toBe(true)
      expect(matchesCronField("1-10/2", 5, 0, 59)).toBe(true)
      expect(matchesCronField("1-10/2", 9, 0, 59)).toBe(true)
    })

    it("rejects values outside range or off-step", () => {
      expect(matchesCronField("1-10/2", 0, 0, 59)).toBe(false)  // below range
      expect(matchesCronField("1-10/2", 11, 0, 59)).toBe(false) // above range
      expect(matchesCronField("1-10/2", 2, 0, 59)).toBe(false)  // off-step (1, 3, 5...)
      expect(matchesCronField("1-10/2", 4, 0, 59)).toBe(false)  // off-step
    })

    it("works for the common business-hours pattern 9-17/2", () => {
      expect(matchesCronField("9-17/2", 9, 0, 23)).toBe(true)
      expect(matchesCronField("9-17/2", 11, 0, 23)).toBe(true)
      expect(matchesCronField("9-17/2", 13, 0, 23)).toBe(true)
      expect(matchesCronField("9-17/2", 15, 0, 23)).toBe(true)
      expect(matchesCronField("9-17/2", 17, 0, 23)).toBe(true)
      expect(matchesCronField("9-17/2", 10, 0, 23)).toBe(false) // off-step
      expect(matchesCronField("9-17/2", 19, 0, 23)).toBe(false) // outside
    })

    it("works for first-half-hour pattern 0-30/5", () => {
      expect(matchesCronField("0-30/5", 0, 0, 59)).toBe(true)
      expect(matchesCronField("0-30/5", 5, 0, 59)).toBe(true)
      expect(matchesCronField("0-30/5", 30, 0, 59)).toBe(true)
      expect(matchesCronField("0-30/5", 35, 0, 59)).toBe(false)  // outside upper
    })
  })

  describe("step values: start/step (open-ended from start)", () => {
    // "5/15" means start at 5, every 15: 5, 20, 35, 50. Previously this fell
    // through to `return false`. Now treated as start-max/step.
    it("matches start and every step thereafter up to max", () => {
      expect(matchesCronField("5/15", 5, 0, 59)).toBe(true)
      expect(matchesCronField("5/15", 20, 0, 59)).toBe(true)
      expect(matchesCronField("5/15", 35, 0, 59)).toBe(true)
      expect(matchesCronField("5/15", 50, 0, 59)).toBe(true)
    })

    it("rejects values below start or off-step", () => {
      expect(matchesCronField("5/15", 0, 0, 59)).toBe(false)
      expect(matchesCronField("5/15", 10, 0, 59)).toBe(false)
      expect(matchesCronField("5/15", 25, 0, 59)).toBe(false)
    })
  })

  describe("invalid step values", () => {
    it("returns false for zero or negative step", () => {
      expect(matchesCronField("*/0", 0, 0, 59)).toBe(false)
      expect(matchesCronField("1-10/0", 1, 0, 59)).toBe(false)
    })

    it("returns false for non-numeric step", () => {
      expect(matchesCronField("*/abc", 5, 0, 59)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// matchesCronMinute — full 5-field cron expression evaluator
// ---------------------------------------------------------------------------

describe("matchesCronMinute", () => {
  it("matches '* * * * *' for any UTC time", () => {
    expect(matchesCronMinute("* * * * *", new Date("2026-04-18T15:30:00Z"))).toBe(true)
  })

  it("matches '0-30/5 * * * *' on the user's reported broken pattern", () => {
    // Regression: this whole expression silently never fired before.
    expect(matchesCronMinute("0-30/5 * * * *", new Date("2026-04-18T15:00:00Z"))).toBe(true)
    expect(matchesCronMinute("0-30/5 * * * *", new Date("2026-04-18T15:05:00Z"))).toBe(true)
    expect(matchesCronMinute("0-30/5 * * * *", new Date("2026-04-18T15:30:00Z"))).toBe(true)
    expect(matchesCronMinute("0-30/5 * * * *", new Date("2026-04-18T15:35:00Z"))).toBe(false)
    expect(matchesCronMinute("0-30/5 * * * *", new Date("2026-04-18T15:03:00Z"))).toBe(false)
  })

  it("rejects expressions with wrong number of fields", () => {
    expect(matchesCronMinute("* * * *", new Date("2026-04-18T15:00:00Z"))).toBe(false)
    expect(matchesCronMinute("* * * * * *", new Date("2026-04-18T15:00:00Z"))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseIntervalToMs — simple "5m" / "1h" / "1d" parser
// ---------------------------------------------------------------------------

describe("parseIntervalToMs", () => {
  it("parses seconds, minutes, hours, days", () => {
    expect(parseIntervalToMs("30s")).toBe(30 * 1000)
    expect(parseIntervalToMs("5m")).toBe(5 * 60 * 1000)
    expect(parseIntervalToMs("2h")).toBe(2 * 60 * 60 * 1000)
    expect(parseIntervalToMs("1d")).toBe(24 * 60 * 60 * 1000)
  })

  it("returns 0 for malformed strings", () => {
    expect(parseIntervalToMs("")).toBe(0)
    expect(parseIntervalToMs("5")).toBe(0)
    expect(parseIntervalToMs("5min")).toBe(0)
    expect(parseIntervalToMs("abc")).toBe(0)
    expect(parseIntervalToMs("-5m")).toBe(0)
  })
})
