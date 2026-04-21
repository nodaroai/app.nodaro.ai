/**
 * Tests for `resolveSourceThroughConnectedList` — the helper that follows a
 * list node's incoming `in` edge when the list has no manual rows, so
 * downstream readers see the list's connected upstream items (matching
 * the list UI's `connectedItems ?? staticItems` behavior).
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => "mock scene prompt"),
}))

import { resolveSourceThroughConnectedList } from "../node-input-resolver"

type N = { id: string; type?: string; data: Record<string, unknown> }
type E = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

const makeList = (id: string, rows: string[][] = []): N => ({
  id,
  type: "list",
  data: { columns: [{ id: "c1", name: "Col", handleId: "col1", type: "text" }], rows },
})
const makeTextPrompt = (id: string, text: string): N => ({ id, type: "text-prompt", data: { text } })
const makeEdge = (source: string, target: string, sourceHandle = "out", targetHandle = "in"): E => ({
  source,
  target,
  sourceHandle,
  targetHandle,
})

describe("resolveSourceThroughConnectedList", () => {
  it("follows through a list with no rows to its upstream", () => {
    const tp = makeTextPrompt("tp", "hello")
    const list = makeList("l")
    const filterE = makeEdge("l", "f", "list", "in")
    const edges: E[] = [makeEdge("tp", "l", "prompt", "in"), filterE]

    const resolved = resolveSourceThroughConnectedList(filterE, [tp, list], edges)
    expect(resolved.source).toBe("tp")
    expect(resolved.sourceHandle).toBe("prompt")
  })

  it("stops at a list that has manual rows", () => {
    const tp = makeTextPrompt("tp", "hello")
    const list = makeList("l", [["manual"]])
    const filterE = makeEdge("l", "f", "list", "in")
    const edges: E[] = [makeEdge("tp", "l", "prompt", "in"), filterE]

    const resolved = resolveSourceThroughConnectedList(filterE, [tp, list], edges)
    expect(resolved.source).toBe("l")
  })

  it("stops when the source is not a list", () => {
    const tp = makeTextPrompt("tp", "hello")
    const filterE = makeEdge("tp", "f", "prompt", "in")
    const resolved = resolveSourceThroughConnectedList(filterE, [tp], [filterE])
    expect(resolved.source).toBe("tp")
  })

  it("chains through multiple empty lists", () => {
    const tp = makeTextPrompt("tp", '[{"x":1}]')
    const l1 = makeList("l1")
    const l2 = makeList("l2")
    const filterE = makeEdge("l2", "f", "list", "in")
    const edges: E[] = [
      makeEdge("tp", "l1", "prompt", "in"),
      makeEdge("l1", "l2", "list", "in"),
      filterE,
    ]
    const resolved = resolveSourceThroughConnectedList(filterE, [tp, l1, l2], edges)
    expect(resolved.source).toBe("tp")
  })

  it("stays put when a list has no incoming edge (orphan)", () => {
    const list = makeList("l")
    const filterE = makeEdge("l", "f", "list", "in")
    const resolved = resolveSourceThroughConnectedList(filterE, [list], [filterE])
    expect(resolved.source).toBe("l")
  })

  it("short-circuits on self-cycle (does not hang)", () => {
    const list = makeList("l")
    const cycle = makeEdge("l", "l", "list", "in")
    const filterE = makeEdge("l", "f", "list", "in")
    const resolved = resolveSourceThroughConnectedList(filterE, [list], [cycle, filterE])
    // Resolves once (l → l via self-loop) then detects the revisit and stops.
    expect(resolved).toBeDefined()
  })

  it("treats a row of only whitespace as empty (same as the UI's trim filter)", () => {
    const tp = makeTextPrompt("tp", "hello")
    const list = makeList("l", [["   "], [""]])
    const filterE = makeEdge("l", "f", "list", "in")
    const edges: E[] = [makeEdge("tp", "l", "prompt", "in"), filterE]
    const resolved = resolveSourceThroughConnectedList(filterE, [tp, list], edges)
    expect(resolved.source).toBe("tp")
  })
})
