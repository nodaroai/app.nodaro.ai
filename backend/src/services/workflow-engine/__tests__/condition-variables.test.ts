/**
 * Tests for variables support in filter-list and router condition values.
 * The `variables` target handle feeds label→output refs to conditions
 * without entering the filtered/routed data stream.
 */

import { describe, it, expect } from "vitest"
import { executeFilterList, executeRouter } from "../inline-executor.js"
import { extractSourceNodeOutput } from "../output-extractor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data, position: { x: 0, y: 0 } } as SimpleNode
}

function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle: string | null = "prompt",
  targetHandle = "in",
): SimpleEdge {
  return { id, source, target, sourceHandle, targetHandle } as SimpleEdge
}

const JSON_ITEMS = [
  JSON.stringify({ likes: 100 }),
  JSON.stringify({ likes: 500 }),
  JSON.stringify({ likes: 50 }),
]

function seedStates(nodes: SimpleNode[], extras: Record<string, NodeExecutionState> = {}): Record<string, NodeExecutionState> {
  const states: Record<string, NodeExecutionState> = { ...extras }
  for (const n of nodes) {
    if (states[n.id]) continue
    const output = extractSourceNodeOutput(n)
    if (output) states[n.id] = { status: "completed", output }
  }
  return states
}

describe("filter-list — condition variables handle", () => {
  it("resolves {Label} in condition value from a variables-handle upstream", () => {
    const src = node("src", "extract-field", { label: "Src" })
    const thresholdNode = node("thresh", "text-prompt", { label: "Threshold", text: "200" })
    const filter = node("f", "filter-list", {
      label: "Filter",
      conditionLogic: "AND",
      conditions: [{ id: "c1", field: "likes", operator: ">", value: "{Threshold}", valueType: "static" }],
    })
    const edges: SimpleEdge[] = [
      edge("e1", "src", "f", "text", "in"),
      edge("e2", "thresh", "f", "prompt", "variables"),
    ]
    const states = seedStates([thresholdNode], {
      src: { status: "completed", output: { listResults: JSON_ITEMS, text: JSON_ITEMS[0] } },
    })
    const result = executeFilterList(filter, edges, [src, thresholdNode, filter], states)
    expect(result.listResults).toHaveLength(1)
    expect(JSON.parse(result.listResults![0]).likes).toBe(500)
  })

  it("variables-handle upstream is NOT collected as a list item", () => {
    const src = node("src", "extract-field", { label: "Src" })
    const varNode = node("v", "text-prompt", { label: "Var", text: "ignored" })
    // No conditions — verifies data collection, not condition evaluation.
    const filter = node("f", "filter-list", { label: "Filter", conditionLogic: "AND", conditions: [] })
    const edges: SimpleEdge[] = [
      edge("e1", "src", "f", "text", "in"),
      edge("e2", "v", "f", "prompt", "variables"),
    ]
    const states = seedStates([varNode], {
      src: { status: "completed", output: { listResults: ["alpha", "beta"], text: "alpha" } },
    })
    const result = executeFilterList(filter, edges, [src, varNode, filter], states)
    // Should pass the upstream list through unchanged; "ignored" must not appear.
    expect(result.listResults).toEqual(["alpha", "beta"])
  })

  it("still resolves built-in {{now}} / {{trigger.*}} tokens alongside variables", () => {
    const src = node("src", "extract-field", { label: "Src" })
    const varNode = node("v", "text-prompt", { label: "Ref", text: "2026-04-21T00:00:00Z" })
    const filter = node("f", "filter-list", {
      label: "Filter",
      conditionLogic: "AND",
      conditions: [{ id: "c1", field: "date", operator: ">", value: "{Ref}", valueType: "static" }],
    })
    const items = [
      JSON.stringify({ date: "2026-05-01T00:00:00Z" }),
      JSON.stringify({ date: "2026-04-01T00:00:00Z" }),
    ]
    const edges: SimpleEdge[] = [
      edge("e1", "src", "f", "text", "in"),
      edge("e2", "v", "f", "prompt", "variables"),
    ]
    const states = seedStates([varNode], {
      src: { status: "completed", output: { listResults: items, text: items[0] } },
    })
    const result = executeFilterList(filter, edges, [src, varNode, filter], states)
    expect(result.listResults).toHaveLength(1)
    expect(JSON.parse(result.listResults![0]).date).toBe("2026-05-01T00:00:00Z")
  })

  it("without variables-handle edges, {Label} stays literal (no accidental match)", () => {
    const src = node("src", "extract-field", { label: "Src" })
    const filter = node("f", "filter-list", {
      label: "Filter",
      conditionLogic: "AND",
      conditions: [{ id: "c1", field: "v", operator: "=", value: "{Literal}", valueType: "static" }],
    })
    const items = [JSON.stringify({ v: "{Literal}" }), JSON.stringify({ v: "other" })]
    const edges: SimpleEdge[] = [edge("e1", "src", "f", "text", "in")]
    const states: Record<string, NodeExecutionState> = {
      src: { status: "completed", output: { listResults: items, text: items[0] } },
    }
    const result = executeFilterList(filter, edges, [src, filter], states)
    expect(result.listResults).toHaveLength(1)
    expect(JSON.parse(result.listResults![0]).v).toBe("{Literal}")
  })
})

describe("router — condition variables handle", () => {
  it("conditional group resolves {Label} from variables-handle upstream", () => {
    const src = node("src", "extract-field", { label: "Src" })
    const thresholdNode = node("t", "text-prompt", { label: "Threshold", text: "100" })
    const router = node("router", "router", {
      label: "Router",
      mode: "conditional",
      routes: [
        { id: "r1", name: "Over", active: false },
        { id: "r2", name: "Under", active: false },
      ],
      conditionGroups: [
        {
          id: "g1",
          conditionLogic: "AND",
          conditions: [{ id: "c1", field: "score", operator: ">", value: "{Threshold}", valueType: "static" }],
          routeIds: ["r1"],
        },
      ],
    })
    const edges: SimpleEdge[] = [
      edge("e1", "src", "router", "text", "in"),
      edge("e2", "t", "router", "prompt", "variables"),
    ]
    const states = seedStates([thresholdNode], {
      src: { status: "completed", output: { extractedText: JSON.stringify({ score: 250 }), text: JSON.stringify({ score: 250 }) } },
    })
    const result = executeRouter(router, edges, [src, thresholdNode, router], states)
    expect(result.activeRoutes).toEqual(["r1"])
  })

  it("variables-handle edge does not pollute the router's input value", () => {
    const src = node("src", "text-prompt", { label: "Src", text: "real-input" })
    const varNode = node("v", "text-prompt", { label: "Var", text: "should-not-be-input" })
    const router = node("router", "router", {
      label: "Router",
      mode: "conditional",
      routes: [{ id: "r1", name: "A", active: false }],
      conditionGroups: [
        {
          id: "g1",
          conditionLogic: "AND",
          // Match against the literal router-input text, not the variable.
          conditions: [{ id: "c1", field: "", operator: "=", value: "real-input", valueType: "static" }],
          routeIds: ["r1"],
        },
      ],
    })
    const edges: SimpleEdge[] = [
      edge("e1", "src", "router", "prompt", "in"),
      edge("e2", "v", "router", "prompt", "variables"),
    ]
    const states = seedStates([src, varNode])
    const result = executeRouter(router, edges, [src, varNode, router], states)
    expect(result.activeRoutes).toEqual(["r1"])
  })
})
