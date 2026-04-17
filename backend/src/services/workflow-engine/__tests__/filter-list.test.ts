import { describe, it, expect } from "vitest"
import { executeFilterList, type FilterListCondition } from "../inline-executor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data, position: { x: 0, y: 0 } } as SimpleNode
}

type Cond = Partial<FilterListCondition> & { operator: FilterListCondition["operator"] }

/**
 * Build a filter-list node wired to a single upstream source whose output
 * exposes `listResults`. Items arrive as strings — the same shape that
 * extract-field (outputType: "list") or web-scrape produce at runtime.
 * The filter-list `tryParseJson`'s each item before evaluating conditions.
 */
function setup(
  items: string[],
  conditions: Cond[],
  conditionLogic: "AND" | "OR" = "AND",
): { filter: SimpleNode; edges: SimpleEdge[]; nodes: SimpleNode[]; states: Record<string, NodeExecutionState> } {
  const src = makeNode("s", "extract-field", {})
  const filter = makeNode("f", "filter-list", {
    conditions: conditions.map((c, i) => ({
      id: c.id ?? `c${i}`,
      field: c.field ?? "",
      operator: c.operator,
      value: c.value ?? "",
      valueType: c.valueType ?? "static",
    })),
    conditionLogic,
  })
  const edges: SimpleEdge[] = [
    { id: "e1", source: "s", target: "f", sourceHandle: "text", targetHandle: "in" } as SimpleEdge,
  ]
  const states: Record<string, NodeExecutionState> = {
    s: { status: "completed", output: { listResults: items, text: items[0] ?? "" } },
  }
  return { filter, edges, nodes: [src, filter], states }
}

function run(items: string[], condition: Cond): string[] {
  const { filter, edges, nodes, states } = setup(items, [condition])
  return executeFilterList(filter, edges, nodes, states).listResults ?? []
}

describe("executeFilterList — operator semantics", () => {
  describe("ordering: > < >= <=", () => {
    it("number field: 432 > 20000 is false, 50000 > 20000 is true (the user's bug)", () => {
      const items = [
        JSON.stringify({ likesCount: 432, url: "a" }),
        JSON.stringify({ likesCount: 50000, url: "b" }),
        JSON.stringify({ likesCount: 891, url: "c" }),
      ]
      const kept = run(items, { field: "likesCount", operator: ">", value: "20000" })
      expect(kept).toHaveLength(1)
      expect(JSON.parse(kept[0]).url).toBe("b")
    })

    it("numeric-string field: '432' > '20000' is false (no lex compare)", () => {
      const kept = run(
        [JSON.stringify({ v: "432" }), JSON.stringify({ v: "20000" })],
        { field: "v", operator: ">", value: "1000" },
      )
      expect(kept).toHaveLength(1)
      expect(JSON.parse(kept[0]).v).toBe("20000")
    })

    it("< operator", () => {
      const kept = run(
        [JSON.stringify({ v: 432 }), JSON.stringify({ v: 50000 })],
        { field: "v", operator: "<", value: "1000" },
      )
      expect(kept).toHaveLength(1)
      expect(JSON.parse(kept[0]).v).toBe(432)
    })

    it(">= is boundary-inclusive", () => {
      const items = [
        JSON.stringify({ v: 99 }),
        JSON.stringify({ v: 100 }),
        JSON.stringify({ v: 101 }),
      ]
      const kept = run(items, { field: "v", operator: ">=", value: "100" })
      expect(kept.map((s) => JSON.parse(s).v)).toEqual([100, 101])
    })

    it("<= is boundary-inclusive", () => {
      const items = [
        JSON.stringify({ v: 99 }),
        JSON.stringify({ v: 100 }),
        JSON.stringify({ v: 101 }),
      ]
      const kept = run(items, { field: "v", operator: "<=", value: "100" })
      expect(kept.map((s) => JSON.parse(s).v)).toEqual([99, 100])
    })

    it("non-numeric field falls back to locale compare", () => {
      // "banana" vs "apple" → locale 'b' > 'a' → passes
      const kept = run(
        [JSON.stringify({ name: "banana" }), JSON.stringify({ name: "apple" })],
        { field: "name", operator: ">", value: "apple" },
      )
      expect(kept).toHaveLength(1)
      expect(JSON.parse(kept[0]).name).toBe("banana")
    })

    it("mixed number + numeric-string compares numerically", () => {
      const kept = run(
        [JSON.stringify({ v: 50000 }), JSON.stringify({ v: "432" })],
        { field: "v", operator: ">", value: "1000" },
      )
      expect(kept.map((s) => JSON.parse(s).v)).toEqual([50000])
    })
  })

  describe("equality: = !=", () => {
    it("number == numeric-string value", () => {
      const kept = run(
        [JSON.stringify({ v: 432 }), JSON.stringify({ v: 433 })],
        { field: "v", operator: "=", value: "432" },
      )
      expect(kept.map((s) => JSON.parse(s).v)).toEqual([432])
    })

    it("numeric-string field == numeric-string value", () => {
      const kept = run(
        [JSON.stringify({ v: "432" }), JSON.stringify({ v: "433" })],
        { field: "v", operator: "=", value: "432" },
      )
      expect(kept.map((s) => JSON.parse(s).v)).toEqual(["432"])
    })

    it("alpha field == alpha value (string fallback)", () => {
      const kept = run(
        [JSON.stringify({ name: "alice" }), JSON.stringify({ name: "bob" })],
        { field: "name", operator: "=", value: "alice" },
      )
      expect(kept.map((s) => JSON.parse(s).name)).toEqual(["alice"])
    })

    it("!= excludes matching items", () => {
      const kept = run(
        [JSON.stringify({ v: 1 }), JSON.stringify({ v: 2 }), JSON.stringify({ v: "2" })],
        { field: "v", operator: "!=", value: "2" },
      )
      // Both 2 and "2" coerce to 2 and are excluded.
      expect(kept.map((s) => JSON.parse(s).v)).toEqual([1])
    })

    it("null field = '' is true (both coerce to '')", () => {
      const kept = run([JSON.stringify({ v: null })], { field: "v", operator: "=", value: "" })
      expect(kept).toHaveLength(1)
    })

    it("missing field = '' is true (undefined path coerces to '')", () => {
      const kept = run([JSON.stringify({ other: 1 })], { field: "v", operator: "=", value: "" })
      expect(kept).toHaveLength(1)
    })
  })

  describe("string: contains not_contains", () => {
    it("contains matches substring", () => {
      const kept = run(
        [JSON.stringify({ title: "Hello World" }), JSON.stringify({ title: "Goodbye" })],
        { field: "title", operator: "contains", value: "World" },
      )
      expect(kept.map((s) => JSON.parse(s).title)).toEqual(["Hello World"])
    })

    it("contains stringifies numeric field values", () => {
      // 432 → "432" contains "3" → true
      const kept = run(
        [JSON.stringify({ v: 432 }), JSON.stringify({ v: 500 })],
        { field: "v", operator: "contains", value: "3" },
      )
      expect(kept.map((s) => JSON.parse(s).v)).toEqual([432])
    })

    it("not_contains inverts", () => {
      const kept = run(
        [JSON.stringify({ title: "Hello World" }), JSON.stringify({ title: "Goodbye" })],
        { field: "title", operator: "not_contains", value: "World" },
      )
      expect(kept.map((s) => JSON.parse(s).title)).toEqual(["Goodbye"])
    })

    it("contains against missing field treats value as '' (all pass)", () => {
      const kept = run(
        [JSON.stringify({ other: 1 })],
        { field: "missing", operator: "contains", value: "" },
      )
      // "".includes("") is true
      expect(kept).toHaveLength(1)
    })
  })

  describe("existence: exists not_exists", () => {
    it("exists: present number passes", () => {
      const kept = run([JSON.stringify({ v: 0 })], { field: "v", operator: "exists" })
      expect(kept).toHaveLength(1)
    })

    it("exists: null fails", () => {
      const kept = run([JSON.stringify({ v: null })], { field: "v", operator: "exists" })
      expect(kept).toEqual([])
    })

    it("exists: missing field fails", () => {
      const kept = run([JSON.stringify({ other: 1 })], { field: "v", operator: "exists" })
      expect(kept).toEqual([])
    })

    it("exists: empty string PASSES (null/undefined-only check)", () => {
      const kept = run([JSON.stringify({ v: "" })], { field: "v", operator: "exists" })
      expect(kept).toHaveLength(1)
    })

    it("exists: false passes (booleans are real values)", () => {
      const kept = run([JSON.stringify({ v: false })], { field: "v", operator: "exists" })
      expect(kept).toHaveLength(1)
    })

    it("not_exists: null passes", () => {
      const kept = run([JSON.stringify({ v: null })], { field: "v", operator: "not_exists" })
      expect(kept).toHaveLength(1)
    })

    it("not_exists: missing field passes", () => {
      const kept = run([JSON.stringify({ other: 1 })], { field: "v", operator: "not_exists" })
      expect(kept).toHaveLength(1)
    })

    it("not_exists: empty string fails (empty string exists)", () => {
      const kept = run([JSON.stringify({ v: "" })], { field: "v", operator: "not_exists" })
      expect(kept).toEqual([])
    })
  })

  describe("mixed types", () => {
    it("boolean field as 0/1 with >", () => {
      // true → 1 > 0 = true
      const kept = run([JSON.stringify({ active: true })], { field: "active", operator: ">", value: "0" })
      expect(kept).toHaveLength(1)
    })

    it("number field compared against empty value falls back to string", () => {
      // 432 vs "" → num-vs-NaN → fallback: "432".localeCompare("") → positive → > 0 true
      const kept = run([JSON.stringify({ v: 432 })], { field: "v", operator: ">", value: "" })
      expect(kept).toHaveLength(1)
    })
  })

  describe("AND/OR logic", () => {
    it("AND: all conditions must pass", () => {
      const items = [
        JSON.stringify({ a: 10, b: 20 }),
        JSON.stringify({ a: 10, b: 5 }),
      ]
      const { filter, edges, nodes, states } = setup(items, [
        { field: "a", operator: ">=", value: "10" },
        { field: "b", operator: ">=", value: "20" },
      ], "AND")
      const kept = executeFilterList(filter, edges, nodes, states).listResults ?? []
      expect(kept).toHaveLength(1)
      expect(JSON.parse(kept[0]).b).toBe(20)
    })

    it("OR: any condition passes", () => {
      const items = [
        JSON.stringify({ a: 10, b: 5 }),
        JSON.stringify({ a: 0, b: 100 }),
        JSON.stringify({ a: 0, b: 0 }),
      ]
      const { filter, edges, nodes, states } = setup(items, [
        { field: "a", operator: ">=", value: "10" },
        { field: "b", operator: ">=", value: "50" },
      ], "OR")
      const kept = executeFilterList(filter, edges, nodes, states).listResults ?? []
      expect(kept).toHaveLength(2)
    })

    it("no conditions → all items pass through", () => {
      const items = [JSON.stringify({ v: 1 }), JSON.stringify({ v: 2 })]
      const { filter, edges, nodes, states } = setup(items, [])
      const kept = executeFilterList(filter, edges, nodes, states).listResults ?? []
      expect(kept).toHaveLength(2)
    })
  })

  /**
   * Web-scrape's output shape is `{ json: [...] }` (no listResults). Without
   * the spread handling in collectUpstreamListItems, Filter List would see a
   * single giant stringified-array item and per-item conditions would match
   * the first element's field value against the whole chain.
   */
  describe("upstream with output.json (e.g. web-scrape)", () => {
    function setupWithJson(json: unknown, conditions: Cond[]) {
      const src = makeNode("s", "web-scrape", { actor: "instagram" })
      const filter = makeNode("f", "filter-list", {
        conditions: conditions.map((c, i) => ({
          id: c.id ?? `c${i}`,
          field: c.field ?? "",
          operator: c.operator,
          value: c.value ?? "",
          valueType: c.valueType ?? "static",
        })),
        conditionLogic: "AND",
      })
      const edges: SimpleEdge[] = [
        { id: "e1", source: "s", target: "f", sourceHandle: "json", targetHandle: "in" } as SimpleEdge,
      ]
      const states: Record<string, NodeExecutionState> = {
        s: { status: "completed", output: { json } },
      }
      return { filter, edges, nodes: [src, filter], states }
    }

    it("array json spreads into per-item filtering (the user's bug)", () => {
      const posts = [
        { likesCount: 432, url: "a" },
        { likesCount: 50000, url: "b" },
        { likesCount: 891, url: "c" },
      ]
      const { filter, edges, nodes, states } = setupWithJson(posts, [
        { field: "likesCount", operator: ">", value: "20000" },
      ])
      const kept = executeFilterList(filter, edges, nodes, states).listResults ?? []
      expect(kept).toHaveLength(1)
      expect(JSON.parse(kept[0]).url).toBe("b")
    })

    it("array json with no conditions preserves every element", () => {
      const posts = [{ a: 1 }, { a: 2 }, { a: 3 }]
      const { filter, edges, nodes, states } = setupWithJson(posts, [])
      const kept = executeFilterList(filter, edges, nodes, states).listResults ?? []
      expect(kept).toHaveLength(3)
      expect(kept.map((s) => JSON.parse(s).a)).toEqual([1, 2, 3])
    })

    it("array json with string elements is preserved as-is (not re-stringified)", () => {
      const { filter, edges, nodes, states } = setupWithJson(
        ["foo", "bar", "baz"],
        [{ field: "", operator: "contains", value: "ba" }],
      )
      const kept = executeFilterList(filter, edges, nodes, states).listResults ?? []
      expect(kept).toEqual(["bar", "baz"])
    })

    it("array json skips null/undefined elements", () => {
      const { filter, edges, nodes, states } = setupWithJson(
        [{ v: 1 }, null, { v: 2 }, undefined, { v: 3 }],
        [],
      )
      const kept = executeFilterList(filter, edges, nodes, states).listResults ?? []
      expect(kept).toHaveLength(3)
    })

    it("single object json produces a single filter-list item", () => {
      const { filter, edges, nodes, states } = setupWithJson(
        { likesCount: 432, url: "x" },
        [{ field: "likesCount", operator: ">", value: "100" }],
      )
      const kept = executeFilterList(filter, edges, nodes, states).listResults ?? []
      expect(kept).toHaveLength(1)
      expect(JSON.parse(kept[0]).url).toBe("x")
    })

    it("single object json is excluded when condition fails", () => {
      const { filter, edges, nodes, states } = setupWithJson(
        { likesCount: 432 },
        [{ field: "likesCount", operator: ">", value: "20000" }],
      )
      const kept = executeFilterList(filter, edges, nodes, states).listResults ?? []
      expect(kept).toEqual([])
    })

    it("primitive json produces a single item via String()", () => {
      const { filter, edges, nodes, states } = setupWithJson(
        42,
        [{ field: "", operator: "=", value: "42" }],
      )
      const kept = executeFilterList(filter, edges, nodes, states).listResults ?? []
      expect(kept).toEqual(["42"])
    })

    it("empty array json yields no items", () => {
      const { filter, edges, nodes, states } = setupWithJson([], [])
      const kept = executeFilterList(filter, edges, nodes, states).listResults ?? []
      expect(kept).toEqual([])
    })

    it("null json falls through (no items collected)", () => {
      const { filter, edges, nodes, states } = setupWithJson(null, [])
      const kept = executeFilterList(filter, edges, nodes, states).listResults ?? []
      expect(kept).toEqual([])
    })
  })
})
