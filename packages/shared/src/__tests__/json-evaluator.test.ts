import { describe, it, expect } from "vitest"
import { buildExpressionFromVisual } from "../json-evaluator.js"

describe("buildExpressionFromVisual", () => {
  it("returns identity for empty config", () => {
    expect(buildExpressionFromVisual({})).toBe(".")
  })

  it("returns dot-path for inputPath only", () => {
    expect(buildExpressionFromVisual({ inputPath: "data.items" })).toBe(".data.items")
  })

  it("adds [] when filters exist", () => {
    const result = buildExpressionFromVisual({
      inputPath: "products",
      filters: [{ id: "1", field: "price", operator: "less_than" as const, value: "50" }],
    })
    expect(result).toBe('.products[] | select(.price < 50)')
  })

  it("adds [] when projections exist", () => {
    const result = buildExpressionFromVisual({
      inputPath: "products",
      projections: ["name", "price"],
    })
    expect(result).toBe('.products[] | {name, price}')
  })

  it("generates all three stages", () => {
    const result = buildExpressionFromVisual({
      inputPath: "products",
      filters: [{ id: "1", field: "price", operator: "less_than" as const, value: "50" }],
      projections: ["name", "url", "price"],
    })
    expect(result).toBe('.products[] | select(.price < 50) | {name, url, price}')
  })

  it("iterates root when no inputPath but filters exist", () => {
    const result = buildExpressionFromVisual({
      filters: [{ id: "1", field: "status", operator: "equals" as const, value: "active" }],
    })
    expect(result).toBe('.[] | select(.status == "active")')
  })

  it("iterates root when no inputPath but projections exist", () => {
    const result = buildExpressionFromVisual({
      projections: ["name", "email"],
    })
    expect(result).toBe('.[] | {name, email}')
  })

  it("joins multiple filters with pipe (AND)", () => {
    const result = buildExpressionFromVisual({
      filters: [
        { id: "1", field: "status", operator: "equals" as const, value: "active" },
        { id: "2", field: "age", operator: "greater_than" as const, value: "18" },
      ],
    })
    expect(result).toBe('.[] | select(.status == "active") | select(.age > 18)')
  })

  it("uses bracket notation for non-identifier-safe fields in filters", () => {
    const result = buildExpressionFromVisual({
      filters: [{ id: "1", field: "api-key", operator: "equals" as const, value: "abc" }],
    })
    expect(result).toBe('.[] | select(.["api-key"] == "abc")')
  })

  it("uses bracket notation for non-identifier-safe fields in projections", () => {
    const result = buildExpressionFromVisual({
      projections: ["name", "api-key"],
    })
    expect(result).toBe('.[] | {name, "api-key": .["api-key"]}')
  })
})

describe("filter operator mapping", () => {
  const wrap = (op: string, field: string, value: string | string[]) =>
    buildExpressionFromVisual({
      filters: [{ id: "1", field, operator: op as any, value }],
    })

  it("equals with string", () => expect(wrap("equals", "s", "active")).toBe('.[] | select(.s == "active")'))
  it("equals with number", () => expect(wrap("equals", "n", "42")).toBe('.[] | select(.n == 42)'))
  it("not_equals", () => expect(wrap("not_equals", "s", "draft")).toBe('.[] | select(.s != "draft")'))
  it("contains", () => expect(wrap("contains", "s", "foo")).toBe('.[] | select(.s | contains("foo"))'))
  it("not_contains", () => expect(wrap("not_contains", "s", "bar")).toBe('.[] | select(.s | contains("bar") | not)'))
  it("starts_with", () => expect(wrap("starts_with", "s", "pre")).toBe('.[] | select(.s | startswith("pre"))'))
  it("ends_with", () => expect(wrap("ends_with", "s", ".jpg")).toBe('.[] | select(.s | endswith(".jpg"))'))
  it("greater_than", () => expect(wrap("greater_than", "n", "50")).toBe('.[] | select(.n > 50)'))
  it("less_than", () => expect(wrap("less_than", "n", "100")).toBe('.[] | select(.n < 100)'))
  it("is_empty", () => expect(wrap("is_empty", "s", "")).toBe('.[] | select(.s == null or .s == "")'))
  it("is_not_empty", () => expect(wrap("is_not_empty", "s", "")).toBe('.[] | select(.s != null and .s != "")'))
  it("matches_regex", () => expect(wrap("matches_regex", "s", "^A")).toBe('.[] | select(.s | test("^A"))'))
  it("in_list", () => expect(wrap("in_list", "s", ["a", "b"])).toBe('.[] | select(.s == "a" or .s == "b")'))
  it("in_list with number", () => expect(wrap("in_list", "n", ["1", "2"])).toBe('.[] | select(.n == 1 or .n == 2)'))
  // Regression: switching to in_list keeps the previous operator's string value
  // until the user edits it. Previously this threw `value.map is not a function`
  // during re-render, crashing the config panel.
  it("in_list tolerates a comma-separated string (operator just switched)", () =>
    expect(wrap("in_list", "s", "a, b, c")).toBe('.[] | select(.s == "a" or .s == "b" or .s == "c")'))
  it("in_list with a plain string falls back to single-value equality", () =>
    expect(wrap("in_list", "s", "only")).toBe('.[] | select(.s == "only")'))
  it("in_list with empty value emits select(false) so nothing passes", () =>
    expect(wrap("in_list", "s", "")).toBe('.[] | select(false)'))
})

describe("string escaping", () => {
  const wrap = (op: string, field: string, value: string | string[]) =>
    buildExpressionFromVisual({
      filters: [{ id: "1", field, operator: op as any, value }],
    })

  it("escapes double-quote in contains value", () =>
    expect(wrap("contains", "s", 'say "hi"')).toBe('.[] | select(.s | contains("say \\"hi\\""))'))

  it("escapes backslash in contains value", () =>
    expect(wrap("contains", "s", "a\\b")).toBe('.[] | select(.s | contains("a\\\\b"))'))

  it("escapes double-quote in starts_with value", () =>
    expect(wrap("starts_with", "s", 'a"b')).toBe('.[] | select(.s | startswith("a\\"b"))'))

  it("escapes double-quote in equals value", () =>
    expect(wrap("equals", "s", 'a"b')).toBe('.[] | select(.s == "a\\"b")'))

  it("escapes double-quote in matches_regex value", () =>
    expect(wrap("matches_regex", "s", 'a"b')).toBe('.[] | select(.s | test("a\\"b"))'))

  it("escapes double-quote in field name bracket notation", () => {
    const r = buildExpressionFromVisual({
      filters: [{ id: "1", field: 'weird"name', operator: "equals" as const, value: "x" }],
    })
    expect(r).toBe('.[] | select(.["weird\\"name"] == "x")')
  })

  it("escapes double-quote in in_list value", () => {
    const r = buildExpressionFromVisual({
      filters: [{ id: "1", field: "s", operator: "in_list" as const, value: ['a"b', "c"] }],
    })
    expect(r).toBe('.[] | select(.s == "a\\"b" or .s == "c")')
  })
})

import { evaluateJsonExpression } from "../json-evaluator.js"

describe("evaluateJsonExpression", () => {
  const data = [
    { name: "Alice", age: 30, status: "active", email: "alice@example.com" },
    { name: "Bob", age: 17, status: "inactive", email: "" },
    { name: "Charlie", age: 25, status: "active", email: "charlie@example.com" },
  ]

  it("identity expression returns input as-is", () => {
    const r = evaluateJsonExpression(data, ".")
    expect(r).toEqual({ ok: true, value: data })
  })

  it("dot path navigates objects", () => {
    const r = evaluateJsonExpression({ data: { items: [1, 2] } }, ".data.items")
    expect(r).toEqual({ ok: true, value: [1, 2] })
  })

  it("bracket access works", () => {
    const r = evaluateJsonExpression({ "api-key": "secret" }, '.["api-key"]')
    expect(r).toEqual({ ok: true, value: "secret" })
  })

  it("array iteration expands items", () => {
    const r = evaluateJsonExpression([1, 2, 3], ".[] | select(. > 1)")
    expect(r).toEqual({ ok: true, value: [2, 3] })
  })

  it("index access works", () => {
    const r = evaluateJsonExpression([10, 20, 30], ".[0]")
    expect(r).toEqual({ ok: true, value: 10 })
  })

  it("negative index access works", () => {
    const r = evaluateJsonExpression([10, 20, 30], ".[-1]")
    expect(r).toEqual({ ok: true, value: 30 })
  })

  it("select filters items", () => {
    const r = evaluateJsonExpression(data, '.[] | select(.status == "active")')
    expect(r).toEqual({ ok: true, value: [data[0], data[2]] })
  })

  it("object construction projects fields", () => {
    const r = evaluateJsonExpression(data, ".[] | {name, age}")
    expect(r).toEqual({
      ok: true,
      value: [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 17 },
        { name: "Charlie", age: 25 },
      ],
    })
  })

  it("rename in object construction", () => {
    const r = evaluateJsonExpression({ name: "Alice" }, "{full_name: .name}")
    expect(r).toEqual({ ok: true, value: { full_name: "Alice" } })
  })

  it("select + project pipeline", () => {
    const r = evaluateJsonExpression(data, '.[] | select(.age > 18) | {name, status}')
    expect(r).toEqual({
      ok: true,
      value: [
        { name: "Alice", status: "active" },
        { name: "Charlie", status: "active" },
      ],
    })
  })

  it("boolean and/or in select", () => {
    const r = evaluateJsonExpression(data, '.[] | select(.age > 18 and .status == "active")')
    expect(r).toEqual({ ok: true, value: [data[0], data[2]] })
  })

  it("contains string function", () => {
    const r = evaluateJsonExpression(data, '.[] | select(.name | contains("li"))')
    expect(r).toEqual({ ok: true, value: [data[0], data[2]] })
  })

  it("startswith string function", () => {
    const r = evaluateJsonExpression(data, '.[] | select(.name | startswith("A"))')
    expect(r).toEqual({ ok: true, value: [data[0]] })
  })

  it("endswith string function", () => {
    const r = evaluateJsonExpression(data, '.[] | select(.name | endswith("e"))')
    expect(r).toEqual({ ok: true, value: [data[0], data[2]] })
  })

  it("test regex function", () => {
    const r = evaluateJsonExpression(data, '.[] | select(.name | test("^[AC]"))')
    expect(r).toEqual({ ok: true, value: [data[0], data[2]] })
  })

  it("not as postfix pipe", () => {
    const r = evaluateJsonExpression(data, '.[] | select(.name | contains("Bob") | not)')
    expect(r).toEqual({ ok: true, value: [data[0], data[2]] })
  })

  it("object[] on non-array yields object as single item", () => {
    const obj = { name: "Alice", age: 30 }
    const r = evaluateJsonExpression(obj, ".[] | {name}")
    expect(r).toEqual({ ok: true, value: { name: "Alice" } })
  })

  it("returns error for unknown field with suggestions", () => {
    const r = evaluateJsonExpression({ name: "Alice", email: "a@b.com" }, ".statsu")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("statsu")
  })

  it("returns error for invalid expression", () => {
    const r = evaluateJsonExpression({}, ".[] |")
    expect(r.ok).toBe(false)
  })

  it("handles null/undefined input gracefully", () => {
    const r = evaluateJsonExpression(null, ".")
    expect(r).toEqual({ ok: true, value: null })
  })

  it("rejects nested quantifiers in regex", () => {
    const r = evaluateJsonExpression(["a"], '.[] | select(. | test("(a+)+b"))')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("complex")
  })

  it("object construction drops whole object when field value is dropped", () => {
    const r = evaluateJsonExpression([1, 2, 3], ".[] | {v: select(. > 1), doubled: .}")
    // First item: select(1 > 1) is DROPPED, so whole object drops → []
    // Second item: select(2 > 1) truthy keeps 2, doubled 2 → {v: 2, doubled: 2}
    // Third item: similar → {v: 3, doubled: 3}
    expect(r).toEqual({ ok: true, value: [{ v: 2, doubled: 2 }, { v: 3, doubled: 3 }] })
  })

  it("does not leak state between calls", () => {
    const arr = [1, 2, 3]
    const r1 = evaluateJsonExpression(arr, ".[]")
    const r2 = evaluateJsonExpression(arr, ".")
    expect(r1).toEqual({ ok: true, value: [1, 2, 3] })
    expect(r2).toEqual({ ok: true, value: [1, 2, 3] })
  })
})
