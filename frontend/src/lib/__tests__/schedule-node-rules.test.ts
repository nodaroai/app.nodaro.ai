// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  defaultRuleForKind,
  effectiveScheduleRules,
  effectiveScheduleTimezone,
  isLegacyScheduleNode,
  isScheduleActive,
  isScheduleRunnable,
  isScheduleTimezoneReadable,
  newScheduleRuleId,
  presetMatching,
  presetRules,
  rawScheduleRules,
  ruleWithKind,
  scheduleRulesPatch,
} from "../schedule-node-rules"

describe("two readings of the rules: as typed (the editor) and as the server will run them (the preview)", () => {
  it("a half-typed cron stays in the raw list and is dropped from the runnable one", () => {
    const data = { rules: [{ id: "a", kind: "cron", cron: "0 9 * *" }, { id: "b", kind: "days", hour: 9 }] }
    expect(rawScheduleRules(data)).toEqual([{ id: "a", kind: "cron", cron: "0 9 * *" }, { id: "b", kind: "days", hour: 9 }])
    expect(effectiveScheduleRules(data)).toEqual([{ id: "b", kind: "days", every: 1, hour: 9, minute: 0 }])
  })

  it("the raw list keeps every known kind exactly as written, fills a missing id, and drops an unknown kind", () => {
    expect(rawScheduleRules({ rules: [{ kind: "minutes", every: 0 }, { kind: "seconds", every: 30 }, null, { id: "", kind: "hours" }] })).toEqual([
      { id: "rule-1", kind: "minutes", every: 0 },
      { id: "rule-4", kind: "hours" },
    ])
  })

  it("runnable = at least one usable rule AND a timezone the server can read", () => {
    expect(isScheduleRunnable({ rules: [{ kind: "days", hour: 9 }] })).toBe(true)
    expect(isScheduleRunnable({ rules: [{ kind: "days", hour: 9 }], timezone: "Asia/Jerusalem" })).toBe(true)
    expect(isScheduleRunnable({ rules: [{ kind: "days", hour: 9 }], timezone: "Israel Time" })).toBe(false)
    expect(isScheduleRunnable({ rules: [{ kind: "cron", cron: "0 9" }] })).toBe(false)
    expect(isScheduleRunnable({})).toBe(false)
    expect(isScheduleTimezoneReadable({})).toBe(true) // UTC
    expect(isScheduleTimezoneReadable({ timezone: "GMT+2" })).toBe(false)
  })
})

describe("what a Schedule Trigger node's data means", () => {
  it("reads rules, or converts a node written before the rules model — without writing anything", () => {
    expect(effectiveScheduleRules({ rules: [{ id: "r", kind: "minutes", every: 5 }] })).toEqual([{ id: "r", kind: "minutes", every: 5 }])
    expect(effectiveScheduleRules({ interval: "*/15 * * * *" })).toEqual([{ id: "rule-1", kind: "minutes", every: 15 }])
    expect(effectiveScheduleRules({ interval: "custom", cron: "0 6 * * 1-5" })).toEqual([{ id: "rule-1", kind: "weeks", every: 1, hour: 6, minute: 0, weekdays: [1, 2, 3, 4, 5] }])
    expect(effectiveScheduleRules({})).toEqual([])
    expect(isLegacyScheduleNode({ interval: "5m" })).toBe(true)
    expect(isLegacyScheduleNode({ rules: [], interval: "5m" })).toBe(false)
    expect(isLegacyScheduleNode({})).toBe(false)
  })

  it("the timezone defaults to UTC (what the server reads) and only the boolean true arms the switch", () => {
    expect(effectiveScheduleTimezone({})).toBe("UTC")
    expect(effectiveScheduleTimezone({ timezone: " Asia/Jerusalem " })).toBe("Asia/Jerusalem")
    expect(isScheduleActive({ active: true })).toBe(true)
    expect(isScheduleActive({ active: "true" })).toBe(false)
    expect(isScheduleActive({})).toBe(false)
  })

  it("the rules patch clears the pre-rules fields so nothing downstream can read them again", () => {
    expect(scheduleRulesPatch([{ id: "r", kind: "hours", every: 2, minute: 0 }])).toEqual({
      rules: [{ id: "r", kind: "hours", every: 2, minute: 0 }],
      interval: undefined,
      cron: undefined,
      cronExpression: undefined,
    })
  })

  it("a new rule id never collides", () => {
    expect(newScheduleRuleId([])).toBe("rule-1")
    expect(newScheduleRuleId([{ id: "rule-1", kind: "minutes" }, { id: "rule-3", kind: "minutes" }])).toBe("rule-4")
  })
})

describe("switching a rule's kind", () => {
  it("carries the time of day and the weekdays, restarts `every` at the kind's default", () => {
    const daily = { id: "r", kind: "days" as const, every: 3, hour: 18, minute: 30 }
    expect(ruleWithKind(daily, "weeks")).toEqual({ id: "r", kind: "weeks", every: 1, hour: 18, minute: 30, weekdays: [1, 2, 3, 4, 5] })
    expect(ruleWithKind({ id: "r", kind: "minutes", every: 20 }, "months")).toEqual({ id: "r", kind: "months", every: 1, hour: 9, minute: 0, dayOfMonth: 1 })
    expect(ruleWithKind({ id: "r", kind: "weeks", every: 2, hour: 7, minute: 15, weekdays: [0, 6] }, "days")).toEqual({ id: "r", kind: "days", every: 1, hour: 7, minute: 15 })
    expect(ruleWithKind(daily, "days")).toBe(daily)
  })

  it("every kind has a sensible fresh rule", () => {
    expect(defaultRuleForKind("cron", "x")).toEqual({ id: "x", kind: "cron", cron: "0 9 * * *" })
    expect(defaultRuleForKind("weeks", "x").weekdays).toEqual([1, 2, 3, 4, 5])
  })
})

describe("presets", () => {
  it("a preset is one rule, and is recognised back regardless of the rule's id", () => {
    expect(presetRules("hourly")).toEqual([{ id: "rule-1", kind: "hours", every: 1, minute: 0 }])
    expect(presetMatching(presetRules("weekdays-9am"))).toBe("weekdays-9am")
    expect(presetMatching([{ id: "whatever", kind: "hours", every: 1, minute: 0 }])).toBe("hourly")
    expect(presetMatching([{ id: "a", kind: "hours", every: 2, minute: 0 }])).toBeNull()
    expect(presetMatching([...presetRules("hourly"), { id: "b", kind: "minutes", every: 5 }])).toBeNull()
  })
})
