import { describe, it, expect } from "vitest"
import { evaluateJsonPath } from "../json-path.js"

describe("evaluateJsonPath", () => {
  it("returns leaf value for simple path on object", () => {
    expect(evaluateJsonPath({ name: "Alice" }, "name")).toEqual(["Alice"])
  })

  it("returns empty array for missing property", () => {
    expect(evaluateJsonPath({ name: "Alice" }, "age")).toEqual([])
  })

  it("auto-iterates top-level array", () => {
    const input = [{ caption: "a" }, { caption: "b" }, { caption: "c" }]
    expect(evaluateJsonPath(input, "caption")).toEqual(["a", "b", "c"])
  })

  it("auto-iterates nested array mid-path", () => {
    const input = { pages: [{ url: "u1", md: "m1" }, { url: "u2", md: "m2" }] }
    expect(evaluateJsonPath(input, "pages.url")).toEqual(["u1", "u2"])
    expect(evaluateJsonPath(input, "pages.md")).toEqual(["m1", "m2"])
  })

  it("handles deep nesting", () => {
    const input = [{ authorMeta: { name: "bob" } }, { authorMeta: { name: "sue" } }]
    expect(evaluateJsonPath(input, "authorMeta.name")).toEqual(["bob", "sue"])
  })

  it("skips items missing the path (returns only successful ones)", () => {
    const input = [{ caption: "a" }, {}, { caption: "c" }]
    expect(evaluateJsonPath(input, "caption")).toEqual(["a", "c"])
  })

  it("returns null/undefined values as-is in the array (caller filters)", () => {
    const input = [{ caption: null }, { caption: "b" }]
    expect(evaluateJsonPath(input, "caption")).toEqual([null, "b"])
  })

  it("returns the full value when path is empty string", () => {
    expect(evaluateJsonPath({ a: 1 }, "")).toEqual([{ a: 1 }])
    expect(evaluateJsonPath([1, 2, 3], "")).toEqual([1, 2, 3])
  })

  it("treats primitive root with path as dead end", () => {
    expect(evaluateJsonPath("hello", "foo")).toEqual([])
    expect(evaluateJsonPath(42, "foo")).toEqual([])
  })

  it("ignores inherited properties (toString, constructor, __proto__)", () => {
    expect(evaluateJsonPath({ a: 1 }, "toString")).toEqual([])
    expect(evaluateJsonPath({ a: 1 }, "__proto__")).toEqual([])
    expect(evaluateJsonPath({ a: 1 }, "constructor")).toEqual([])
  })

  it("handles objects at leaf (returns object, not stringified — caller handles coercion)", () => {
    const input = [{ meta: { a: 1 } }, { meta: { a: 2 } }]
    expect(evaluateJsonPath(input, "meta")).toEqual([{ a: 1 }, { a: 2 }])
  })

  it("returns each element when root is a scalar array and path is empty (whole-item mode)", () => {
    expect(evaluateJsonPath(["a", "b", "c"], "")).toEqual(["a", "b", "c"])
    expect(evaluateJsonPath([1, 2, 3], "")).toEqual([1, 2, 3])
  })
})
