import { describe, it, expect } from "vitest"
import { buildWorkflowDelta, applyDeltaToGraph, findContestedNodes } from "../workflow-delta"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

function node(id: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type: "text-prompt", position: { x: 0, y: 0 }, data: { label: id, ...data } } as WorkflowNode
}
function edge(id: string, source = "a", target = "b"): WorkflowEdge {
  return { id, source, target } as WorkflowEdge
}

describe("buildWorkflowDelta — reference diffing", () => {
  it("unchanged references produce an empty delta", () => {
    const nodes = [node("a"), node("b")]
    const edges = [edge("e1")]
    const delta = buildWorkflowDelta({ nodes, edges }, { nodes, edges })
    expect(delta.isEmpty).toBe(true)
    expect(delta.nodeChangeRatio).toBe(0)
  })

  it("a replaced node object is an upsert; a missing one is a delete", () => {
    const a = node("a")
    const b = node("b")
    const snapshot = { nodes: [a, b], edges: [] as WorkflowEdge[] }
    const aEdited = { ...a, data: { ...a.data, prompt: "new" } }
    const delta = buildWorkflowDelta({ nodes: [aEdited], edges: [] }, snapshot)
    expect(delta.upsertNodes).toEqual([aEdited])
    expect(delta.deleteNodeIds).toEqual(["b"])
    expect(delta.nodeChangeRatio).toBe(1) // 2 changes / max(1,2)
  })

  it("new ids are upserts; edges diff independently", () => {
    const a = node("a")
    const e1 = edge("e1")
    const snapshot = { nodes: [a], edges: [e1] }
    const c = node("c")
    const e2 = edge("e2")
    const delta = buildWorkflowDelta({ nodes: [a, c], edges: [e2] }, snapshot)
    expect(delta.upsertNodes).toEqual([c])
    expect(delta.deleteNodeIds).toEqual([])
    expect(delta.upsertEdges).toEqual([e2])
    expect(delta.deleteEdgeIds).toEqual(["e1"])
    expect(delta.nodeChangeRatio).toBe(0.5)
  })
})

describe("applyDeltaToGraph — rebase merge", () => {
  it("replaces in place, appends new at the end, drops deletions", () => {
    const base = { nodes: [node("a"), node("b"), node("c")], edges: [edge("e1")] }
    const bEdited = node("b", { prompt: "edited" })
    const fresh = node("d")
    const merged = applyDeltaToGraph(base, {
      upsertNodes: [bEdited, fresh],
      deleteNodeIds: ["c"],
      upsertEdges: [],
      deleteEdgeIds: ["e1"],
    })
    expect(merged.nodes.map((n) => n.id)).toEqual(["a", "b", "d"])
    expect(merged.nodes[1]).toBe(bEdited)
    expect(merged.edges).toEqual([])
  })
})

describe("findContestedNodes — local-wins detection", () => {
  it("flags nodes changed on BOTH sides; ignores remote-unchanged and locally-new", () => {
    const a = node("a")
    const b = node("b")
    const snapshot = { nodes: [a, b], edges: [] as WorkflowEdge[] }
    const localA = { ...a, data: { ...a.data, prompt: "local" } }
    const localNew = node("z")
    // remote: a ALSO changed; b untouched (content-identical fresh copy)
    const remoteA = { ...a, data: { ...a.data, prompt: "remote" } }
    const freshB = JSON.parse(JSON.stringify(b)) as WorkflowNode
    const fresh = { nodes: [remoteA, freshB], edges: [] as WorkflowEdge[] }

    const contested = findContestedNodes(
      { upsertNodes: [localA, localNew] },
      snapshot,
      fresh,
    )
    expect(contested.map((n) => n.id)).toEqual(["a"])
  })
})
