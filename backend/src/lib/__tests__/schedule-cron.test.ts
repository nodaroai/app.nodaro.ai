import { describe, it, expect } from "vitest"
import { vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import {
  matchesCronField,
  matchesCronMinute,
  msUntilNextTick,
  parseIntervalToMs,
  scheduleDue,
  startScheduleCron,
  stopScheduleCron,
} from "../schedule-cron.js"
import { supabase } from "../supabase.js"

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

// ---------------------------------------------------------------------------
// scheduleDue — is this row due at this instant? (pure: config, previous fire, clock)
// ---------------------------------------------------------------------------

const at = (iso: string) => new Date(iso)

describe("scheduleDue — the rules lane (what the graph projection writes)", () => {
  const every20 = { rules: [{ id: "a", kind: "minutes", every: 20 }] }

  it("fires when a rule matches this minute, not otherwise", () => {
    expect(scheduleDue(every20, null, at("2026-09-22T10:20:00Z"))).toBe(true)
    expect(scheduleDue(every20, null, at("2026-09-22T10:21:00Z"))).toBe(false)
  })

  it("reads the clock in the config's timezone", () => {
    const nine = { rules: [{ id: "a", kind: "days", every: 1, hour: 9, minute: 0 }], timezone: "Asia/Jerusalem" }
    expect(scheduleDue(nine, null, at("2026-07-01T06:00:00Z"))).toBe(true) // 09:00 in Jerusalem (summer)
    expect(scheduleDue(nine, null, at("2026-07-01T09:00:00Z"))).toBe(false)
  })

  it("never fires twice in one wall-clock minute — a restart's immediate check, or a replica a moment behind", () => {
    expect(scheduleDue(every20, "2026-09-22T10:20:05.000Z", at("2026-09-22T10:20:40Z"))).toBe(false)
    expect(scheduleDue(every20, "2026-09-22T10:00:05.000Z", at("2026-09-22T10:20:40Z"))).toBe(true)
  })

  it("the second pass of a wall-clock minute the clocks fell back onto does not fire", () => {
    // New York, 2026-11-01: 01:30 EDT is 05:30Z and 01:30 EST, an hour later, is 06:30Z.
    const halfPastOne = { rules: [{ id: "a", kind: "days", every: 1, hour: 1, minute: 30 }], timezone: "America/New_York" }
    expect(scheduleDue(halfPastOne, null, at("2026-11-01T05:30:00Z"))).toBe(true)
    expect(scheduleDue(halfPastOne, "2026-11-01T05:30:00.000Z", at("2026-11-01T06:30:00Z"))).toBe(false)
  })

  it("rules present means rules — a stale legacy key beside them is ignored, and no usable rule never fires", () => {
    expect(scheduleDue({ rules: [{ id: "a", kind: "minutes", every: 20 }], interval: "1m" }, null, at("2026-09-22T10:21:00Z"))).toBe(false)
    expect(scheduleDue({ rules: [], interval: "1m" }, null, at("2026-09-22T10:21:00Z"))).toBe(false)
    expect(scheduleDue({ rules: [{ kind: "seconds", every: 30 }] }, null, at("2026-09-22T10:21:00Z"))).toBe(false)
  })
})

describe("scheduleDue — the legacy lanes (rows made by hand, rows not re-projected since the model changed)", () => {
  it("interval: due once that much time has passed since the previous fire — at once when there was none", () => {
    expect(scheduleDue({ interval: "5m" }, null, at("2026-09-22T10:21:00Z"))).toBe(true)
    expect(scheduleDue({ interval: "5m" }, "2026-09-22T10:17:00.000Z", at("2026-09-22T10:21:00Z"))).toBe(false)
    expect(scheduleDue({ interval: "5m" }, "2026-09-22T10:16:00.000Z", at("2026-09-22T10:21:00Z"))).toBe(true)
  })

  it("cron: matches the minute, and never twice in it", () => {
    expect(scheduleDue({ cron: "*/15 * * * *" }, null, at("2026-09-22T10:15:00Z"))).toBe(true)
    expect(scheduleDue({ cron: "*/15 * * * *" }, "2026-09-22T10:15:02.000Z", at("2026-09-22T10:15:50Z"))).toBe(false)
    expect(scheduleDue({ cron: "*/15 * * * *" }, null, at("2026-09-22T10:16:00Z"))).toBe(false)
  })

  it("interval beats cron on a hand-made row carrying both; nothing configured never fires", () => {
    expect(scheduleDue({ interval: "5m", cron: "0 0 1 1 *" }, null, at("2026-09-22T10:21:00Z"))).toBe(true)
    expect(scheduleDue({}, null, at("2026-09-22T10:21:00Z"))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// startScheduleCron — one check per calendar minute, just after the boundary
// ---------------------------------------------------------------------------

/**
 * The default decides on Railway's environment name, read at call time — and
 * the CI runners are hosted on Railway too, so every test that starts the
 * cron pins it instead of inheriting whatever the runner carries.
 */
function pinRailwayEnvironment(): void {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env.RAILWAY_ENVIRONMENT_NAME
    delete process.env.RAILWAY_ENVIRONMENT_NAME
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME
    else process.env.RAILWAY_ENVIRONMENT_NAME = saved
  })
}

describe("startScheduleCron — one check per calendar minute, just after the boundary", () => {
  const checks = () => vi.mocked(supabase.from).mock.calls.filter(([table]) => table === "workflow_triggers").length

  pinRailwayEnvironment()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(supabase.from).mockReset()
    vi.mocked(supabase.from).mockImplementation((() => ({
      select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }),
    })) as never)
  })

  afterEach(() => {
    stopScheduleCron()
    vi.useRealTimers()
  })

  it("msUntilNextTick lands just past the next minute boundary", () => {
    expect(msUntilNextTick(Date.parse("2026-09-22T10:00:20Z"))).toBe(40_250)
    expect(msUntilNextTick(Date.parse("2026-09-22T10:00:00Z"))).toBe(60_250)
    expect(msUntilNextTick(Date.parse("2026-09-22T10:00:59.900Z"))).toBe(350)
  })

  it("checks at once, then at every next boundary — every rule is a per-minute question, so no minute may be skipped", async () => {
    vi.setSystemTime(new Date("2026-09-22T10:00:20.000Z"))
    startScheduleCron()
    await vi.advanceTimersByTimeAsync(0)
    expect(checks()).toBe(1)
    await vi.advanceTimersByTimeAsync(40_249) // 10:01:00.249 — not yet
    expect(checks()).toBe(1)
    await vi.advanceTimersByTimeAsync(1) // 10:01:00.250
    expect(checks()).toBe(2)
    await vi.advanceTimersByTimeAsync(60_000) // 10:02:00.250
    expect(checks()).toBe(3)
  })

  it("stops", async () => {
    vi.setSystemTime(new Date("2026-09-22T10:00:20.000Z"))
    startScheduleCron()
    await vi.advanceTimersByTimeAsync(0)
    stopScheduleCron()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(checks()).toBe(1)
  })

  it("a check that overruns the boundary neither shifts the chain nor loses the minute it covered — the next tick catches it up", async () => {
    // The second check (the 10:01 boundary) takes 70 s. With every rule a
    // per-minute question, minute 10:02 must still be evaluated: the 10:02
    // tick is skipped (a check is in flight), and the 10:03 tick evaluates
    // 10:02 AND 10:03.
    let call = 0
    vi.mocked(supabase.from).mockImplementation((() => ({
      select: () => ({
        eq: () => ({
          eq: () => {
            call += 1
            const delay = call === 2 ? 70_000 : 0
            return new Promise((resolve) => setTimeout(() => resolve({ data: [], error: null }), delay))
          },
        }),
      }),
    })) as never)
    vi.setSystemTime(new Date("2026-09-22T10:00:20.000Z"))
    startScheduleCron()
    await vi.advanceTimersByTimeAsync(0)
    expect(checks()).toBe(1) // 10:00:20
    await vi.advanceTimersByTimeAsync(40_250) // 10:01:00.250 — the slow check starts
    expect(checks()).toBe(2)
    await vi.advanceTimersByTimeAsync(60_000) // 10:02:00.250 — in flight, skipped
    expect(checks()).toBe(2)
    await vi.advanceTimersByTimeAsync(61_000) // 10:03:00.250 (+1 s for the two quick checks) — catches up 10:02, then 10:03
    expect(checks()).toBe(4)
  })
})

describe("startScheduleCron — only the environment that owns the schedules fires them", () => {
  const reads = () => vi.mocked(supabase.from).mock.calls.length

  pinRailwayEnvironment()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-22T10:00:20.000Z"))
    vi.mocked(supabase.from).mockReset()
    vi.mocked(supabase.from).mockImplementation((() => ({
      select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }),
    })) as never)
  })

  afterEach(() => {
    stopScheduleCron()
    vi.useRealTimers()
  })

  it("a Railway environment other than production (staging shares production's database) reads nothing and fires nothing", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging"
    startScheduleCron()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(reads()).toBe(0)
  })

  it("Railway's production environment fires with no new variable set", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "production"
    startScheduleCron()
    await vi.advanceTimersByTimeAsync(0)
    expect(reads()).toBe(1)
  })

  it("an install off Railway (self-host, community) fires by default", async () => {
    startScheduleCron()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads()).toBe(2)
  })
})
