import { describe, it, expect } from "vitest"
import { executeSelector } from "../inline-executor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"
import type { SelectorConfig } from "@nodaro/shared"

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data, position: { x: 0, y: 0 } } as SimpleNode
}

/**
 * Build a selector node wired to a single upstream source whose output
 * exposes `listResults`. Items arrive as strings — the same shape that
 * extract-field (outputType: "list"), web-scrape, or upstream list nodes
 * produce at runtime. Matches the scaffolding pattern in filter-list.test.ts
 * so we exercise the same `collectUpstreamListItems` code path.
 */
function setup(
  items: string[],
  config: SelectorConfig,
): { selector: SimpleNode; edges: SimpleEdge[]; nodes: SimpleNode[]; states: Record<string, NodeExecutionState> } {
  const src = makeNode("s", "extract-field", {})
  const selector = makeNode("sel", "selector", { config })
  const edges: SimpleEdge[] = [
    { id: "e1", source: "s", target: "sel", sourceHandle: "text", targetHandle: "in" } as SimpleEdge,
  ]
  const states: Record<string, NodeExecutionState> = {
    s: { status: "completed", output: { listResults: items, text: items[0] ?? "" } },
  }
  return { selector, edges, nodes: [src, selector], states }
}

describe("executeSelector — backend orchestrator", () => {
  it("item mode picks 1-based index", () => {
    const { selector, edges, nodes, states } = setup(
      ["a", "b", "c", "d"],
      { mode: "item", itemIndex: "2" },
    )
    const out = executeSelector(selector, edges, nodes, states)
    expect(out.pickedResults).toEqual(["b"])
    expect(out.restResults).toEqual(["a", "c", "d"])
    expect(out.text).toBe("b")
  })

  it("random mode is deterministic with seed", () => {
    const { selector, edges, nodes, states } = setup(
      ["a", "b", "c", "d", "e", "f"],
      { mode: "random", seed: "42", randomCount: 2 },
    )
    const a = executeSelector(selector, edges, nodes, states)
    const b = executeSelector(selector, edges, nodes, states)
    expect(a.pickedResults).toEqual(b.pickedResults)
    expect(a.restResults).toEqual(b.restResults)
    expect(a.pickedResults).toHaveLength(2)
  })

  it("predicate mode filters JSON items with match=all", () => {
    const items = [
      JSON.stringify({ score: 10 }),
      JSON.stringify({ score: 20 }),
      JSON.stringify({ score: 30 }),
    ]
    const { selector, edges, nodes, states } = setup(items, {
      mode: "predicate",
      predicateField: "score",
      predicateOp: ">=",
      predicateValue: "15",
      predicateMatch: "all",
    })
    const out = executeSelector(selector, edges, nodes, states)
    expect(out.pickedResults).toHaveLength(2)
    expect(out.restResults).toHaveLength(1)
    expect(out.pickedResults?.map((s) => JSON.parse(s).score)).toEqual([20, 30])
    expect(out.restResults?.map((s) => JSON.parse(s).score)).toEqual([10])
  })

  it("modulo mode picks divisor % length", () => {
    // 5 % 3 = 2 (0-based index → third item "c")
    const { selector, edges, nodes, states } = setup(
      ["a", "b", "c"],
      { mode: "modulo", moduloDivisor: "5" },
    )
    const out = executeSelector(selector, edges, nodes, states)
    expect(out.pickedResults).toEqual(["c"])
    expect(out.restResults).toEqual(["a", "b"])
  })

  it("returns empty arrays on empty upstream list", () => {
    const { selector, edges, nodes, states } = setup([], { mode: "item", itemIndex: "1" })
    const out = executeSelector(selector, edges, nodes, states)
    expect(out.pickedResults).toEqual([])
    expect(out.restResults).toEqual([])
    expect(out.text).toBe("")
  })
})
