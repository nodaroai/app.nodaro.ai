import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useEstimatedCredits } from "../use-estimated-credits"
import { useWorkflowStore } from "../use-workflow-store"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

vi.mock("../use-workflow-store", () => {
  const state = {
    nodes: [] as WorkflowNode[],
    edges: [] as WorkflowEdge[],
  }
  const store = ((selector: (s: typeof state) => unknown) => selector(state)) as unknown as typeof useWorkflowStore
  ;(store as unknown as { getState: () => typeof state }).getState = () => state
  ;(store as unknown as { __setState: (n: Partial<typeof state>) => void }).__setState = (n) => Object.assign(state, n)
  ;(store as unknown as { __reset: () => void }).__reset = () => { state.nodes = []; state.edges = [] }
  return { useWorkflowStore: store }
})

const __store = useWorkflowStore as unknown as {
  __setState: (n: { nodes?: WorkflowNode[]; edges?: WorkflowEdge[] }) => void
  __reset: () => void
}

beforeEach(() => __store.__reset())

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
}

function makeEdge(source: string, target: string, targetHandle: string): WorkflowEdge {
  return { id: `${source}->${target}:${targetHandle}`, source, target, targetHandle } as unknown as WorkflowEdge
}

/** Wires `count` distinct upstream nodes into the target's "video" handle. */
function wireVideoBlocks(targetId: string, count: number): WorkflowEdge[] {
  return Array.from({ length: count }, (_, i) => makeEdge(`u${i}`, targetId, "video"))
}

describe("useEstimatedCredits — assemble-narrated-video", () => {
  it("falls back to the 1-block floor (4cr) when nothing is wired", () => {
    const node = makeNode("t1", "assemble-narrated-video")
    __store.__setState({ nodes: [node], edges: [] })
    const { result } = renderHook(() => useEstimatedCredits(node))
    expect(result.current).toBe(4)
  })

  it("6 wired blocks → 4cr (3 + ceil(6/6))", () => {
    const node = makeNode("t1", "assemble-narrated-video")
    __store.__setState({ nodes: [node], edges: wireVideoBlocks("t1", 6) })
    const { result } = renderHook(() => useEstimatedCredits(node))
    expect(result.current).toBe(4)
  })

  it("24 wired blocks → 7cr (3 + ceil(24/6))", () => {
    const node = makeNode("t1", "assemble-narrated-video")
    __store.__setState({ nodes: [node], edges: wireVideoBlocks("t1", 24) })
    const { result } = renderHook(() => useEstimatedCredits(node))
    expect(result.current).toBe(7)
  })

  it("60 wired blocks (max) → 13cr (3 + ceil(60/6))", () => {
    const node = makeNode("t1", "assemble-narrated-video")
    __store.__setState({ nodes: [node], edges: wireVideoBlocks("t1", 60) })
    const { result } = renderHook(() => useEstimatedCredits(node))
    expect(result.current).toBe(13)
  })

  it("only counts edges wired into the 'video' handle, not 'audio'", () => {
    const node = makeNode("t1", "assemble-narrated-video")
    const edges = [
      ...wireVideoBlocks("t1", 6),
      makeEdge("a0", "t1", "audio"),
      makeEdge("a1", "t1", "audio"),
    ]
    __store.__setState({ nodes: [node], edges })
    const { result } = renderHook(() => useEstimatedCredits(node))
    expect(result.current).toBe(4)
  })

  it("ignores edges targeting a different node", () => {
    const node = makeNode("t1", "assemble-narrated-video")
    const other = makeNode("t2", "assemble-narrated-video")
    __store.__setState({
      nodes: [node, other],
      edges: [...wireVideoBlocks("t1", 6), ...wireVideoBlocks("t2", 60)],
    })
    const { result } = renderHook(() => useEstimatedCredits(node))
    expect(result.current).toBe(4)
  })
})

describe("useEstimatedCredits — unsupported node type", () => {
  it("returns 0 for a node type with no estimator case", () => {
    const node = makeNode("t1", "generate-image")
    __store.__setState({ nodes: [node], edges: [] })
    const { result } = renderHook(() => useEstimatedCredits(node))
    expect(result.current).toBe(0)
  })
})
