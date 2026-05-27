import { describe, it, expect, beforeEach, vi } from "vitest"

// Delegate to real @xyflow/react. The store relies on applyNodeChanges /
// applyEdgeChanges semantics (select/dimensions/position events apply
// correctly), so identity-stubbing them would silently mask any future test
// that drives the store via onNodesChange/onEdgesChange.
vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react")
  return actual
})

// Mock the parameter-node-prefs module directly. Targeting the store's
// dependency by module is more honest than reassigning globalThis.localStorage
// (which doesn't shadow window.localStorage in jsdom — addNode reads
// window.localStorage via getStickyParameterDisplayMode, bypassing any
// localStorage mock that only writes to globalThis).
vi.mock("@/lib/parameter-node-prefs", () => ({
  getStickyParameterDisplayMode: vi.fn(() => "picks"),
  setStickyParameterDisplayMode: vi.fn(),
}))

vi.mock("@/components/editor/workflow-editor/auto-execute", () => ({
  autoExecuteNode: vi.fn(),
  cascadeAutoExecute: vi.fn(),
}))

import { useWorkflowStore } from "../use-workflow-store"

// Snapshot the initial store state once so each test can fully restore it.
// Using `setState(initial, true)` (second arg `true` REPLACES rather than
// merges) avoids the partial-reset bug where addNode's `newNodeIds` Set
// accumulates across tests because Zustand's default setState merges.
const initialState = useWorkflowStore.getState()

beforeEach(() => {
  useWorkflowStore.setState(initialState, true)
})

describe("addNodeAndOpenPicker", () => {
  it("auto-selects and opens fullscreen for a tile-grid picker (camera-motion)", () => {
    const id = useWorkflowStore.getState().addNodeAndOpenPicker(
      "camera-motion",
      { x: 0, y: 0 },
    )
    expect(id).toBeDefined()
    const s = useWorkflowStore.getState()
    expect(s.selectedNodeId).toBe(id)
    expect(s.configPanelFullscreen).toBe(true)
    expect(s.nodes.find((n) => n.id === id)?.selected).toBe(true)
  })

  it("does NOT auto-open fullscreen for non-tile-grid pickers (text-prompt)", () => {
    // text-prompt IS in picker REGISTRY (for typed-handle compatibility) but
    // is explicitly listed in NON_TILE_GRID_PICKER_TYPES — its UI is a plain
    // textarea, not a tile grid. Auto-opening a 900px fullscreen modal for
    // a textarea would be jarring UX.
    const id = useWorkflowStore.getState().addNodeAndOpenPicker(
      "text-prompt",
      { x: 0, y: 0 },
    )
    expect(id).toBeDefined()
    const s = useWorkflowStore.getState()
    expect(s.configPanelFullscreen).toBe(false)
    expect(s.selectedNodeId).toBeNull()
  })

  it("does NOT auto-open fullscreen for non-picker nodes (generate-image)", () => {
    const id = useWorkflowStore.getState().addNodeAndOpenPicker(
      "generate-image",
      { x: 0, y: 0 },
    )
    expect(id).toBeDefined()
    const s = useWorkflowStore.getState()
    expect(s.configPanelFullscreen).toBe(false)
    expect(s.selectedNodeId).toBeNull()
  })

  it("returns undefined when the node type is unknown (delegates to addNode failure path)", () => {
    const id = useWorkflowStore.getState().addNodeAndOpenPicker(
      "not-a-real-type" as any,
      { x: 0, y: 0 },
    )
    expect(id).toBeUndefined()
    expect(useWorkflowStore.getState().configPanelFullscreen).toBe(false)
  })
})

describe("openPickerForNode (standalone — used by add-node-popup post-connect)", () => {
  it("selects + opens fullscreen for an existing tile-grid picker node", () => {
    const id = useWorkflowStore.getState().addNode("camera-motion", { x: 0, y: 0 })
    expect(id).toBeDefined()
    // Reset selection state so we're testing openPickerForNode in isolation.
    useWorkflowStore.setState({ selectedNodeId: null, configPanelFullscreen: false })

    useWorkflowStore.getState().openPickerForNode(id!, "camera-motion")

    const s = useWorkflowStore.getState()
    expect(s.selectedNodeId).toBe(id)
    expect(s.configPanelFullscreen).toBe(true)
  })

  it("no-ops for non-tile-grid picker types", () => {
    const id = useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
    expect(id).toBeDefined()
    useWorkflowStore.setState({ selectedNodeId: null, configPanelFullscreen: false })

    useWorkflowStore.getState().openPickerForNode(id!, "text-prompt")

    const s = useWorkflowStore.getState()
    expect(s.selectedNodeId).toBeNull()
    expect(s.configPanelFullscreen).toBe(false)
  })

  it("clears other selections when selecting (delegates to canonical selectNode)", () => {
    const idA = useWorkflowStore.getState().addNode("camera-motion", { x: 0, y: 0 })
    const idB = useWorkflowStore.getState().addNode("camera-motion", { x: 100, y: 0 })
    expect(idA).toBeDefined()
    expect(idB).toBeDefined()
    // Pre-select A explicitly so we can verify B's selection deselects A.
    useWorkflowStore.getState().selectNode(idA!)
    expect(useWorkflowStore.getState().nodes.find((n) => n.id === idA)?.selected).toBe(true)

    useWorkflowStore.getState().openPickerForNode(idB!, "camera-motion")

    const s = useWorkflowStore.getState()
    expect(s.selectedNodeId).toBe(idB)
    expect(s.nodes.find((n) => n.id === idB)?.selected).toBe(true)
    expect(s.nodes.find((n) => n.id === idA)?.selected).toBe(false)
  })

  it("selectNode early-out still clears other selections when target was already selected (programmatic multi-select recovery)", () => {
    // Regression: the fast path `if (target?.selected) return { selectedNodeId }`
    // used to leave OTHER selected nodes' `selected: true` flag intact —
    // fine when called from React Flow's onNodesChange (the batch already
    // deselected siblings), but wrong for programmatic callers where the
    // store state can have multi-select state that selectNode is expected
    // to collapse.
    const idA = useWorkflowStore.getState().addNode("camera-motion", { x: 0, y: 0 })
    const idB = useWorkflowStore.getState().addNode("camera-motion", { x: 100, y: 0 })
    expect(idA).toBeDefined()
    expect(idB).toBeDefined()
    // Simulate multi-select via direct state mutation (mirrors what a
    // shift-click would produce in React Flow): BOTH nodes selected,
    // selectedNodeId pointing at one of them.
    useWorkflowStore.setState((s) => ({
      selectedNodeId: idA,
      nodes: s.nodes.map((n) =>
        n.id === idA || n.id === idB ? { ...n, selected: true } : n,
      ),
    }))
    expect(useWorkflowStore.getState().nodes.find((n) => n.id === idA)?.selected).toBe(true)
    expect(useWorkflowStore.getState().nodes.find((n) => n.id === idB)?.selected).toBe(true)

    // Call selectNode on idB (which is ALREADY selected) — early-out branch.
    // Must still deselect idA per the canonical contract.
    useWorkflowStore.getState().selectNode(idB!)

    const s = useWorkflowStore.getState()
    expect(s.selectedNodeId).toBe(idB)
    expect(s.nodes.find((n) => n.id === idB)?.selected).toBe(true)
    expect(s.nodes.find((n) => n.id === idA)?.selected).toBe(false)
  })

  it("selectNode fast path still works when only the target is selected (no extra map walk)", () => {
    const id = useWorkflowStore.getState().addNode("camera-motion", { x: 0, y: 0 })
    expect(id).toBeDefined()
    useWorkflowStore.getState().selectNode(id!)
    const nodesRefBefore = useWorkflowStore.getState().nodes

    // Calling again on the already-selected sole target — should be a no-op
    // for the nodes array (reference equality preserved → no needless
    // re-renders of memoized node components).
    useWorkflowStore.getState().selectNode(id!)

    const s = useWorkflowStore.getState()
    expect(s.selectedNodeId).toBe(id)
    expect(s.nodes).toBe(nodesRefBefore)
  })
})
