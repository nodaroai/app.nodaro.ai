/**
 * Guard test — loop → list fan-out parity for MANUAL-mode multi-column nodes.
 *
 * Locks in a behavior that a code review feared might regress: when the legacy
 * `loop` node is normalized to the canonical `list` node, server-side fan-out
 * from a NON-first column must still read the CORRECT column (not always
 * column 0). The reviewer worried the `list` path read only column 0.
 *
 * That concern was verified FALSE: `getListInputForNode` (for `list` sources)
 * routes through `resolveListLoopColumnItems`, which derives `colIndex` from the
 * edge's `sourceHandle` (matching the column's `handleId`) and extracts
 * `rows.map((row) => row[colIndex])` — true column-indexed manual extraction.
 * The `list` branch is therefore a superset of the old `loop` branch.
 *
 * This test proves that end-to-end through the REAL resolver (no mocks/bypass):
 *   1. A manual `loop` node with two columns (`col_a`, `col_b`) survives
 *      `normalizeLegacyNodeTypes` as a `list` with columns/rows intact.
 *   2. Fanning out from the SECOND column (`col_b`) yields the second column's
 *      values (`["b1","b2"]`), NOT the first column's (`["a1","a2"]`).
 *   3. Fanning out from the FIRST column (`col_a`) yields `["a1","a2"]` — proving
 *      the routing is real column selection, not an accident.
 *
 * If anyone changes `resolveListLoopColumnItems` to read `row[0]` instead of
 * `row[colIndex]`, assertion (2) flips to `["a1","a2"]` and this test fails.
 */

import { describe, it, expect } from "vitest"
import { getListInputForNode } from "../input-resolver.js"
import { normalizeLegacyNodeTypes } from "../normalize-node-types.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
  data?: Record<string, unknown>,
): SimpleEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
    data,
  }
}

/** Build a MANUAL-mode loop node with two text columns and two rows. */
function twoColumnLoop(): SimpleNode {
  return node("table", "loop", {
    columns: [
      { id: "c_a", handleId: "col_a", name: "A", type: "text" },
      { id: "c_b", handleId: "col_b", name: "B", type: "text" },
    ],
    rows: [
      ["a1", "b1"],
      ["a2", "b2"],
    ],
  })
}

describe("loop → list fan-out parity (manual multi-column, non-first column)", () => {
  it("normalizeLegacyNodeTypes rewrites loop → list and keeps columns/rows intact", () => {
    const [normalized] = normalizeLegacyNodeTypes([twoColumnLoop()])
    expect(normalized.type).toBe("list")
    expect(normalized.data.columns).toEqual([
      { id: "c_a", handleId: "col_a", name: "A", type: "text" },
      { id: "c_b", handleId: "col_b", name: "B", type: "text" },
    ])
    expect(normalized.data.rows).toEqual([
      ["a1", "b1"],
      ["a2", "b2"],
    ])
  })

  it("fan-out from the SECOND column (col_b) returns the SECOND column, not the first", () => {
    // Normalize loop → list, exactly as the orchestrator does before reading node.type.
    const [listNode] = normalizeLegacyNodeTypes([twoColumnLoop()])
    expect(listNode.type).toBe("list")

    const consumer = node("gen", "generate-image")
    // Edge from the node's SECOND column source handle. loop/list default to
    // "each" fan-out, so an edge with no explicit outputMode fans out.
    const edges = [edge("table", "gen", "col_b", null)]
    const states: Record<string, NodeExecutionState> = {}

    // Exercises the REAL getListInputForNode → resolveListLoopColumnItems path
    // (the `list` branch at input-resolver.ts ~686). No mocks.
    const result = getListInputForNode(consumer, edges, states, [listNode], undefined)
    expect(result).toEqual(["b1", "b2"])
    // Explicitly NOT the first column — this is the exact regression the reviewer feared.
    expect(result).not.toEqual(["a1", "a2"])
  })

  it("fan-out from the FIRST column (col_a) returns the FIRST column (routing is real, not accidental)", () => {
    const [listNode] = normalizeLegacyNodeTypes([twoColumnLoop()])
    const consumer = node("gen", "generate-image")
    const edges = [edge("table", "gen", "col_a", null)]
    const result = getListInputForNode(consumer, edges, {}, [listNode], undefined)
    expect(result).toEqual(["a1", "a2"])
  })
})

/**
 * Guard test — the LEGACY GLOBAL `"in"` connected-mode handle survives loop → list.
 *
 * Old `loop` (Table) workflows could wire a single upstream into a bare `"in"`
 * target handle (connected mode); the node then split that upstream's output by
 * the column delimiter (default newline) and fanned out one execution per line.
 * The dedicated `loop` branch in `getListInputForNode` covered this (case b),
 * but the canonical `list` path (`resolveListLoopColumnItems`) originally did
 * NOT — it only checked per-column `${handleId}_in` edges and manual rows. That
 * meant normalizing such a legacy node loop → list would SILENTLY DROP the
 * connected-mode fan-out (a latent regression of the kind the unification task
 * explicitly hunts for).
 *
 * This test pins the ported capability: a one-column `loop` with a `"in"` edge
 * from a multi-line text-prompt, once normalized to `list`, fans out over each
 * line through the REAL resolver. If `resolveLegacyInHandleItems` is removed
 * from the list path, this flips to undefined (single scalar) and fails.
 */
describe("legacy global \"in\" connected-mode fan-out survives loop → list", () => {
  /** One-column loop node in CONNECTED mode via the legacy bare `"in"` handle. */
  function oneColumnLoop(): SimpleNode {
    return node("table", "loop", {
      columns: [{ id: "c_a", handleId: "col_a", name: "A", type: "text" }],
      rows: [],
    })
  }

  it("splits the `in` upstream by newline and fans out after normalization", () => {
    const [listNode] = normalizeLegacyNodeTypes([oneColumnLoop()])
    expect(listNode.type).toBe("list")

    // Multi-line text-prompt wired into the loop's legacy global "in" handle.
    const upstream = node("prompt", "text-prompt", { text: "x1\nx2\nx3" })
    const consumer = node("gen", "generate-image")
    const edges = [
      edge("prompt", "table", null, "in"), // legacy connected-mode edge
      edge("table", "gen", "col_a", null), // consumer reads the column source
    ]

    const result = getListInputForNode(consumer, edges, {}, [listNode, upstream], undefined)
    expect(result).toEqual(["x1", "x2", "x3"])
  })

  it("respects the `in` edge's own range selector (1-based inclusive)", () => {
    const [listNode] = normalizeLegacyNodeTypes([oneColumnLoop()])
    const upstream = node("prompt", "text-prompt", { text: "x1\nx2\nx3\nx4" })
    const consumer = node("gen", "generate-image")
    const edges = [
      // `in` edge selects items 2..3 (1-based inclusive range) → ["x2","x3"].
      // SelectorFields uses rangeFrom/rangeTo (string, 1-based) — see selector.ts.
      edge("prompt", "table", null, "in", { rangeFrom: "2", rangeTo: "3" }),
      edge("table", "gen", "col_a", null),
    ]

    const result = getListInputForNode(consumer, edges, {}, [listNode, upstream], undefined)
    expect(result).toEqual(["x2", "x3"])
  })
})
