import { describe, it, expect } from "vitest"
import {
  evaluateCondition,
  evaluateConditionGroup,
  resolveConditionValue,
  tryParseJson,
  type FilterListCondition,
  type FilterListOperator,
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

describe("evaluateCondition — case sensitivity option", () => {
  const mkCond = (operator: FilterListOperator, value: string, field = ""): FilterListCondition =>
    ({ operator, value, field })

  // Default behavior: case-sensitive (preserves existing production semantics)

  it("default behavior is case-sensitive — contains", () => {
    expect(evaluateCondition("HELLO world", "HELLO world", mkCond("contains", "hello"))).toBe(false)
    expect(evaluateCondition("HELLO world", "HELLO world", mkCond("contains", "HELLO"))).toBe(true)
  })

  it("default behavior is case-sensitive — equals", () => {
    expect(evaluateCondition("Apple", "Apple", mkCond("=", "apple"))).toBe(false)
    expect(evaluateCondition("Apple", "Apple", mkCond("=", "Apple"))).toBe(true)
  })

  // Explicit caseSensitive: true — identical to default, exercised for completeness

  it("caseSensitive: true — explicit opt-in matches default", () => {
    expect(evaluateCondition("HELLO", "HELLO", mkCond("contains", "hello"), undefined,
      { caseSensitive: true })).toBe(false)
    expect(evaluateCondition("HELLO hello", "HELLO hello", mkCond("contains", "hello"), undefined,
      { caseSensitive: true })).toBe(true)
  })

  it("caseSensitive: true — equals, starts_with, ends_with are strict", () => {
    expect(evaluateCondition("Apple", "Apple", mkCond("=", "apple"), undefined,
      { caseSensitive: true })).toBe(false)
    expect(evaluateCondition("Apple", "Apple", mkCond("starts_with", "apple"), undefined,
      { caseSensitive: true })).toBe(false)
    expect(evaluateCondition("Apple", "Apple", mkCond("ends_with", "pple"), undefined,
      { caseSensitive: true })).toBe(true)
  })

  // caseSensitive: false — the new case-insensitive mode

  it("caseSensitive: false — contains", () => {
    expect(evaluateCondition("HELLO world", "HELLO world", mkCond("contains", "hello"), undefined,
      { caseSensitive: false })).toBe(true)
    expect(evaluateCondition("Foo", "Foo", mkCond("contains", "BAR"), undefined,
      { caseSensitive: false })).toBe(false)
  })

  it("caseSensitive: false — equals, not_equals, starts_with, ends_with", () => {
    expect(evaluateCondition("Apple", "Apple", mkCond("=", "apple"), undefined,
      { caseSensitive: false })).toBe(true)
    expect(evaluateCondition("Apple", "Apple", mkCond("!=", "APPLE"), undefined,
      { caseSensitive: false })).toBe(false)
    expect(evaluateCondition("Apple Pie", "Apple Pie", mkCond("starts_with", "apple"), undefined,
      { caseSensitive: false })).toBe(true)
    expect(evaluateCondition("Apple Pie", "Apple Pie", mkCond("ends_with", "PIE"), undefined,
      { caseSensitive: false })).toBe(true)
  })

  it("caseSensitive: false — not_contains respects the flag", () => {
    expect(evaluateCondition("HELLO world", "HELLO world", mkCond("not_contains", "hello"), undefined,
      { caseSensitive: false })).toBe(false)
    expect(evaluateCondition("HELLO world", "HELLO world", mkCond("not_contains", "xyz"), undefined,
      { caseSensitive: false })).toBe(true)
  })

  // Non-text operators are never affected by the flag

  it("ignores the option for non-text operators — >, <, exists, not_exists", () => {
    expect(evaluateCondition("5", "5", mkCond(">", "3"), undefined,
      { caseSensitive: true })).toBe(true)
    expect(evaluateCondition("5", "5", mkCond(">", "3"), undefined,
      { caseSensitive: false })).toBe(true)
    expect(evaluateCondition("value", "value", mkCond("exists", ""), undefined,
      { caseSensitive: true })).toBe(true)
    // not_exists is null/undefined-sensitive only. Use a field path pointing at
    // a missing key so the fieldValue is legitimately undefined under both settings.
    expect(evaluateCondition({ other: 1 }, "", mkCond("not_exists", "", "v"), undefined,
      { caseSensitive: false })).toBe(true)
    expect(evaluateCondition({ other: 1 }, "", mkCond("not_exists", "", "v"), undefined,
      { caseSensitive: true })).toBe(true)
  })

  it("regex operator is always driven by the pattern itself — option ignored", () => {
    // Users can use `(?i)` flags or explicitly matching patterns for
    // case-insensitive regex. The caseSensitive option does not modify the regex.
    expect(evaluateCondition("Apple", "Apple", mkCond("regex", "^apple$"), undefined,
      { caseSensitive: false })).toBe(false)
    expect(evaluateCondition("Apple", "Apple", mkCond("regex", "^Apple$"), undefined,
      { caseSensitive: false })).toBe(true)
  })
})
