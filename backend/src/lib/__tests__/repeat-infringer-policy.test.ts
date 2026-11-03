// @test-watches supabase/migrations/*.sql
/**
 * The repeat-infringer policy (lib/repeat-infringer-policy.ts): the measures
 * the record takes (the latest migration's list), the default ladder, what a
 * saved policy may be, the step a count reaches, whether a measure is the
 * step's, and the window counted back from a moment.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  DEFAULT_REPEAT_INFRINGER_POLICY,
  MEASURE_KINDS,
  measureFollowsStep,
  measureNeedsDays,
  measureTakesDays,
  parseRepeatInfringerPolicy,
  repeatInfringerPolicySchema,
  stepFor,
  windowStart,
  type RepeatInfringerPolicy,
} from "../repeat-infringer-policy.js"

const MIGRATIONS = join(import.meta.dirname, "../../../../supabase/migrations")

describe("the measures", () => {
  it("are the ones the record takes, as the latest migration that names them says", () => {
    const check = /CONSTRAINT account_sanctions_kind CHECK \(kind IN \(([^)]*)\)\)/
    const latest = readdirSync(MIGRATIONS)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
      .map((f) => check.exec(readFileSync(join(MIGRATIONS, f), "utf8")))
      .filter((m): m is RegExpExecArray => m !== null)
      .at(-1)
    const kinds = [...latest![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort()
    expect(kinds).toContain("suspended")
    expect([...MEASURE_KINDS].sort()).toEqual(kinds)
  })

  it("an import block may last days, a suspension must, nothing else does", () => {
    expect(MEASURE_KINDS.filter(measureTakesDays)).toEqual(["imports_blocked", "suspended"])
    expect(MEASURE_KINDS.filter(measureNeedsDays)).toEqual(["suspended"])
  })
})

const valid: RepeatInfringerPolicy = {
  windowMonths: 12,
  steps: [
    { infringements: 1, kind: "warning" },
    { infringements: 3, kind: "imports_blocked", days: 14 },
    { infringements: 4, kind: "imports_blocked" },
    { infringements: 6, kind: "closed" },
  ],
}

describe("the default policy", () => {
  it("is a warning, then imports blocked for 30 days, then the account closed, counted over 24 months", () => {
    expect(DEFAULT_REPEAT_INFRINGER_POLICY).toEqual({
      windowMonths: 24,
      steps: [
        { infringements: 1, kind: "warning" },
        { infringements: 2, kind: "imports_blocked", days: 30 },
        { infringements: 3, kind: "closed" },
      ],
    })
    expect(repeatInfringerPolicySchema.safeParse(DEFAULT_REPEAT_INFRINGER_POLICY).success).toBe(true)
  })

  it("cannot be changed in place by a reader", () => {
    expect(Object.isFrozen(DEFAULT_REPEAT_INFRINGER_POLICY)).toBe(true)
    expect(Object.isFrozen(DEFAULT_REPEAT_INFRINGER_POLICY.steps)).toBe(true)
    expect(Object.isFrozen(DEFAULT_REPEAT_INFRINGER_POLICY.steps[0])).toBe(true)
  })
})

describe("a saved policy", () => {
  it("is read as saved when it reads as one", () => {
    expect(parseRepeatInfringerPolicy(valid)).toEqual(valid)
  })

  it("is the default when there is none, or it does not read as one", () => {
    for (const stored of [null, undefined, "x", 3, [], {}, { windowMonths: 24 }, { ...valid, extra: true }]) {
      expect(parseRepeatInfringerPolicy(stored)).toBe(DEFAULT_REPEAT_INFRINGER_POLICY)
    }
  })

  it("needs more infringements at each step than at the one before", () => {
    const same = { ...valid, steps: [{ infringements: 2, kind: "warning" }, { infringements: 2, kind: "closed" }] }
    const fewer = { ...valid, steps: [{ infringements: 3, kind: "warning" }, { infringements: 2, kind: "closed" }] }
    expect(repeatInfringerPolicySchema.safeParse(same).success).toBe(false)
    expect(repeatInfringerPolicySchema.safeParse(fewer).success).toBe(false)
  })

  it("ends at a closure: no step after it", () => {
    const after = { ...valid, steps: [{ infringements: 1, kind: "closed" }, { infringements: 2, kind: "warning" }] }
    const result = repeatInfringerPolicySchema.safeParse(after)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain("Closing the account is the last step")
  })

  it("gives a number of days to an import block or a suspension only, from 1 to 3650", () => {
    const warningDays = { ...valid, steps: [{ infringements: 1, kind: "warning", days: 3 }] }
    expect(JSON.stringify(repeatInfringerPolicySchema.safeParse(warningDays).error?.issues)).toContain("Only an import block or a suspension has a number of days")
    expect(repeatInfringerPolicySchema.safeParse({ ...valid, steps: [{ infringements: 1, kind: "closed", days: 3 }] }).success).toBe(false)
    expect(repeatInfringerPolicySchema.safeParse({ ...valid, steps: [{ infringements: 1, kind: "imports_blocked", days: 0 }] }).success).toBe(false)
    expect(repeatInfringerPolicySchema.safeParse({ ...valid, steps: [{ infringements: 1, kind: "imports_blocked", days: 3651 }] }).success).toBe(false)
    expect(repeatInfringerPolicySchema.safeParse({ ...valid, steps: [{ infringements: 1, kind: "imports_blocked", days: 3650 }] }).success).toBe(true)
    expect(repeatInfringerPolicySchema.safeParse({ ...valid, steps: [{ infringements: 1, kind: "suspended", days: 3650 }] }).success).toBe(true)
    expect(repeatInfringerPolicySchema.safeParse({ ...valid, steps: [{ infringements: 1, kind: "suspended", days: 3651 }] }).success).toBe(false)
  })

  it("a suspension is a step an administrator may add, and it always says its days", () => {
    const suspending = { ...valid, steps: [{ infringements: 1, kind: "warning" }, { infringements: 2, kind: "suspended", days: 7 }, { infringements: 3, kind: "closed" }] }
    expect(parseRepeatInfringerPolicy(suspending)).toEqual(suspending)
    const noDays = repeatInfringerPolicySchema.safeParse({ ...valid, steps: [{ infringements: 1, kind: "suspended" }] })
    expect(noDays.success).toBe(false)
    expect(JSON.stringify(noDays.error?.issues)).toContain("A suspension lasts a number of days")
  })

  it("counts over 1 to 120 whole months, and has 1 to 10 steps of known kinds", () => {
    expect(repeatInfringerPolicySchema.safeParse({ ...valid, windowMonths: 0 }).success).toBe(false)
    expect(repeatInfringerPolicySchema.safeParse({ ...valid, windowMonths: 121 }).success).toBe(false)
    expect(repeatInfringerPolicySchema.safeParse({ ...valid, windowMonths: 1.5 }).success).toBe(false)
    expect(repeatInfringerPolicySchema.safeParse({ ...valid, steps: [] }).success).toBe(false)
    const eleven = Array.from({ length: 11 }, (_, i) => ({ infringements: i + 1, kind: "warning" }))
    expect(repeatInfringerPolicySchema.safeParse({ ...valid, steps: eleven }).success).toBe(false)
    expect(repeatInfringerPolicySchema.safeParse({ ...valid, steps: [{ infringements: 1, kind: "fined" }] }).success).toBe(false)
  })
})

describe("stepFor", () => {
  it("is the highest step the count reached, or none below the first", () => {
    expect(stepFor(valid, 0)).toBeNull()
    expect(stepFor(valid, 1)).toEqual({ infringements: 1, kind: "warning" })
    expect(stepFor(valid, 2)).toEqual({ infringements: 1, kind: "warning" })
    expect(stepFor(valid, 3)).toEqual({ infringements: 3, kind: "imports_blocked", days: 14 })
    expect(stepFor(valid, 5)).toEqual({ infringements: 4, kind: "imports_blocked" })
    expect(stepFor(valid, 6)).toEqual({ infringements: 6, kind: "closed" })
    expect(stepFor(valid, 60)).toEqual({ infringements: 6, kind: "closed" })
  })
})

describe("measureFollowsStep", () => {
  it("is the same kind, and for an import block the same length (none: until lifted)", () => {
    expect(measureFollowsStep({ infringements: 1, kind: "warning" }, "warning", null)).toBe(true)
    expect(measureFollowsStep({ infringements: 1, kind: "warning" }, "closed", null)).toBe(false)
    expect(measureFollowsStep({ infringements: 3, kind: "imports_blocked", days: 14 }, "imports_blocked", 14)).toBe(true)
    expect(measureFollowsStep({ infringements: 3, kind: "imports_blocked", days: 14 }, "imports_blocked", 30)).toBe(false)
    expect(measureFollowsStep({ infringements: 3, kind: "imports_blocked", days: 14 }, "imports_blocked", null)).toBe(false)
    expect(measureFollowsStep({ infringements: 4, kind: "imports_blocked" }, "imports_blocked", null)).toBe(true)
    expect(measureFollowsStep({ infringements: 4, kind: "imports_blocked" }, "imports_blocked", 14)).toBe(false)
    expect(measureFollowsStep({ infringements: 6, kind: "closed" }, "closed", null)).toBe(true)
  })

  it("a suspension is the step's only at the step's length", () => {
    expect(measureFollowsStep({ infringements: 3, kind: "suspended", days: 7 }, "suspended", 7)).toBe(true)
    expect(measureFollowsStep({ infringements: 3, kind: "suspended", days: 7 }, "suspended", 14)).toBe(false)
    expect(measureFollowsStep({ infringements: 3, kind: "suspended", days: 7 }, "imports_blocked", 7)).toBe(false)
  })
})

describe("windowStart", () => {
  it("is the same day and time the window's months before", () => {
    expect(windowStart({ windowMonths: 24 }, new Date("2026-11-03T10:20:30.400Z")).toISOString()).toBe("2024-11-03T10:20:30.400Z")
    expect(windowStart({ windowMonths: 1 }, new Date("2026-01-15T00:00:00.000Z")).toISOString()).toBe("2025-12-15T00:00:00.000Z")
    expect(windowStart({ windowMonths: 13 }, new Date("2026-02-01T23:59:59.999Z")).toISOString()).toBe("2025-01-01T23:59:59.999Z")
  })

  it("takes the earlier month's last day for a day it does not have, so the window is never short", () => {
    expect(windowStart({ windowMonths: 1 }, new Date("2026-03-31T12:00:00.000Z")).toISOString()).toBe("2026-02-28T12:00:00.000Z")
    expect(windowStart({ windowMonths: 1 }, new Date("2024-03-31T12:00:00.000Z")).toISOString()).toBe("2024-02-29T12:00:00.000Z")
    expect(windowStart({ windowMonths: 3 }, new Date("2026-05-31T00:00:00.000Z")).toISOString()).toBe("2026-02-28T00:00:00.000Z")
    expect(windowStart({ windowMonths: 1 }, new Date("2026-05-30T00:00:00.000Z")).toISOString()).toBe("2026-04-30T00:00:00.000Z")
  })

  it("leaves the moment it was given as it was", () => {
    const now = new Date("2026-11-03T10:00:00.000Z")
    windowStart({ windowMonths: 24 }, now)
    expect(now.toISOString()).toBe("2026-11-03T10:00:00.000Z")
  })
})
