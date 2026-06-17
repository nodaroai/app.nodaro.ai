import { describe, it, expect } from "vitest"
import {
  buildWorkflowDelta,
  applyDeltaToGraph,
  findContestedNodes,
  deepEqual,
  equalIgnoringTransient,
  mergeNodePreservingResults,
} from "../workflow-delta"
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

  it("ignores result-only divergence (Layer C — results merge, not conflict)", () => {
    const a = node("a", { prompt: "p" })
    const snapshot = { nodes: [a], edges: [] as WorkflowEdge[] }
    const localA = { ...a, data: { ...a.data, prompt: "p" } } // config unchanged
    // remote a changed ONLY in results
    const remoteA = { ...a, data: { ...a.data, generatedResults: [{ url: "r", jobId: "j", timestamp: "t" }] } }
    const contested = findContestedNodes({ upsertNodes: [localA] }, snapshot, { nodes: [remoteA], edges: [] })
    expect(contested.map((n) => n.id)).toEqual([]) // result-only → not contested
  })
})

describe("delta merge helpers", () => {
  it("deepEqual: order-insensitive object keys, order-sensitive arrays", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
    expect(deepEqual({ a: { x: [1, { y: 2 }] } }, { a: { x: [1, { y: 2 }] } })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })

  it("equalIgnoringTransient: ignores transient run-state, not results", () => {
    const base = node("n1", { prompt: "p", generatedResults: [{ url: "u", jobId: "j", timestamp: "t" }] })
    const transientOnly = { ...base, data: { ...base.data, executionStatus: "running", currentJobId: "abc" } }
    expect(equalIgnoringTransient(transientOnly, base)).toBe(true)
    const resultChanged = { ...base, data: { ...base.data, generatedResults: [] } }
    expect(equalIgnoringTransient(resultChanged, base)).toBe(false)
    const promptChanged = { ...base, data: { ...base.data, prompt: "q" } }
    expect(equalIgnoringTransient(promptChanged, base)).toBe(false)
  })

  it("mergeNodePreservingResults: local config wins; results union newest-first; active follows url", () => {
    const remote = node("n1", { prompt: "old", generatedResults: [{ url: "r", jobId: "jr", timestamp: "2026-01-01T00:00:02Z" }] })
    const local = node("n1", { prompt: "new", generatedResults: [{ url: "l", jobId: "jl", timestamp: "2026-01-01T00:00:01Z" }], activeResultIndex: 0 })
    const merged = mergeNodePreservingResults(remote, local)
    const d = merged.data as Record<string, unknown>
    expect(d.prompt).toBe("new")
    expect((d.generatedResults as { url: string }[]).map((r) => r.url)).toEqual(["r", "l"])
    expect(d.activeResultIndex).toBe(1)
  })

  it("mergeNodePreservingResults: empty local results never wipe remote results", () => {
    const remote = node("n1", { generatedResults: [{ url: "r1", jobId: "j1", timestamp: "t2" }, { url: "r2", jobId: "j2", timestamp: "t1" }] })
    const local = node("n1", { generatedResults: [], activeResultIndex: 0 })
    const merged = mergeNodePreservingResults(remote, local)
    expect((merged.data as { generatedResults: unknown[] }).generatedResults.length).toBe(2)
  })

  it("mergeNodePreservingResults: same url dedupes to one", () => {
    const remote = node("n1", { generatedResults: [{ url: "same", jobId: "jr", timestamp: "t1" }] })
    const local = node("n1", { generatedResults: [{ url: "same", jobId: "jl", timestamp: "t2" }], activeResultIndex: 0 })
    const merged = mergeNodePreservingResults(remote, local)
    expect((merged.data as { generatedResults: unknown[] }).generatedResults.length).toBe(1)
  })
})

describe("buildWorkflowDelta — content-diff ignores transient-only", () => {
  it("excludes a node changed only in transient run-state; includes result + config changes", () => {
    const a = node("a", { prompt: "p", generatedResults: [{ url: "u", jobId: "j", timestamp: "t" }] })
    const b = node("b", { prompt: "p" })
    const snapshot = { nodes: [a, b], edges: [] as WorkflowEdge[] }
    // a: transient-only change (executionStatus) → must NOT upsert
    const aTransient = { ...a, data: { ...a.data, executionStatus: "running" } }
    // b: real result addition → must upsert
    const bResult = { ...b, data: { ...b.data, generatedResults: [{ url: "v", jobId: "k", timestamp: "t" }] } }
    const delta = buildWorkflowDelta({ nodes: [aTransient, bResult], edges: [] }, snapshot)
    expect(delta.upsertNodes.map((n) => n.id)).toEqual(["b"])
  })
})

describe("applyDeltaToGraph — result-preserving rebase (incident replay)", () => {
  it("a stale local node (0 results + transient churn) does not wipe the fresh remote's results", () => {
    const remoteResults = Array.from({ length: 13 }, (_, i) => ({ url: `r${i}`, jobId: `j${i}`, timestamp: `t${String(i).padStart(2, "0")}` }))
    const remoteNode = node("n1", { prompt: "p", generatedResults: remoteResults })
    const base = { nodes: [remoteNode], edges: [] as WorkflowEdge[] }
    // local upsert: same node, stale (no results), transient executionStatus churned
    const localStale = node("n1", { prompt: "p", generatedResults: [], activeResultIndex: 0, executionStatus: "idle" })
    const merged = applyDeltaToGraph(base, { upsertNodes: [localStale], deleteNodeIds: [], upsertEdges: [], deleteEdgeIds: [] })
    expect((merged.nodes[0].data as { generatedResults: unknown[] }).generatedResults.length).toBe(13)
  })
})
