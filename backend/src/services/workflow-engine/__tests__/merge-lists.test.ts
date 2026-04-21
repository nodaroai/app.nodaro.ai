import { describe, it, expect } from "vitest"
import { executeMergeLists } from "../inline-executor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data, position: { x: 0, y: 0 } } as SimpleNode
}

function setupTwoSources(
  mergeData: Record<string, unknown>,
  leftItems: string[],
  rightItems: string[],
): { merge: SimpleNode; edges: SimpleEdge[]; nodes: SimpleNode[]; states: Record<string, NodeExecutionState> } {
  const left = makeNode("l", "filter-list", {})
  const right = makeNode("r", "filter-list", {})
  const merge = makeNode("m", "merge-lists", mergeData)
  const edges: SimpleEdge[] = [
    { id: "e_l", source: "l", target: "m", sourceHandle: null, targetHandle: "in" } as SimpleEdge,
    { id: "e_r", source: "r", target: "m", sourceHandle: null, targetHandle: "in" } as SimpleEdge,
  ]
  const states: Record<string, NodeExecutionState> = {
    l: { status: "completed", output: { listResults: leftItems, text: leftItems[0] ?? "" } },
    r: { status: "completed", output: { listResults: rightItems, text: rightItems[0] ?? "" } },
  }
  return { merge, edges, nodes: [left, right, merge], states }
}

describe("executeMergeLists — concat mode (default)", () => {
  it("appends items in edge order", () => {
    const { merge, edges, nodes, states } = setupTwoSources({}, ["a", "b"], ["c", "d"])
    const result = executeMergeLists(merge, edges, nodes, states)
    expect(result.listResults).toEqual(["a", "b", "c", "d"])
  })

  it("deduplicates when flag is on", () => {
    const { merge, edges, nodes, states } = setupTwoSources({ deduplicate: true }, ["a", "b"], ["b", "c"])
    const result = executeMergeLists(merge, edges, nodes, states)
    expect(result.listResults).toEqual(["a", "b", "c"])
  })
})

describe("executeMergeLists — zip mode", () => {
  it("injects a single-item object across every item of a longer list (the user's scenario)", () => {
    const { merge, edges, nodes, states } = setupTwoSources(
      { mode: "zip" },
      [
        JSON.stringify({ name: "a" }),
        JSON.stringify({ name: "b" }),
        JSON.stringify({ name: "c" }),
      ],
      [JSON.stringify({ grade: 23 })],
    )
    const result = executeMergeLists(merge, edges, nodes, states)
    expect(result.listResults).toEqual([
      JSON.stringify({ name: "a", grade: 23 }),
      JSON.stringify({ name: "b", grade: 23 }),
      JSON.stringify({ name: "c", grade: 23 }),
    ])
  })

  it("merges equal-length object lists element-wise", () => {
    const { merge, edges, nodes, states } = setupTwoSources(
      { mode: "zip" },
      [JSON.stringify({ a: 1 }), JSON.stringify({ a: 2 })],
      [JSON.stringify({ b: 10 }), JSON.stringify({ b: 20 })],
    )
    const result = executeMergeLists(merge, edges, nodes, states)
    expect(result.listResults).toEqual([
      JSON.stringify({ a: 1, b: 10 }),
      JSON.stringify({ a: 2, b: 20 }),
    ])
  })

  it("wraps with modulo on mismatched lengths (3 x 2)", () => {
    const { merge, edges, nodes, states } = setupTwoSources(
      { mode: "zip" },
      [JSON.stringify({ x: 1 }), JSON.stringify({ x: 2 }), JSON.stringify({ x: 3 })],
      [JSON.stringify({ y: "a" }), JSON.stringify({ y: "b" })],
    )
    const result = executeMergeLists(merge, edges, nodes, states)
    expect(result.listResults).toEqual([
      JSON.stringify({ x: 1, y: "a" }),
      JSON.stringify({ x: 2, y: "b" }),
      JSON.stringify({ x: 3, y: "a" }),
    ])
  })

  it("spreads a JSON-array-string singleton upstream before zipping (end-to-end user scenario)", () => {
    // left = list node with ONE row holding a JSON array of 3 objects
    // right = json-process node emitting ONE object
    const left = makeNode("l", "list", {})
    const right = makeNode("r", "json-process", {})
    const merge = makeNode("m", "merge-lists", { mode: "zip" })
    const edges: SimpleEdge[] = [
      { id: "e_l", source: "l", target: "m", sourceHandle: null, targetHandle: "in" } as SimpleEdge,
      { id: "e_r", source: "r", target: "m", sourceHandle: null, targetHandle: "in" } as SimpleEdge,
    ]
    const encodedArray = JSON.stringify([
      { name: "a" },
      { name: "b" },
      { name: "c" },
    ])
    const states: Record<string, NodeExecutionState> = {
      l: { status: "completed", output: { listResults: [encodedArray], text: encodedArray } },
      r: { status: "completed", output: { listResults: [JSON.stringify({ grade: 23 })], text: JSON.stringify({ grade: 23 }) } },
    }
    const result = executeMergeLists(merge, edges, [left, right, merge], states)
    expect(result.listResults).toEqual([
      JSON.stringify({ name: "a", grade: 23 }),
      JSON.stringify({ name: "b", grade: 23 }),
      JSON.stringify({ name: "c", grade: 23 }),
    ])
  })
})
