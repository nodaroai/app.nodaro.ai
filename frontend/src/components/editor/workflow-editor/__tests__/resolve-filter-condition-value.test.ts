import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { resolveFilterConditionValue } from "../execute-node"

/**
 * Bug addressed: the frontend filter-list resolver only handled `{{now}}` and
 * fell through to "" for relative-window tokens (`{{last_N_hours:N}}`,
 * `{{last_N_days:N}}`, `{{last_N_weeks:N}}`). The DateTimeValuePicker emits
 * those tokens, so a manual Run silently produced field > "" while a triggered
 * Run filtered correctly. Mirrors backend `resolveConditionValue` /
 * `resolveRelativeWindowToken` in inline-executor.ts.
 */
describe("resolveFilterConditionValue — relative-window tokens", () => {
  const NOW_ISO = "2026-04-18T22:00:00.000Z"
  const NOW_MS = new Date(NOW_ISO).getTime()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_MS))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves {{last_N_hours:3}} to NOW - 3h ISO", () => {
    const expected = new Date(NOW_MS - 3 * 60 * 60 * 1000).toISOString()
    expect(resolveFilterConditionValue("{{last_N_hours:3}}", "variable")).toBe(expected)
  })

  it("resolves {{last_N_days:1}} to NOW - 24h ISO", () => {
    const expected = new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString()
    expect(resolveFilterConditionValue("{{last_N_days:1}}", "variable")).toBe(expected)
  })

  it("resolves {{last_N_weeks:2}} to NOW - 14d ISO", () => {
    const expected = new Date(NOW_MS - 14 * 24 * 60 * 60 * 1000).toISOString()
    expect(resolveFilterConditionValue("{{last_N_weeks:2}}", "variable")).toBe(expected)
  })

  it("resolves {{now}} to current ISO (still works)", () => {
    expect(resolveFilterConditionValue("{{now}}", "variable")).toBe(NOW_ISO)
  })

  it("trigger.* tokens still resolve to empty (intentional — backend resolves)", () => {
    expect(resolveFilterConditionValue("{{trigger.last_triggered_at}}", "variable")).toBe("")
  })

  it("malformed last_N_* falls through to empty (matches backend behavior)", () => {
    expect(resolveFilterConditionValue("{{last_N_fortnights:2}}", "variable")).toBe("")
  })

  it("accepts whitespace inside braces", () => {
    const expected = new Date(NOW_MS - 3 * 60 * 60 * 1000).toISOString()
    expect(resolveFilterConditionValue("{{  last_N_hours:3  }}", "variable")).toBe(expected)
  })

  it("static raw value passes through untouched", () => {
    expect(resolveFilterConditionValue("hello", "static")).toBe("hello")
  })

  it("static value with embedded {{...}} still gets templated (matches backend hasTemplate path)", () => {
    const expected = new Date(NOW_MS - 1 * 60 * 60 * 1000).toISOString()
    expect(resolveFilterConditionValue("{{last_N_hours:1}}", "static")).toBe(expected)
  })
})
