import { describe, it, expect } from "vitest"
import { TRANSIENT_RUNTIME_KEYS } from "@nodaro/shared"
import { sameReviewGraph, stableReviewGraph, upstreamClosure, type ReviewGraph } from "../review-graph"

const edges = [
  { source: "tr", target: "plan" },
  { source: "plan", target: "cut" },
  { source: "cut", target: "after" },
]
const graph = (data: Record<string, Record<string, unknown>> = {}): ReviewGraph => ({
  nodes: ["tr", "plan", "cut", "after", "beside"].map((id) => ({ id, type: id, data: { v: 1, ...data[id] } })),
  edges,
})

describe("the canvas a review reads", () => {
  it("is the render and everything upstream of it", () => {
    expect([...upstreamClosure("cut", edges)].sort()).toEqual(["cut", "plan", "tr"])
  })

  it("ignores run state, and every node downstream of or beside the render", () => {
    const before = graph()
    expect(sameReviewGraph(before, graph({ cut: { executionStatus: "running", currentJobProgress: 34 } }), "cut")).toBe(true)
    expect(sameReviewGraph(before, graph({ tr: { currentJobId: "j" } }), "cut")).toBe(true)
    expect(sameReviewGraph(before, graph({ after: { v: 2 } }), "cut")).toBe(true)
    expect(sameReviewGraph(before, graph({ beside: { v: 2 } }), "cut")).toBe(true)
  })

  it("sees any saved value upstream change, a node's type change, a node removed, and any edge change", () => {
    const before = graph()
    expect(sameReviewGraph(before, graph({ plan: { editedEdl: { v: 1 } } }), "cut")).toBe(false)
    expect(sameReviewGraph(before, graph({ tr: { v: 2 } }), "cut")).toBe(false)
    const retyped = graph()
    expect(sameReviewGraph(before, { ...retyped, nodes: retyped.nodes.map((n) => (n.id === "plan" ? { ...n, type: "x" } : n)) }, "cut")).toBe(false)
    expect(sameReviewGraph(before, { ...before, nodes: before.nodes.filter((n) => n.id !== "tr") }, "cut")).toBe(false)
    expect(sameReviewGraph(before, { ...before, edges: [...edges] }, "cut")).toBe(false)
  })

  it("skips the keys a caller names on a node", () => {
    const ignoreEdit = (id: string) => (id === "plan" ? new Set([...TRANSIENT_RUNTIME_KEYS, "editedEdl"]) : TRANSIENT_RUNTIME_KEYS)
    expect(sameReviewGraph(graph(), graph({ plan: { editedEdl: { v: 1 } } }), "cut", ignoreEdit)).toBe(true)
    expect(sameReviewGraph(graph(), graph({ cut: { editedEdl: { v: 1 } } }), "cut", ignoreEdit)).toBe(false)
  })

  it("the cache hands back the snapshot it holds until the review's inputs change", () => {
    const cache = { current: null as ReviewGraph | null }
    const first = graph()
    expect(stableReviewGraph(cache, first, "cut")).toBe(first)
    expect(stableReviewGraph(cache, graph({ cut: { executionStatus: "pending" } }), "cut")).toBe(first)
    const edited = graph({ cut: { crossfadeMs: 300 } })
    expect(stableReviewGraph(cache, edited, "cut")).toBe(edited)
  })
})
