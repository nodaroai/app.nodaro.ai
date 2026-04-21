import { describe, it, expect } from "vitest"
import {
  evaluateCondition,
  evaluateConditionGroup,
  resolveConditionValue,
  tryParseJson,
  type FilterListCondition,
} from "../filter-condition.js"

function cond(partial: Partial<FilterListCondition> & { operator: FilterListCondition["operator"] }): FilterListCondition {
  return {
    field: partial.field ?? "",
    value: partial.value ?? "",
    valueType: partial.valueType ?? "static",
    ...partial,
  }
}

describe("evaluateCondition — operator semantics (parity with filter-list)", () => {
  it("starts_with / ends_with match string prefixes / suffixes", () => {
    expect(evaluateCondition({ url: "https://foo" }, "", cond({ field: "url", operator: "starts_with", value: "https" }))).toBe(true)
    expect(evaluateCondition({ file: "a.jpg" }, "", cond({ field: "file", operator: "ends_with", value: ".jpg" }))).toBe(true)
    expect(evaluateCondition({ url: "ftp://bar" }, "", cond({ field: "url", operator: "starts_with", value: "https" }))).toBe(false)
  })

  it("regex matches", () => {
    expect(evaluateCondition({ v: "hello" }, "", cond({ field: "v", operator: "regex", value: "^h[elo]+$" }))).toBe(true)
    // invalid pattern => drop
    expect(evaluateCondition({ v: "x" }, "", cond({ field: "v", operator: "regex", value: "[unclosed" }))).toBe(false)
    // empty value => drop
    expect(evaluateCondition({ v: "x" }, "", cond({ field: "v", operator: "regex", value: "" }))).toBe(false)
  })

  it("contains stringifies numeric values", () => {
    expect(evaluateCondition({ v: 432 }, "", cond({ field: "v", operator: "contains", value: "3" }))).toBe(true)
  })

  it("numeric-first equality", () => {
    expect(evaluateCondition({ v: 432 }, "", cond({ field: "v", operator: "=", value: "432" }))).toBe(true)
    expect(evaluateCondition({ v: "432" }, "", cond({ field: "v", operator: "=", value: "432" }))).toBe(true)
  })

  it("exists / not_exists only null/undefined-sensitive", () => {
    expect(evaluateCondition({ v: "" }, "", cond({ field: "v", operator: "exists" }))).toBe(true)
    expect(evaluateCondition({ v: null }, "", cond({ field: "v", operator: "exists" }))).toBe(false)
    expect(evaluateCondition({ other: 1 }, "", cond({ field: "v", operator: "not_exists" }))).toBe(true)
  })

  it("empty field path uses the whole item", () => {
    expect(evaluateCondition("hello world", "hello world", cond({ operator: "contains", value: "world" }))).toBe(true)
  })
})

describe("evaluateConditionGroup — AND/OR", () => {
  const item = { url: "https://example.com/news", label: "news today" }
  const c1 = cond({ field: "url", operator: "starts_with", value: "https" })
  const c2 = cond({ field: "label", operator: "contains", value: "news" })
  const c3 = cond({ field: "label", operator: "contains", value: "sports" })

  it("AND requires all conditions", () => {
    expect(evaluateConditionGroup(item, "", [c1, c2], "AND")).toBe(true)
    expect(evaluateConditionGroup(item, "", [c1, c3], "AND")).toBe(false)
  })

  it("OR accepts any match", () => {
    expect(evaluateConditionGroup(item, "", [c1, c3], "OR")).toBe(true)
    expect(evaluateConditionGroup(item, "", [c3, cond({ field: "label", operator: "contains", value: "weather" })], "OR")).toBe(false)
  })

  it("empty condition list evaluates to true (tautology)", () => {
    expect(evaluateConditionGroup(item, "", [], "AND")).toBe(true)
    expect(evaluateConditionGroup(item, "", [], "OR")).toBe(true)
  })

  it("ignores conditions with a missing operator", () => {
    expect(evaluateConditionGroup(item, "", [{ operator: "" as unknown as FilterListCondition["operator"], value: "" }], "AND")).toBe(true)
  })
})

describe("resolveConditionValue — trigger + relative-window tokens", () => {
  it("resolves trigger.last_triggered_at when triggerData is passed", () => {
    const out = resolveConditionValue("{{trigger.last_triggered_at}}", "variable", { last_triggered_at: "2026-01-01T00:00:00Z" })
    expect(out).toBe("2026-01-01T00:00:00Z")
  })

  it("falls back to empty string without triggerData", () => {
    expect(resolveConditionValue("{{trigger.last_triggered_at}}", "variable")).toBe("")
  })

  it("resolves a last_N_hours token to a valid ISO timestamp in the past", () => {
    const out = resolveConditionValue("{{last_N_hours:3}}", "variable")
    const t = Date.parse(out)
    expect(Number.isFinite(t)).toBe(true)
    expect(t).toBeLessThan(Date.now())
  })

  it("passes through a plain string when not variable and has no template", () => {
    expect(resolveConditionValue("hello", "static")).toBe("hello")
  })
})

describe("tryParseJson", () => {
  it("parses JSON objects", () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 })
  })

  it("parses JSON arrays", () => {
    expect(tryParseJson("[1,2,3]")).toEqual([1, 2, 3])
  })

  it("returns non-JSON-looking strings untouched", () => {
    expect(tryParseJson("hello world")).toBe("hello world")
  })

  it("returns malformed JSON untouched", () => {
    expect(tryParseJson("{not json")).toBe("{not json")
  })

  it("non-string values are passed through", () => {
    const obj = { a: 1 }
    expect(tryParseJson(obj)).toBe(obj)
  })
})
