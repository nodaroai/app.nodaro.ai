import { describe, it, expect, beforeEach, vi } from "vitest"

// Mock @xyflow/react so applyNodeChanges actually applies `select` + `remove`
// changes (the real one does; the shared store-test mock only does remove).
vi.mock("@xyflow/react", () => ({
  applyNodeChanges: (changes: Array<{ type: string; id: string; selected?: boolean }>, nodes: Array<{ id: string; selected?: boolean }>) => {
    let result = nodes
    for (const c of changes) {
      if (c.type === "select") result = result.map((n) => (n.id === c.id ? { ...n, selected: c.selected } : n))
      else if (c.type === "remove") result = result.filter((n) => n.id !== c.id)
    }
    return result
  },
  applyEdgeChanges: (_c: unknown, edges: unknown) => edges,
  addEdge: (conn: Record<string, unknown>, edges: unknown[]) => [...edges, { ...conn, id: "e_mock" }],
}))

import { useWorkflowStore, focusPatch } from "../use-workflow-store"

type TestNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown>; selected?: boolean }
const node = (id: string, selected = false): TestNode => ({ id, type: "text-prompt", position: { x: 0, y: 0 }, data: {}, selected })

function reset(nodes: TestNode[]) {
  useWorkflowStore.setState({
    nodes: nodes as never,
    edges: [],
    selectedNodeId: null,
    focusedNodeId: null,
    previousFocusedNodeId: null,
    isReadOnly: false,
  })
}
const s = () => useWorkflowStore.getState()
const select = (id: string, selected: boolean) => ({ type: "select" as const, id, selected })

describe("focusPatch", () => {
  it("records the prior focus only when focus changes", () => {
    expect(focusPatch({ focusedNodeId: "a", previousFocusedNodeId: null }, "b")).toEqual({
      focusedNodeId: "b",
      previousFocusedNodeId: "a",
    })
  })
  it("keeps previous untouched when focus is unchanged", () => {
    expect(focusPatch({ focusedNodeId: "a", previousFocusedNodeId: "z" }, "a")).toEqual({
      focusedNodeId: "a",
      previousFocusedNodeId: "z",
    })
  })
})

describe("onNodesChange — focus stays synced to the canvas selection", () => {
  beforeEach(() => reset([node("a"), node("b"), node("c")]))

  it("syncs focusedNodeId to a newly selected node", () => {
    s().onNodesChange([select("a", true)])
    expect(s().focusedNodeId).toBe("a")
    expect(s().previousFocusedNodeId).toBeNull()
  })

  it("tracks the previous focus when selection moves A→B (enables Alt+B toggle)", () => {
    s().onNodesChange([select("a", true)])
    s().onNodesChange([select("a", false), select("b", true)])
    expect(s().focusedNodeId).toBe("b")
    expect(s().previousFocusedNodeId).toBe("a")
  })

  it("does NOT change focus on a multi-select (2 nodes selected)", () => {
    s().onNodesChange([select("a", true)])
    s().onNodesChange([select("b", true)]) // a + b now selected
    expect(s().focusedNodeId).toBe("a")
  })

  it("persists the last focus when selection clears to none", () => {
    s().onNodesChange([select("a", true)])
    s().onNodesChange([select("a", false)])
    expect(s().focusedNodeId).toBe("a")
  })
})
