import { describe, it, expect, beforeEach, vi } from "vitest"

// Delegate to real @xyflow/react (same rationale as the add-picker suite).
vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react")
  return actual
})

vi.mock("@/lib/parameter-node-prefs", () => ({
  getStickyParameterDisplayMode: vi.fn(() => "picks"),
  setStickyParameterDisplayMode: vi.fn(),
}))

vi.mock("@/components/editor/workflow-editor/auto-execute", () => ({
  autoExecuteNode: vi.fn(),
  cascadeAutoExecute: vi.fn(),
}))

import { useWorkflowStore } from "../use-workflow-store"

const initialState = useWorkflowStore.getState()

beforeEach(() => {
  useWorkflowStore.setState(initialState, true)
})

function rectOf(id: string) {
  const n = useWorkflowStore.getState().nodes.find((node) => node.id === id)!
  return {
    x: n.position.x,
    y: n.position.y,
    width: n.measured?.width ?? n.width ?? 280,
    height: n.measured?.height ?? n.height ?? 200,
  }
}

function overlaps(a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

describe("addNode placement + focus", () => {
  it("keeps the requested position when the canvas is empty, and focuses the node", () => {
    const id = useWorkflowStore.getState().addNode("text-prompt", { x: 120, y: 130 })!
    const s = useWorkflowStore.getState()
    const node = s.nodes.find((n) => n.id === id)!
    expect(node.position).toEqual({ x: 120, y: 130 })
    expect(node.selected).toBe(true)
    expect(s.focusedNodeId).toBe(id)
    // Focus must NOT open the config sidebar.
    expect(s.selectedNodeId).toBeNull()
  })

  it("nudges the new node off an existing one (no overlap)", () => {
    const a = useWorkflowStore.getState().addNode("text-prompt", { x: 100, y: 100 })!
    const b = useWorkflowStore.getState().addNode("generate-image", { x: 110, y: 110 })!
    const rectA = rectOf(a)
    const rectB = rectOf(b)
    expect(rectB.x === 110 && rectB.y === 110).toBe(false)
    expect(overlaps(rectA, rectB)).toBe(false)
  })

  it("deselects previously selected nodes when a new one is created", () => {
    const a = useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })!
    expect(useWorkflowStore.getState().nodes.find((n) => n.id === a)?.selected).toBe(true)
    const b = useWorkflowStore.getState().addNode("text-prompt", { x: 600, y: 0 })!
    const s = useWorkflowStore.getState()
    expect(s.nodes.find((n) => n.id === a)?.selected).toBe(false)
    expect(s.nodes.find((n) => n.id === b)?.selected).toBe(true)
    expect(s.focusedNodeId).toBe(b)
  })

  it("notifies the registered onNodeCreated handler (canvas centers the viewport)", () => {
    const handler = vi.fn()
    useWorkflowStore.getState().setOnNodeCreated(handler)
    const id = useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })!
    expect(handler).toHaveBeenCalledWith(id)
  })

  it("sticky notes keep the exact position, no focus, no handler call", () => {
    const handler = vi.fn()
    useWorkflowStore.getState().setOnNodeCreated(handler)
    const other = useWorkflowStore.getState().addNode("text-prompt", { x: 100, y: 100 })!
    handler.mockClear()
    const id = useWorkflowStore.getState().addNode("sticky-note", { x: 110, y: 110 })!
    const s = useWorkflowStore.getState()
    const sticky = s.nodes.find((n) => n.id === id)!
    expect(sticky.position).toEqual({ x: 110, y: 110 })
    expect(sticky.selected).not.toBe(true)
    expect(handler).not.toHaveBeenCalled()
    // The text-prompt node keeps its focus state from its own creation.
    expect(s.focusedNodeId).toBe(other)
  })

  it("ignores hidden nodes and sticky notes as obstacles", () => {
    const sticky = useWorkflowStore.getState().addNode("sticky-note", { x: 100, y: 100 })!
    expect(sticky).toBeDefined()
    const id = useWorkflowStore.getState().addNode("text-prompt", { x: 110, y: 110 })!
    // Sticky underneath is not an obstacle — position stays as requested.
    expect(useWorkflowStore.getState().nodes.find((n) => n.id === id)!.position).toEqual({ x: 110, y: 110 })
  })
})
