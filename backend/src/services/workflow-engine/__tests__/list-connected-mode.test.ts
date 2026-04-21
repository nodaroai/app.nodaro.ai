/**
 * Tests for list nodes in "connected mode" — when a list has no manual rows
 * but is fed by an upstream connection (e.g. text-prompt). The list's UI
 * shows the connected items, so downstream list-processing nodes
 * (filter-list, deduplicate, merge-lists, sort-list, json-process, extract-field)
 * must see the same items.
 */

import { describe, it, expect } from "vitest"
import {
  executeFilterList,
  executeDeduplicateList,
  executeMergeLists,
  executeSortList,
  executeJsonProcess,
  executeExtractField,
} from "../inline-executor.js"
import { extractSourceNodeOutput } from "../output-extractor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data, position: { x: 0, y: 0 } } as SimpleNode
}

function edge(id: string, source: string, target: string, sourceHandle = "out", targetHandle = "in"): SimpleEdge {
  return { id, source, target, sourceHandle, targetHandle } as SimpleEdge
}

/** Build nodeStates the way the orchestrator does for source nodes. */
function bootStates(nodes: SimpleNode[]): Record<string, NodeExecutionState> {
  const states: Record<string, NodeExecutionState> = {}
  for (const n of nodes) {
    const output = extractSourceNodeOutput(n)
    if (output) states[n.id] = { status: "completed", output }
  }
  return states
}

const JSON_TEXT = '[{"name":"a"},{"name":"b"}]'

const listConnected = () =>
  node("l", "list", {
    columns: [{ id: "c1", name: "Col", handleId: "col1", type: "text" }],
    rows: [],
  })

const textPrompt = () => node("tp", "text-prompt", { text: JSON_TEXT })

describe("list node in connected mode — downstream list processors", () => {
  it("filter-list sees items when upstream is text-prompt → list", () => {
    const nodes = [textPrompt(), listConnected(), node("f", "filter-list", { conditions: [], conditionLogic: "AND" })]
    const edges = [edge("e1", "tp", "l", "prompt", "in"), edge("e2", "l", "f", "list", "in")]
    const result = executeFilterList(nodes[2], edges, nodes, bootStates(nodes))
    expect(result.listResults).toEqual(['{"name":"a"}', '{"name":"b"}'])
  })

  it("deduplicate sees items when upstream is text-prompt → list", () => {
    const nodes = [textPrompt(), listConnected(), node("d", "deduplicate", {})]
    const edges = [edge("e1", "tp", "l", "prompt", "in"), edge("e2", "l", "d", "list", "in")]
    const result = executeDeduplicateList(nodes[2], edges, nodes, bootStates(nodes))
    expect(result.listResults).toEqual(['{"name":"a"}', '{"name":"b"}'])
  })

  it("sort-list sees items when upstream is text-prompt → list", () => {
    const nodes = [textPrompt(), listConnected(), node("s", "sort-list", { field: "name", direction: "desc" })]
    const edges = [edge("e1", "tp", "l", "prompt", "in"), edge("e2", "l", "s", "list", "in")]
    const result = executeSortList(nodes[2], edges, nodes, bootStates(nodes))
    expect(result.listResults).toEqual(['{"name":"b"}', '{"name":"a"}'])
  })

  it("merge-lists (concat) sees items from a list in connected mode", () => {
    const nodes = [textPrompt(), listConnected(), node("m", "merge-lists", { mode: "concat" })]
    const edges = [edge("e1", "tp", "l", "prompt", "in"), edge("e2", "l", "m", "list", "in")]
    const result = executeMergeLists(nodes[2], edges, nodes, bootStates(nodes))
    expect(result.listResults).toEqual(['{"name":"a"}', '{"name":"b"}'])
  })

  it("json-process sees JSON when upstream is text-prompt → list", () => {
    const nodes = [textPrompt(), listConnected(), node("j", "json-process", { mode: "advanced", expression: ".[] | .name" })]
    const edges = [edge("e1", "tp", "l", "prompt", "in"), edge("e2", "l", "j", "list", "in")]
    const result = executeJsonProcess(nodes[2], edges, nodes, bootStates(nodes))
    expect(result.listResults).toEqual(["a", "b"])
  })

  it("extract-field reads items when upstream is text-prompt → list", () => {
    const nodes = [textPrompt(), listConnected(), node("e", "extract-field", { field: "name", outputType: "list" })]
    const edges = [edge("e1", "tp", "l", "prompt", "in"), edge("e2", "l", "e", "list", "in")]
    const result = executeExtractField(nodes[2], edges, nodes, bootStates(nodes))
    expect(result.listResults).toEqual(["a", "b"])
  })

  it("preserves manual rows when list has rows AND a connected upstream (manual wins, matches UI)", () => {
    // Note: this mirrors the frontend list-node UI which renders connectedItems
    // when an incoming edge exists. We keep simple semantics server-side:
    // if rows are populated, use them; only fall through to the connection
    // when rows are empty. That's enough to fix the reported bug without
    // changing existing behavior for mixed lists.
    const list = node("l", "list", {
      columns: [{ id: "c1", name: "Col", handleId: "col1", type: "text" }],
      rows: [["manual"]],
    })
    const nodes = [textPrompt(), list, node("f", "filter-list", { conditions: [], conditionLogic: "AND" })]
    const edges = [edge("e1", "tp", "l", "prompt", "in"), edge("e2", "l", "f", "list", "in")]
    const result = executeFilterList(nodes[2], edges, nodes, bootStates(nodes))
    expect(result.listResults).toEqual(["manual"])
  })

  it("chained lists in connected mode propagate through", () => {
    const list1 = node("l1", "list", {
      columns: [{ id: "c1", name: "Col", handleId: "col1", type: "text" }],
      rows: [],
    })
    const list2 = node("l2", "list", {
      columns: [{ id: "c1", name: "Col", handleId: "col1", type: "text" }],
      rows: [],
    })
    const nodes = [textPrompt(), list1, list2, node("f", "filter-list", { conditions: [], conditionLogic: "AND" })]
    const edges = [
      edge("e1", "tp", "l1", "prompt", "in"),
      edge("e2", "l1", "l2", "list", "in"),
      edge("e3", "l2", "f", "list", "in"),
    ]
    const result = executeFilterList(nodes[3], edges, nodes, bootStates(nodes))
    expect(result.listResults).toEqual(['{"name":"a"}', '{"name":"b"}'])
  })

  it("does not infinite-loop when a list cycles into itself (self-cycle guard)", () => {
    const list = listConnected()
    const nodes = [list, node("f", "filter-list", { conditions: [], conditionLogic: "AND" })]
    // Pathological: list.in ← list.list (won't happen in real UI but must not hang)
    const edges = [edge("cycle", "l", "l", "list", "in"), edge("e2", "l", "f", "list", "in")]
    const result = executeFilterList(nodes[1], edges, nodes, bootStates(nodes))
    // Returns empty — no items resolvable. Just must not hang.
    expect(result.listResults).toEqual([])
  })
})
