import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"

// Mock @xyflow/react before importing stores
vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((changes, nodes) => {
    const removeIds = changes
      .filter((c: { type: string }) => c.type === "remove")
      .map((c: { id: string }) => c.id)
    if (removeIds.length > 0) {
      return nodes.filter((n: { id: string }) => !removeIds.includes(n.id))
    }
    return nodes.map((n: { id: string; position?: { x: number; y: number } }) => {
      const posChange = changes.find(
        (c: { type: string; id: string }) => c.type === "position" && c.id === n.id
      )
      if (posChange) {
        return { ...n, position: (posChange as { position: { x: number; y: number } }).position }
      }
      return n
    })
  }),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [
    ...edges,
    { ...connection, id: connection.id ?? `edge_mock` },
  ]),
}))

import { useWorkflowStore } from "../use-workflow-store"
import { useUndoRedoStore, type WorkflowSnapshot } from "../use-undo-redo-store"
import { isSkipUndoCapture } from "../undo-flags"

/**
 * Replicate the subscription logic from use-undo-redo.ts without React hooks.
 * This lets us test the core logic directly.
 */
function setupUndoSubscription() {
  let _isRestoring = false
  let _pendingSnapshot: WorkflowSnapshot | null = null
  let _debounceTimer: ReturnType<typeof setTimeout> | null = null
  let prevGeneration = useWorkflowStore.getState().loadGeneration

  function cleanNodes(nodes: Array<Record<string, unknown>>) {
    return nodes.map(({ selected, dragging, measured, ...rest }) => rest)
  }
  function cleanEdges(edges: Array<Record<string, unknown>>) {
    return edges.map(({ selected, ...rest }) => rest)
  }
  function captureSnapshot(): WorkflowSnapshot {
    const s = useWorkflowStore.getState()
    return {
      nodes: cleanNodes(s.nodes as unknown as Array<Record<string, unknown>>),
      edges: cleanEdges(s.edges as unknown as Array<Record<string, unknown>>),
      characterDefinitions: s.characterDefinitions,
      flowPromptTemplates: s.flowPromptTemplates,
      workflowName: s.workflowName,
    } as WorkflowSnapshot
  }

  function flushPending() {
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null }
    if (_pendingSnapshot) {
      useUndoRedoStore.getState().pushSnapshot(_pendingSnapshot)
      _pendingSnapshot = null
    }
  }

  const unsub = useWorkflowStore.subscribe((state, prevState) => {
    if (_isRestoring) return
    if (isSkipUndoCapture()) return

    if (state.loadGeneration !== prevGeneration) {
      flushPending()
      useUndoRedoStore.getState().clear()
      prevGeneration = state.loadGeneration
      return
    }

    // Skip if no snapshot-relevant content actually changed
    if (
      prevState.workflowName === state.workflowName &&
      prevState.characterDefinitions === state.characterDefinitions &&
      prevState.flowPromptTemplates === state.flowPromptTemplates &&
      prevState.edges === state.edges &&
      (() => {
        const pn = prevState.nodes, cn = state.nodes
        if (pn === cn) return true
        if (pn.length !== cn.length) return false
        for (let i = 0; i < pn.length; i++) {
          if (pn[i].id !== cn[i].id || pn[i].type !== cn[i].type || pn[i].position !== cn[i].position || pn[i].data !== cn[i].data) return false
        }
        return true
      })()
    ) return

    if (!_pendingSnapshot) {
      _pendingSnapshot = {
        nodes: cleanNodes(prevState.nodes as unknown as Array<Record<string, unknown>>),
        edges: cleanEdges(prevState.edges as unknown as Array<Record<string, unknown>>),
        characterDefinitions: prevState.characterDefinitions,
        flowPromptTemplates: prevState.flowPromptTemplates,
        workflowName: prevState.workflowName,
      } as WorkflowSnapshot
    }

    if (_debounceTimer) clearTimeout(_debounceTimer)
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null
      if (_pendingSnapshot) {
        useUndoRedoStore.getState().pushSnapshot(_pendingSnapshot)
        _pendingSnapshot = null
      }
    }, 300)
  })

  return {
    unsub,
    undo() {
      flushPending()
      const current = captureSnapshot()
      const snapshot = useUndoRedoStore.getState().undo(current)
      if (!snapshot) return false
      _isRestoring = true
      try {
        useWorkflowStore.getState().restoreSnapshot(snapshot)
      } finally {
        _isRestoring = false
      }
      return true
    },
    redo() {
      flushPending()
      const current = captureSnapshot()
      const snapshot = useUndoRedoStore.getState().redo(current)
      if (!snapshot) return false
      _isRestoring = true
      try {
        useWorkflowStore.getState().restoreSnapshot(snapshot)
      } finally {
        _isRestoring = false
      }
      return true
    },
    get canUndo() { return useUndoRedoStore.getState().past.length > 0 },
    get canRedo() { return useUndoRedoStore.getState().future.length > 0 },
    get pastLength() { return useUndoRedoStore.getState().past.length },
    get futureLength() { return useUndoRedoStore.getState().future.length },
  }
}

describe("Undo/Redo System", () => {
  let sub: ReturnType<typeof setupUndoSubscription>

  beforeEach(() => {
    vi.useFakeTimers()
    // Reset stores
    useWorkflowStore.getState().clearWorkflow()
    useUndoRedoStore.getState().clear()
    // Load a workflow so loadGeneration is set and isDirty is false
    useWorkflowStore.getState().loadWorkflow("wf1", "Test", [], [], [], {})
    sub = setupUndoSubscription()
  })

  afterEach(() => {
    sub.unsub()
    vi.useRealTimers()
  })

  it("should capture snapshot when node is added", () => {
    expect(sub.canUndo).toBe(false)

    useWorkflowStore.getState().addNode("generate-image", { x: 0, y: 0 })

    // Snapshot is pending (300ms debounce)
    expect(sub.canUndo).toBe(false)

    // Advance past debounce
    vi.advanceTimersByTime(301)

    expect(sub.canUndo).toBe(true)
    expect(sub.pastLength).toBe(1)
  })

  it("should undo an added node", () => {
    useWorkflowStore.getState().addNode("generate-image", { x: 0, y: 0 })
    vi.advanceTimersByTime(301)

    expect(useWorkflowStore.getState().nodes.length).toBe(1)
    expect(sub.canUndo).toBe(true)

    const result = sub.undo()
    expect(result).toBe(true)
    expect(useWorkflowStore.getState().nodes.length).toBe(0)
  })

  it("should redo after undo", () => {
    useWorkflowStore.getState().addNode("generate-image", { x: 0, y: 0 })
    vi.advanceTimersByTime(301)

    sub.undo()
    expect(useWorkflowStore.getState().nodes.length).toBe(0)
    expect(sub.canRedo).toBe(true)

    const result = sub.redo()
    expect(result).toBe(true)
    expect(useWorkflowStore.getState().nodes.length).toBe(1)
  })

  it("should not capture snapshots for execution-only updates", () => {
    useWorkflowStore.getState().addNode("generate-image", { x: 0, y: 0 })
    vi.advanceTimersByTime(301)

    expect(sub.pastLength).toBe(1)

    const nodeId = useWorkflowStore.getState().nodes[0].id
    useWorkflowStore.getState().updateNodeData(nodeId, {
      executionStatus: "running",
      currentJobProgress: 50,
    })
    vi.advanceTimersByTime(301)

    // Should still be 1 snapshot, not 2
    expect(sub.pastLength).toBe(1)
  })

  it("should capture snapshot for non-execution updates", () => {
    useWorkflowStore.getState().addNode("generate-image", { x: 0, y: 0 })
    vi.advanceTimersByTime(301)

    expect(sub.pastLength).toBe(1)

    const nodeId = useWorkflowStore.getState().nodes[0].id
    useWorkflowStore.getState().updateNodeData(nodeId, {
      prompt: "a cat",
    })
    vi.advanceTimersByTime(301)

    expect(sub.pastLength).toBe(2)
  })

  it("should capture snapshot after markClean + new change", () => {
    useWorkflowStore.getState().addNode("generate-image", { x: 0, y: 0 })
    vi.advanceTimersByTime(301)

    expect(sub.pastLength).toBe(1)

    // Simulate save
    useWorkflowStore.getState().markClean()
    expect(useWorkflowStore.getState().isDirty).toBe(false)

    // Make another change
    useWorkflowStore.getState().setWorkflowName("New Name")
    vi.advanceTimersByTime(301)

    expect(sub.pastLength).toBe(2)
    expect(sub.canUndo).toBe(true)
  })

  it("should handle multiple undo/redo operations", () => {
    // Action 1: add node
    useWorkflowStore.getState().addNode("generate-image", { x: 0, y: 0 })
    vi.advanceTimersByTime(301)

    // Action 2: rename
    useWorkflowStore.getState().setWorkflowName("Renamed")
    vi.advanceTimersByTime(301)

    expect(sub.pastLength).toBe(2)
    expect(useWorkflowStore.getState().workflowName).toBe("Renamed")

    // Undo rename
    sub.undo()
    expect(useWorkflowStore.getState().workflowName).toBe("Test")
    expect(useWorkflowStore.getState().nodes.length).toBe(1)

    // Undo add node
    sub.undo()
    expect(useWorkflowStore.getState().nodes.length).toBe(0)

    // Redo add node
    sub.redo()
    expect(useWorkflowStore.getState().nodes.length).toBe(1)

    // Redo rename
    sub.redo()
    expect(useWorkflowStore.getState().workflowName).toBe("Renamed")
  })

  it("should debounce rapid changes into one snapshot", () => {
    useWorkflowStore.getState().setWorkflowName("A")
    useWorkflowStore.getState().setWorkflowName("B")
    useWorkflowStore.getState().setWorkflowName("C")
    vi.advanceTimersByTime(301)

    // Should be ONE snapshot (the state before "A")
    expect(sub.pastLength).toBe(1)

    // Undo should go back to initial "Test"
    sub.undo()
    expect(useWorkflowStore.getState().workflowName).toBe("Test")
  })

  it("should clear history on workflow load", () => {
    useWorkflowStore.getState().addNode("generate-image", { x: 0, y: 0 })
    vi.advanceTimersByTime(301)
    expect(sub.pastLength).toBe(1)

    // Load new workflow
    useWorkflowStore.getState().loadWorkflow("wf2", "Other", [], [], [], {})

    expect(sub.pastLength).toBe(0)
    expect(sub.canUndo).toBe(false)
  })

  it("should not capture snapshots for dimension re-measurements after undo", () => {
    // 1. Add a node
    useWorkflowStore.getState().addNode("generate-image", { x: 0, y: 0 })
    vi.advanceTimersByTime(301)
    expect(sub.pastLength).toBe(1)

    // 2. Undo the add
    sub.undo()
    expect(useWorkflowStore.getState().nodes.length).toBe(0)
    expect(sub.canRedo).toBe(true)
    expect(sub.futureLength).toBe(1)

    // 3. Simulate React Flow dimension re-measurement after undo.
    //    restoreSnapshot sets isDirty: true. Then React Flow sends dimension
    //    changes which create new node objects but don't change positions/data.
    //    In the real app, this happens via onNodesChange with type="dimensions".
    //    Here we simulate it by directly setting nodes with only measured changed.
    //
    //    Since our undo restored to 0 nodes, there's nothing to re-measure.
    //    Let's test with a workflow that HAS nodes.

    // Reset and test with a 2-node workflow
    sub.unsub()
    useWorkflowStore.getState().clearWorkflow()
    useUndoRedoStore.getState().clear()
    useWorkflowStore.getState().loadWorkflow("wf1", "Test", [
      { id: "node_1", type: "generate-image", position: { x: 0, y: 0 }, data: { provider: "test" } },
      { id: "node_2", type: "generate-image", position: { x: 200, y: 0 }, data: { provider: "test2" } },
    ] as any, [], [], {})
    sub = setupUndoSubscription()

    // User renames workflow
    useWorkflowStore.getState().setWorkflowName("Renamed")
    vi.advanceTimersByTime(301)
    expect(sub.pastLength).toBe(1)
    expect(useWorkflowStore.getState().workflowName).toBe("Renamed")

    // User undoes rename
    sub.undo()
    expect(useWorkflowStore.getState().workflowName).toBe("Test")
    expect(sub.canRedo).toBe(true)
    const futureBeforeDimensions = sub.futureLength

    // NOW: simulate dimension re-measurement.
    // restoreSnapshot set isDirty: true. React Flow re-measures nodes.
    // onNodesChange creates new node objects with 'measured' field added.
    // The position and data refs stay the same (spread copy).
    const currentNodes = useWorkflowStore.getState().nodes
    const measuredNodes = currentNodes.map(n => ({
      ...n,
      measured: { width: 200, height: 100 },
    }))
    // Directly set nodes as onNodesChange would (without setting isDirty for dimensions)
    useWorkflowStore.setState({ nodes: measuredNodes as any })
    vi.advanceTimersByTime(301)

    // THE BUG: redo stack should NOT be cleared by dimension changes
    expect(sub.futureLength).toBe(futureBeforeDimensions)
    expect(sub.canRedo).toBe(true)

    // Redo should still work
    const redoResult = sub.redo()
    expect(redoResult).toBe(true)
    expect(useWorkflowStore.getState().workflowName).toBe("Renamed")
  })
})
