import { describe, it, expect, beforeEach, vi } from "vitest"

// Mock @xyflow/react before importing the store
vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((changes, nodes) => {
    // Simplified: handle remove changes
    const removeIds = changes
      .filter((c: { type: string }) => c.type === "remove")
      .map((c: { id: string }) => c.id)
    if (removeIds.length > 0) {
      return nodes.filter((n: { id: string }) => !removeIds.includes(n.id))
    }
    return nodes
  }),
  applyEdgeChanges: vi.fn((changes, edges) => {
    const removeIds = changes
      .filter((c: { type: string }) => c.type === "remove")
      .map((c: { id: string }) => c.id)
    if (removeIds.length > 0) {
      return edges.filter((e: { id: string }) => !removeIds.includes(e.id))
    }
    return edges
  }),
  addEdge: vi.fn((connection, edges) => [
    ...edges,
    { ...connection, id: connection.id ?? `edge_mock` },
  ]),
}))

import { useWorkflowStore, EXECUTION_DATA_KEYS, buildDuplicatedNodeData } from "../use-workflow-store"
import * as undoFlags from "../undo-flags"

function resetStore() {
  useWorkflowStore.setState({
    workflowId: null,
    workflowName: "Untitled Workflow",
    nodes: [],
    edges: [],
    selectedNodeId: null,
    isDirty: false,
  })
}

describe("useWorkflowStore", () => {
  beforeEach(() => {
    resetStore()
  })

  describe("workflow metadata", () => {
    it("has correct initial state", () => {
      const state = useWorkflowStore.getState()
      expect(state.workflowId).toBeNull()
      expect(state.workflowName).toBe("Untitled Workflow")
      expect(state.nodes).toEqual([])
      expect(state.edges).toEqual([])
      expect(state.isDirty).toBe(false)
    })

    it("sets workflow name and marks dirty", () => {
      useWorkflowStore.getState().setWorkflowName("My Workflow")

      const state = useWorkflowStore.getState()
      expect(state.workflowName).toBe("My Workflow")
      expect(state.isDirty).toBe(true)
    })

    it("sets workflow id", () => {
      useWorkflowStore.getState().setWorkflowId("wf_123")
      expect(useWorkflowStore.getState().workflowId).toBe("wf_123")
    })
  })

  describe("addNode", () => {
    it("adds a text-prompt node", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 100, y: 200 })

      const state = useWorkflowStore.getState()
      expect(state.nodes).toHaveLength(1)
      expect(state.nodes[0].type).toBe("text-prompt")
      expect(state.nodes[0].position).toEqual({ x: 100, y: 200 })
      expect(state.nodes[0].data.label).toBe("Text Prompt")
      expect(state.isDirty).toBe(true)
    })

    it("adds a generate-image node with default data", () => {
      useWorkflowStore.getState().addNode("generate-image", { x: 0, y: 0 })

      const node = useWorkflowStore.getState().nodes[0]
      expect(node.data.label).toBe("Generate Image")
      expect((node.data as Record<string, unknown>).provider).toBe("nano-banana-pro")
    })

    it("does not add node for invalid type", () => {
      useWorkflowStore.getState().addNode("nonexistent" as never, { x: 0, y: 0 })
      expect(useWorkflowStore.getState().nodes).toHaveLength(0)
    })
  })

  describe("updateNodeData", () => {
    it("updates data on an existing node", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      const nodeId = useWorkflowStore.getState().nodes[0].id

      useWorkflowStore.getState().updateNodeData(nodeId, { text: "Hello world" })

      const updated = useWorkflowStore.getState().nodes[0]
      expect((updated.data as Record<string, unknown>).text).toBe("Hello world")
    })
  })

  describe("updateNodeWithData", () => {
    beforeEach(() => {
      useWorkflowStore.setState({
        nodes: [
          { id: "n1", type: "person", position: { x: 0, y: 0 }, data: { displayMode: "picks", zoom: 1 }, width: 200, height: 100 },
        ],
        edges: [],
        isDirty: false,
      } as unknown as Partial<ReturnType<typeof useWorkflowStore.getState>>)
    })

    it("merges node-level and data-level updates in one set()", () => {
      const renderCounts: number[] = []
      const unsub = useWorkflowStore.subscribe((s) => renderCounts.push(s.nodes[0].width!))

      useWorkflowStore.getState().updateNodeWithData("n1", { width: 300, height: 150 }, { zoom: 1.5 })

      const node = useWorkflowStore.getState().nodes[0]
      expect(node.width).toBe(300)
      expect(node.height).toBe(150)
      expect(node.data.zoom).toBe(1.5)
      expect(node.data.displayMode).toBe("picks") // existing data preserved
      expect(renderCounts.length).toBe(1) // single notification, not two
      unsub()
    })

    it("sets isDirty true so autosave runs", () => {
      useWorkflowStore.getState().updateNodeWithData("n1", { width: 300 }, { zoom: 1.5 })
      expect(useWorkflowStore.getState().isDirty).toBe(true)
    })

    it("calls setSkipUndoCapture(true) when all dataUpdates are in EXECUTION_DATA_KEYS", () => {
      const skipSpy = vi.spyOn(undoFlags, "setSkipUndoCapture")
      useWorkflowStore.getState().updateNodeWithData("n1", { width: 300 }, { zoom: 1.5 })
      expect(skipSpy).toHaveBeenCalledWith(true)
      expect(skipSpy).toHaveBeenCalledWith(false)
      skipSpy.mockRestore()
    })

    it("does NOT call setSkipUndoCapture when dataUpdates contain a non-exec key", () => {
      const skipSpy = vi.spyOn(undoFlags, "setSkipUndoCapture")
      useWorkflowStore.getState().updateNodeWithData("n1", { width: 300 }, { displayMode: "prompt", zoom: 1.5 })
      expect(skipSpy).not.toHaveBeenCalled()
      skipSpy.mockRestore()
    })

    it("is a no-op for unknown nodeId", () => {
      const before = useWorkflowStore.getState().nodes
      useWorkflowStore.getState().updateNodeWithData("missing", { width: 999 }, { zoom: 999 })
      expect(useWorkflowStore.getState().nodes).toEqual(before)
      expect(useWorkflowStore.getState().isDirty).toBe(false) // don't dirty the workflow on a stale call
    })

    it("preserves data reference when dataUpdates is empty (resize-only path)", () => {
      const before = useWorkflowStore.getState().nodes[0].data
      useWorkflowStore.getState().updateNodeWithData("n1", { width: 300, height: 150 }, {})
      const after = useWorkflowStore.getState().nodes[0].data
      expect(after).toBe(before) // reference equality — undo system relies on this
    })

    it("does not notify subscribers for unknown nodeId", () => {
      let notifications = 0
      const unsub = useWorkflowStore.subscribe(() => { notifications++ })
      useWorkflowStore.getState().updateNodeWithData("missing", { width: 999 }, { zoom: 999 })
      expect(notifications).toBe(0)
      unsub()
    })
  })

  describe("deleteNode", () => {
    it("removes a node and its connected edges", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      useWorkflowStore.getState().addNode("generate-image", { x: 200, y: 0 })
      const nodes = useWorkflowStore.getState().nodes
      const sourceId = nodes[0].id
      const targetId = nodes[1].id

      // Manually add an edge
      useWorkflowStore.setState((s) => ({
        edges: [{ id: "e1", source: sourceId, target: targetId }],
      }))

      useWorkflowStore.getState().deleteNode(sourceId)

      const state = useWorkflowStore.getState()
      expect(state.nodes).toHaveLength(1)
      expect(state.nodes[0].id).toBe(targetId)
      expect(state.edges).toHaveLength(0)
    })

    it("does not affect other edges when deleting a node", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      useWorkflowStore.getState().addNode("generate-image", { x: 200, y: 0 })
      useWorkflowStore.getState().addNode("image-to-video", { x: 400, y: 0 })
      const nodes = useWorkflowStore.getState().nodes

      useWorkflowStore.setState({
        edges: [
          { id: "e1", source: nodes[0].id, target: nodes[1].id },
          { id: "e2", source: nodes[1].id, target: nodes[2].id },
        ],
      })

      useWorkflowStore.getState().deleteNode(nodes[0].id)

      const state = useWorkflowStore.getState()
      expect(state.edges).toHaveLength(1)
      expect(state.edges[0].id).toBe("e2")
    })

    it("clears selection when deleting selected node", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      const nodeId = useWorkflowStore.getState().nodes[0].id
      useWorkflowStore.getState().selectNode(nodeId)

      useWorkflowStore.getState().deleteNode(nodeId)

      expect(useWorkflowStore.getState().selectedNodeId).toBeNull()
    })
  })

  describe("deleteEdge", () => {
    it("removes an edge by id", () => {
      useWorkflowStore.setState({
        edges: [
          { id: "e1", source: "a", target: "b" },
          { id: "e2", source: "b", target: "c" },
        ],
      })

      useWorkflowStore.getState().deleteEdge("e1")

      const state = useWorkflowStore.getState()
      expect(state.edges).toHaveLength(1)
      expect(state.edges[0].id).toBe("e2")
      expect(state.isDirty).toBe(true)
    })

    it("does nothing when edge id does not exist", () => {
      useWorkflowStore.setState({
        edges: [{ id: "e1", source: "a", target: "b" }],
      })

      useWorkflowStore.getState().deleteEdge("nonexistent")

      expect(useWorkflowStore.getState().edges).toHaveLength(1)
    })
  })

  describe("duplicateNode", () => {
    it("duplicates a node with offset position", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 100, y: 100 })
      const nodeId = useWorkflowStore.getState().nodes[0].id

      useWorkflowStore.getState().duplicateNode(nodeId)

      const state = useWorkflowStore.getState()
      expect(state.nodes).toHaveLength(2)
      expect(state.nodes[1].position).toEqual({ x: 150, y: 150 })
      expect(state.nodes[1].type).toBe("text-prompt")
      expect(state.selectedNodeId).toBeNull()
    })

    it("does nothing for non-existent node", () => {
      useWorkflowStore.getState().duplicateNode("nonexistent")
      expect(useWorkflowStore.getState().nodes).toHaveLength(0)
    })
  })

  describe("selectNode", () => {
    it("selects a node by id", () => {
      useWorkflowStore.getState().selectNode("node_1")
      expect(useWorkflowStore.getState().selectedNodeId).toBe("node_1")
    })

    it("clears selection with null", () => {
      useWorkflowStore.getState().selectNode("node_1")
      useWorkflowStore.getState().selectNode(null)
      expect(useWorkflowStore.getState().selectedNodeId).toBeNull()
    })
  })

  describe("loadWorkflow", () => {
    it("loads workflow data and resets dirty flag", () => {
      const nodes = [
        { id: "node_5", type: "text-prompt" as const, position: { x: 0, y: 0 }, data: { label: "Text Prompt", text: "", variables: {} } },
      ]

      useWorkflowStore.getState().loadWorkflow("wf_1", "Loaded WF", nodes, [])

      const state = useWorkflowStore.getState()
      expect(state.workflowId).toBe("wf_1")
      expect(state.workflowName).toBe("Loaded WF")
      expect(state.nodes).toHaveLength(1)
      expect(state.isDirty).toBe(false)
    })
  })

  describe("clearWorkflow", () => {
    it("resets all state", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      useWorkflowStore.getState().setWorkflowName("Test")

      useWorkflowStore.getState().clearWorkflow()

      const state = useWorkflowStore.getState()
      expect(state.workflowId).toBeNull()
      expect(state.workflowName).toBe("Untitled Workflow")
      expect(state.nodes).toEqual([])
      expect(state.isDirty).toBe(false)
    })
  })

  describe("markClean", () => {
    it("sets isDirty to false", () => {
      useWorkflowStore.getState().setWorkflowName("Dirty")
      expect(useWorkflowStore.getState().isDirty).toBe(true)

      useWorkflowStore.getState().markClean()
      expect(useWorkflowStore.getState().isDirty).toBe(false)
    })
  })

  describe("reconcileFromRemote", () => {
    it("replaces nodes/edges, marks clean, advances loadedUpdatedAt, and clears remoteUpdatedAt", () => {
      const store = useWorkflowStore.getState()
      store.loadWorkflow(
        "wf-1",
        "Test",
        [{ id: "n1", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "a" } }] as never,
        [],
      )
      store.setLoadedUpdatedAt("T0")
      store.setRemoteUpdatedAt("T1")
      store.setWorkflowName("Dirty Name") // marks isDirty=true

      store.reconcileFromRemote({
        nodes: [
          { id: "n1", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "a" } },
          { id: "n2", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "b" } },
        ] as never,
        edges: [],
        updatedAt: "T2",
      })

      const next = useWorkflowStore.getState()
      expect(next.nodes.map((n) => n.id)).toEqual(["n1", "n2"])
      expect(next.isDirty).toBe(false)
      expect(next.loadedUpdatedAt).toBe("T2")
      expect(next.remoteUpdatedAt).toBeNull()
    })

    it("clears selectedNodeId when the selected node is no longer in the remote snapshot", () => {
      const store = useWorkflowStore.getState()
      store.loadWorkflow(
        "wf-1",
        "Test",
        [
          { id: "n1", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "a" } },
          { id: "n2", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "b" } },
        ] as never,
        [],
      )
      store.selectNode("n2")
      expect(useWorkflowStore.getState().selectedNodeId).toBe("n2")

      // Remote snapshot drops "n2" — the config panel would otherwise stay
      // open against a phantom id.
      store.reconcileFromRemote({
        nodes: [
          { id: "n1", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "a" } },
        ] as never,
        edges: [],
        updatedAt: "T2",
      })

      expect(useWorkflowStore.getState().selectedNodeId).toBeNull()
    })

    it("preserves selectedNodeId when the selected node still exists in the remote snapshot", () => {
      const store = useWorkflowStore.getState()
      store.loadWorkflow(
        "wf-1",
        "Test",
        [
          { id: "n1", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "a" } },
          { id: "n2", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "b" } },
        ] as never,
        [],
      )
      store.selectNode("n2")

      store.reconcileFromRemote({
        nodes: [
          { id: "n1", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "a" } },
          { id: "n2", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "b" } },
        ] as never,
        edges: [],
        updatedAt: "T2",
      })

      expect(useWorkflowStore.getState().selectedNodeId).toBe("n2")
    })

    it("applies characterDefinitions / flowPromptTemplates / presentationSettings from the settings payload", () => {
      const store = useWorkflowStore.getState()
      store.loadWorkflow("wf-1", "Test", [], [])

      store.reconcileFromRemote({
        nodes: [],
        edges: [],
        updatedAt: "T2",
        settings: {
          characterDefinitions: [{ id: "c1", name: "Alice" }],
          flowPromptTemplates: { "node-1": "remote template" },
          presentationSettings: { runTarget: "node" },
        },
      })

      const next = useWorkflowStore.getState()
      expect(next.characterDefinitions).toEqual([{ id: "c1", name: "Alice" }])
      expect(next.flowPromptTemplates).toEqual({ "node-1": "remote template" })
      expect(next.presentationSettings).toEqual({ runTarget: "node" })
    })

    it("rejects array-shaped settings subfields (typeof array === 'object' slip)", () => {
      const store = useWorkflowStore.getState()
      store.loadWorkflow("wf-1", "Test", [], [])
      store.setFlowPromptTemplates({ "node-1": "before" })

      // Malformed payload: flowPromptTemplates as array. Without the
      // `!Array.isArray` guard this would silently cast `[]` to
      // `Record<string, string>` and wipe local state.
      store.reconcileFromRemote({
        nodes: [],
        edges: [],
        updatedAt: "T2",
        settings: {
          flowPromptTemplates: [] as unknown as Record<string, string>,
          presentationSettings: [] as never,
        },
      })

      const next = useWorkflowStore.getState()
      expect(next.flowPromptTemplates).toEqual({ "node-1": "before" })
    })

    it("migrates a raw `loop` node arriving via realtime into the canonical `list` type", () => {
      // FIX #7: realtime reconcile injected nodes/edges WITHOUT running
      // migrateListLoopNodes (unlike loadWorkflow), so a `loop` node from another
      // device stayed `loop` and was mishandled by the now-`list`-only type-sets.
      const store = useWorkflowStore.getState()
      store.loadWorkflow("wf-1", "Test", [], [])

      store.reconcileFromRemote({
        nodes: [
          {
            id: "loop_1",
            type: "loop",
            position: { x: 0, y: 0 },
            data: { label: "Table", columns: [{ id: "a", handleId: "col_a", type: "text" }], rows: [["a"]] },
          },
        ] as never,
        edges: [],
        updatedAt: "T2",
      })

      const reconciled = useWorkflowStore.getState().nodes.find((n) => n.id === "loop_1")!
      expect(reconciled.type).toBe("list")
    })
  })
})

describe("EXECUTION_DATA_KEYS", () => {
  it("includes zoom so per-frame zoom drag writes skip undo capture", () => {
    expect(EXECUTION_DATA_KEYS.has("zoom")).toBe(true)
  })
})

describe("buildDuplicatedNodeData", () => {
  type Src = Parameters<typeof buildDuplicatedNodeData>[0]
  const clone = (type: string, data: Record<string, unknown>) =>
    buildDuplicatedNodeData({ id: "x", type, position: { x: 0, y: 0 }, data } as unknown as Src) as Record<string, unknown>

  it("clears every entity DB-row pointer so the clone creates its own row", () => {
    expect(clone("character", { characterDbId: "c1" }).characterDbId).toBe("")
    expect(clone("object", { objectDbId: "o1" }).objectDbId).toBe("")
    expect(clone("location", { locationDbId: "l1" }).locationDbId).toBe("")
    expect(clone("face", { faceDbId: "f1" }).faceDbId).toBe("")
  })

  it("strips live execution state but keeps generated results", () => {
    const d = clone("generate-image", {
      executionStatus: "running",
      currentJobId: "j1",
      generatedResults: [{ url: "u" }],
    })
    expect(d.executionStatus).toBeUndefined()
    expect(d.currentJobId).toBeUndefined()
    expect(d.generatedResults).toEqual([{ url: "u" }])
  })

  it("regenerates sub-workflow port/route ids and router route ids", () => {
    const sub = clone("sub-workflow-input", { routeId: "r1", ports: [{ id: "p1", name: "a", mediaType: "image" }] })
    expect(sub.routeId).not.toBe("r1")
    expect((sub.ports as Array<{ id: string }>)[0].id).not.toBe("p1")
    const router = clone("router", { routes: [{ id: "rt1", name: "a", active: true }] })
    expect((router.routes as Array<{ id: string }>)[0].id).not.toBe("rt1")
  })
})

describe("duplicateNodes", () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [
        { id: "a", type: "text-prompt", position: { x: 0, y: 0 }, data: {}, selected: true },
        { id: "b", type: "generate-image", position: { x: 100, y: 0 }, data: {}, selected: true },
        { id: "ext", type: "text-prompt", position: { x: 200, y: 0 }, data: {}, selected: false },
      ],
      edges: [
        { id: "e-ab", source: "a", target: "b", sourceHandle: "out", targetHandle: "in" },
        { id: "e-bext", source: "b", target: "ext", sourceHandle: "image", targetHandle: "in" },
      ],
      selectedNodeId: null,
      isDirty: false,
    } as unknown as Partial<ReturnType<typeof useWorkflowStore.getState>>)
  })

  it("clones the nodes, selects the clones, deselects the originals", () => {
    useWorkflowStore.getState().duplicateNodes(["a", "b"])
    const { nodes, selectedNodeId, isDirty } = useWorkflowStore.getState()
    expect(nodes).toHaveLength(5) // 3 original + 2 clones
    const clones = nodes.filter((n) => !["a", "b", "ext"].includes(n.id))
    expect(clones).toHaveLength(2)
    expect(clones.every((n) => n.selected === true)).toBe(true)
    expect(nodes.filter((n) => n.id === "a" || n.id === "b").every((n) => n.selected === false)).toBe(true)
    // clone of "a" is offset +50/+50 from its source at (0,0)
    expect(clones.some((n) => n.position.x === 50 && n.position.y === 50)).toBe(true)
    expect(selectedNodeId).toBeNull()
    expect(isDirty).toBe(true)
  })

  it("recreates only the internal edge (a→b), repointed to the clones with handles preserved", () => {
    useWorkflowStore.getState().duplicateNodes(["a", "b"])
    const { nodes, edges } = useWorkflowStore.getState()
    const cloneIds = new Set(nodes.filter((n) => !["a", "b", "ext"].includes(n.id)).map((n) => n.id))
    expect(edges).toHaveLength(3) // 2 original + 1 recreated (b→ext is NOT recreated)
    const newEdge = edges.find((e) => cloneIds.has(e.source) && cloneIds.has(e.target))
    expect(newEdge).toBeDefined()
    expect(newEdge!.sourceHandle).toBe("out")
    expect(newEdge!.targetHandle).toBe("in")
    expect(edges.some((e) => cloneIds.has(e.source) && e.target === "ext")).toBe(false)
  })

  it("is a no-op when no ids match", () => {
    const before = useWorkflowStore.getState().nodes
    useWorkflowStore.getState().duplicateNodes(["nope"])
    expect(useWorkflowStore.getState().nodes).toBe(before)
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("re-points a list column's connectedSourceId to the clone when its source is also duplicated", () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "src", type: "text-prompt", position: { x: 0, y: 0 }, data: {}, selected: true },
        {
          id: "lp",
          type: "list",
          position: { x: 100, y: 0 },
          data: { columns: [{ id: "c1", handleId: "col_c1", connectedSourceId: "src", connectedSourceHandle: "out" }] },
          selected: true,
        },
      ],
      edges: [],
      selectedNodeId: null,
      isDirty: false,
    } as unknown as Partial<ReturnType<typeof useWorkflowStore.getState>>)

    useWorkflowStore.getState().duplicateNodes(["src", "lp"])
    const { nodes } = useWorkflowStore.getState()
    const srcClone = nodes.find((n) => !["src", "lp"].includes(n.id) && n.type === "text-prompt")
    const listClone = nodes.find((n) => !["src", "lp"].includes(n.id) && n.type === "list")
    const col = (listClone!.data as { columns: Array<{ connectedSourceId?: string; connectedSourceHandle?: string }> }).columns[0]
    expect(col.connectedSourceId).toBe(srcClone!.id)
    expect(col.connectedSourceHandle).toBe("out")
  })

  it("backfills picker null/undefined sourceHandle on duplicated edges (parity with loadWorkflow)", () => {
    // Round-4 #2 regression: pre-fix, duplicating a picker→consumer pair
    // with a legacy null-sourceHandle edge produced a clone edge with the
    // SAME null sourceHandle. The load-time picker migration only runs
    // in loadWorkflow, so the in-memory legacy edge stayed uncleanable
    // after duplication (popover's strict handleId lookup misses null).
    // Fix: apply migratePickerSourceHandle inside duplicateNodes too.
    useWorkflowStore.setState({
      nodes: [
        { id: "p", type: "mood", position: { x: 0, y: 0 }, data: { label: "Mood" }, selected: true },
        { id: "c", type: "generate-image", position: { x: 100, y: 0 }, data: { label: "Image" }, selected: true },
      ],
      // Legacy edge: no sourceHandle. Should be backfilled to "out" on
      // the clone (mood is in the look family with `out` default).
      edges: [
        { id: "e-pc", source: "p", target: "c", sourceHandle: null as unknown as string, targetHandle: "look" },
      ],
      selectedNodeId: null,
      isDirty: false,
    } as unknown as Partial<ReturnType<typeof useWorkflowStore.getState>>)

    useWorkflowStore.getState().duplicateNodes(["p", "c"])
    const { nodes, edges } = useWorkflowStore.getState()
    const cloneIds = new Set(nodes.filter((n) => !["p", "c"].includes(n.id)).map((n) => n.id))
    const clonedEdge = edges.find((e) => cloneIds.has(e.source) && cloneIds.has(e.target))
    expect(clonedEdge).toBeDefined()
    // Mood is registered in PICKER_DEFAULT_SOURCE_HANDLE with "out".
    expect(clonedEdge!.sourceHandle).toBe("out")
    expect(clonedEdge!.targetHandle).toBe("look")
  })

  it("clears a list column's connectedSourceId when only the list (not its source) is duplicated", () => {
    useWorkflowStore.setState({
      nodes: [
        { id: "src", type: "text-prompt", position: { x: 0, y: 0 }, data: {}, selected: false },
        {
          id: "lp",
          type: "list",
          position: { x: 100, y: 0 },
          data: { columns: [{ id: "c1", handleId: "col_c1", connectedSourceId: "src", connectedSourceHandle: "out" }] },
          selected: true,
        },
      ],
      edges: [],
      selectedNodeId: null,
      isDirty: false,
    } as unknown as Partial<ReturnType<typeof useWorkflowStore.getState>>)

    useWorkflowStore.getState().duplicateNodes(["lp"])
    const listClone = useWorkflowStore.getState().nodes.find((n) => !["src", "lp"].includes(n.id) && n.type === "list")
    const col = (listClone!.data as { columns: Array<{ connectedSourceId?: string }> }).columns[0]
    expect(col.connectedSourceId).toBeUndefined()
  })
})

describe("userTextTemplates (Generate Text user templates)", () => {
  beforeEach(() => {
    useWorkflowStore.setState({ userTextTemplates: [] })
  })

  it("defaults to an empty array", () => {
    expect(useWorkflowStore.getState().userTextTemplates).toEqual([])
  })

  it("setUserTextTemplates replaces the slot", () => {
    const templates = [
      { id: "t1", label: "Blog Outline", systemPrompt: "You write blog outlines." },
      { id: "t2", label: "Email Draft", systemPrompt: "You draft emails.", defaultMaxTokens: 2048, llmModel: "claude-sonnet-4.6" },
    ]
    useWorkflowStore.getState().setUserTextTemplates(templates)
    expect(useWorkflowStore.getState().userTextTemplates).toEqual(templates)
  })

  it("does not mark the workflow dirty (user-level, not workflow content)", () => {
    useWorkflowStore.setState({ isDirty: false })
    useWorkflowStore.getState().setUserTextTemplates([
      { id: "t1", label: "X", systemPrompt: "Y" },
    ])
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })
})
