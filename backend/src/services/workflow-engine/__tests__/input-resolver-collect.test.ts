/**
 * Collect (FAN_IN) input-resolver tests.
 *
 * Collect nodes consume an upstream list (or a single upstream output wrapped
 * as a one-item list) as `inputs.inputs`. They are NOT fanned out — the
 * resolver passes the whole list to the strategy, which folds it into a
 * single value.
 */

import { describe, it, expect } from "vitest"
import { resolveNodeInputs, getListInputForNode } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(
  source: string,
  target: string,
  sourceHandle: string | null = null,
  targetHandle: string | null = null,
  data?: Record<string, unknown>,
): SimpleEdge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    data,
  }
}

describe("input-resolver: collect (FAN_IN)", () => {
  it("when target is collect, the upstream listResults are passed as inputs:string[] (not fanned out)", () => {
    const collectNode = node("C1", "collect", {
      strategyId: "concat",
      strategyConfig: { separator: "-" },
    })
    const listNode = node("L1", "list")
    const allNodes: SimpleNode[] = [listNode, collectNode]
    const edges: SimpleEdge[] = [edge("L1", "C1", "list", "in")]
    const states: Record<string, NodeExecutionState> = {
      L1: { status: "completed", output: { listResults: ["a", "b", "c"] } },
    }

    const inputs = resolveNodeInputs(collectNode, edges, states, allNodes)
    expect(inputs.inputs).toEqual(["a", "b", "c"])
  })

  it("wraps a single-result upstream into [output] for collect (no listResults)", () => {
    const upstreamGenImage = node("G1", "generate-image")
    const collectNode = node("C1", "collect", {
      strategyId: "concat",
      strategyConfig: { separator: "-" },
    })
    const allNodes: SimpleNode[] = [upstreamGenImage, collectNode]
    const edges: SimpleEdge[] = [edge("G1", "C1", "image", "in")]
    const states: Record<string, NodeExecutionState> = {
      G1: { status: "completed", output: { imageUrl: "https://example.com/x.jpg" } },
    }

    const inputs = resolveNodeInputs(collectNode, edges, states, allNodes)
    expect(inputs.inputs).toEqual(["https://example.com/x.jpg"])
  })

  it("returns inputs:[] when upstream has neither listResults nor output", () => {
    const upstreamGenImage = node("G1", "generate-image")
    const collectNode = node("C1", "collect", {
      strategyId: "concat",
      strategyConfig: { separator: "-" },
    })
    const allNodes: SimpleNode[] = [upstreamGenImage, collectNode]
    const edges: SimpleEdge[] = [edge("G1", "C1", "image", "in")]
    const states: Record<string, NodeExecutionState> = {}

    const inputs = resolveNodeInputs(collectNode, edges, states, allNodes)
    expect(inputs.inputs ?? []).toEqual([])
  })

  it("getListInputForNode returns undefined for collect targets (collect consumes lists, is not fanned out)", () => {
    const collectNode = node("C1", "collect", {
      strategyId: "concat",
      strategyConfig: { separator: "-" },
    })
    const listNode = node("L1", "list")
    const allNodes: SimpleNode[] = [listNode, collectNode]
    const edges: SimpleEdge[] = [edge("L1", "C1", "list", "in", { outputMode: "each" })]
    const states: Record<string, NodeExecutionState> = {
      L1: { status: "completed", output: { listResults: ["a", "b", "c"] } },
    }

    const result = getListInputForNode(collectNode, edges, states, allNodes)
    expect(result).toBeUndefined()
  })
})
