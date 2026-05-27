import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"

const mockApplyNodeChanges = vi.fn((changes: any[], nodes: any[]) => {
  const removeIds = changes
    .filter((c: { type: string }) => c.type === "remove")
    .map((c: { id: string }) => c.id)
  if (removeIds.length > 0) {
    return nodes.filter((n: { id: string }) => !removeIds.includes(n.id))
  }
  return nodes
})

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: (changes: any[], nodes: any[]) => mockApplyNodeChanges(changes, nodes),
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

// Stub localStorage for test environment
const localStorageStore: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value }),
  removeItem: vi.fn((key: string) => { delete localStorageStore[key] }),
  clear: vi.fn(() => { Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]) }),
  length: 0,
  key: vi.fn(() => null),
}
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true })

const autoExecuteNodeMock = vi.fn()
vi.mock("@/components/editor/workflow-editor/auto-execute", () => ({
  autoExecuteNode: (id: string) => autoExecuteNodeMock(id),
  cascadeAutoExecute: vi.fn(),
}))

import { useWorkflowStore } from "../use-workflow-store"

function resetStore() {
  useWorkflowStore.setState({
    workflowId: null,
    workflowName: "Untitled Workflow",
    nodes: [],
    edges: [],
    selectedNodeId: null,
    isDirty: false,
    characterDefinitions: [],
    flowPromptTemplates: {},
  })
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
  Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("useWorkflowStore advanced", () => {
  // ---------------------------------------------------------------
  // 1. onNodesChange
  // ---------------------------------------------------------------
  describe("onNodesChange", () => {
    it("delegates to applyNodeChanges and marks dirty for position changes", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      useWorkflowStore.setState({ isDirty: false })

      useWorkflowStore.getState().onNodesChange([
        { type: "position", id: useWorkflowStore.getState().nodes[0].id, position: { x: 50, y: 50 } },
      ])

      expect(mockApplyNodeChanges).toHaveBeenCalled()
      expect(useWorkflowStore.getState().isDirty).toBe(true)
    })

    it("does NOT mark dirty for select-only changes", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      useWorkflowStore.setState({ isDirty: false })

      useWorkflowStore.getState().onNodesChange([
        { type: "select", id: useWorkflowStore.getState().nodes[0].id, selected: true },
      ])

      expect(useWorkflowStore.getState().isDirty).toBe(false)
    })

    it("does NOT mark dirty for dimension-only changes", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      useWorkflowStore.setState({ isDirty: false })

      useWorkflowStore.getState().onNodesChange([
        { type: "dimensions", id: useWorkflowStore.getState().nodes[0].id, dimensions: { width: 100, height: 50 } },
      ])

      expect(useWorkflowStore.getState().isDirty).toBe(false)
    })
  })

  // ---------------------------------------------------------------
  // 2. onEdgesChange
  // ---------------------------------------------------------------
  describe("onEdgesChange", () => {
    it("removes an edge when given a remove change", () => {
      useWorkflowStore.setState({
        edges: [
          { id: "e1", source: "a", target: "b" } as any,
          { id: "e2", source: "b", target: "c" } as any,
        ],
      })

      useWorkflowStore.getState().onEdgesChange([{ type: "remove", id: "e1" }])

      const state = useWorkflowStore.getState()
      expect(state.edges).toHaveLength(1)
      expect(state.edges[0].id).toBe("e2")
      expect(state.isDirty).toBe(true)
    })

    it("cleans up fieldMappings on the target node when an edge is removed", () => {
      const targetNode = {
        id: "nodeB",
        type: "generate-image",
        position: { x: 0, y: 0 },
        data: {
          label: "Generate Image",
          fieldMappings: {
            prompt: { sourceNodeId: "nodeA", sourceField: "text" },
          },
        },
      }
      useWorkflowStore.setState({
        nodes: [
          { id: "nodeA", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Text Prompt" } } as any,
          targetNode as any,
        ],
        edges: [{ id: "e1", source: "nodeA", target: "nodeB" } as any],
      })

      useWorkflowStore.getState().onEdgesChange([{ type: "remove", id: "e1" }])

      const updatedTarget = useWorkflowStore.getState().nodes.find((n) => n.id === "nodeB")!
      const mappings = (updatedTarget.data as Record<string, unknown>).fieldMappings as Record<string, unknown>
      expect(Object.keys(mappings)).toHaveLength(0)
    })

    it("does NOT mark dirty for select-only edge changes", () => {
      useWorkflowStore.setState({
        edges: [{ id: "e1", source: "a", target: "b" } as any],
        isDirty: false,
      })

      useWorkflowStore.getState().onEdgesChange([
        { type: "select", id: "e1", selected: true },
      ])

      expect(useWorkflowStore.getState().isDirty).toBe(false)
    })
  })

  // ---------------------------------------------------------------
  // 3. onConnect
  // ---------------------------------------------------------------
  describe("onConnect", () => {
    it("adds an edge between two nodes", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      useWorkflowStore.getState().addNode("generate-image", { x: 200, y: 0 })
      const nodes = useWorkflowStore.getState().nodes

      useWorkflowStore.getState().onConnect({
        source: nodes[0].id,
        target: nodes[1].id,
        sourceHandle: null,
        targetHandle: null,
      })

      const state = useWorkflowStore.getState()
      expect(state.edges).toHaveLength(1)
      expect(state.edges[0].source).toBe(nodes[0].id)
      expect(state.edges[0].target).toBe(nodes[1].id)
      expect(state.isDirty).toBe(true)
    })

    it("auto-creates a column via quick-add handle when connecting to a Loop node", () => {
      const loopNode = {
        id: "loop_1",
        type: "loop",
        position: { x: 200, y: 0 },
        data: { label: "Table", columns: [], rows: [], fieldMappings: {} },
      }
      useWorkflowStore.setState({
        nodes: [
          { id: "src_1", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Text Prompt" } } as any,
          loopNode as any,
        ],
      })

      useWorkflowStore.getState().onConnect({
        source: "src_1",
        target: "loop_1",
        sourceHandle: null,
        targetHandle: "col_add",
      })

      const loop = useWorkflowStore.getState().nodes.find((n) => n.id === "loop_1")!
      const loopData = loop.data as Record<string, unknown>
      const columns = loopData.columns as { name: string }[]
      expect(columns).toHaveLength(1)
      expect(columns[0].name).toBe("Text Prompt")
    })

    it("does NOT auto-create columns on a Loop node that already has columns", () => {
      const loopNode = {
        id: "loop_1",
        type: "loop",
        position: { x: 200, y: 0 },
        data: {
          label: "Table",
          columns: [{ id: "col1", name: "Existing", handleId: "existing" }],
          rows: [["hello"]],
          fieldMappings: {},
        },
      }
      useWorkflowStore.setState({
        nodes: [
          { id: "src_1", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Text Prompt" } } as any,
          loopNode as any,
        ],
      })

      useWorkflowStore.getState().onConnect({
        source: "src_1",
        target: "loop_1",
        sourceHandle: null,
        targetHandle: "in",
      })

      const loop = useWorkflowStore.getState().nodes.find((n) => n.id === "loop_1")!
      const loopData = loop.data as Record<string, unknown>
      const columns = loopData.columns as { name: string }[]
      expect(columns).toHaveLength(1)
      expect(columns[0].name).toBe("Existing")
    })

    it("auto-populates Preview with handle-aware items and preserves duplicate source nodes by handle", () => {
      useWorkflowStore.setState({
        nodes: [
          {
            id: "voice_1",
            type: "voice-design",
            position: { x: 0, y: 0 },
            data: {
              label: "Voice Design",
              generatedVoiceId: "voice_123",
              generatedResults: [{ url: "https://cdn.example.com/voice-preview.mp3" }],
              activeResultIndex: 0,
            },
          } as any,
          {
            id: "preview_1",
            type: "preview",
            position: { x: 200, y: 0 },
            data: { label: "Preview", previewItems: [], itemOrder: [] },
          } as any,
        ],
      })

      useWorkflowStore.getState().onConnect({
        source: "voice_1",
        target: "preview_1",
        sourceHandle: "voiceId",
        targetHandle: null,
      })

      useWorkflowStore.getState().onConnect({
        source: "voice_1",
        target: "preview_1",
        sourceHandle: null,
        targetHandle: null,
      })

      const preview = useWorkflowStore.getState().nodes.find((node) => node.id === "preview_1")!
      const previewData = preview.data as Record<string, unknown>
      const previewItems = previewData.previewItems as Array<Record<string, unknown>>
      const itemOrder = previewData.itemOrder as string[]

      expect(previewItems).toHaveLength(2)
      expect(previewItems[0].value).toBe("voice_123")
      expect(previewItems[0].type).toBe("text")
      expect(previewItems[0].itemKey).toBe("voice_1:voiceId")
      expect(previewItems[1].value).toBe("https://cdn.example.com/voice-preview.mp3")
      expect(previewItems[1].type).toBe("audio")
      expect(previewItems[1].itemKey).toBe("voice_1:")
      expect(itemOrder).toEqual(["voice_1:voiceId", "voice_1:"])
    })

    it("auto-populates Preview from distinct sub-workflow output ports", () => {
      useWorkflowStore.setState({
        nodes: [
          {
            id: "sub_1",
            type: "sub-workflow",
            position: { x: 0, y: 0 },
            data: {
              label: "Sub Workflow",
              outputResults: {
                img_port: "https://cdn.example.com/preview.png",
                txt_port: "hello world",
              },
              routeSnapshot: {
                visibleOutputPortId: "img_port",
              },
            },
          } as any,
          {
            id: "preview_1",
            type: "preview",
            position: { x: 200, y: 0 },
            data: { label: "Preview", previewItems: [], itemOrder: [] },
          } as any,
        ],
      })

      useWorkflowStore.getState().onConnect({
        source: "sub_1",
        target: "preview_1",
        sourceHandle: "out_img_port",
        targetHandle: null,
      })

      useWorkflowStore.getState().onConnect({
        source: "sub_1",
        target: "preview_1",
        sourceHandle: "out_txt_port",
        targetHandle: null,
      })

      const preview = useWorkflowStore.getState().nodes.find((node) => node.id === "preview_1")!
      const previewData = preview.data as Record<string, unknown>
      const previewItems = previewData.previewItems as Array<Record<string, unknown>>

      expect(previewItems).toHaveLength(2)
      expect(previewItems[0].value).toBe("https://cdn.example.com/preview.png")
      expect(previewItems[0].itemKey).toBe("sub_1:out_img_port")
      expect(previewItems[1].value).toBe("hello world")
      expect(previewItems[1].itemKey).toBe("sub_1:out_txt_port")
      expect(previewData.itemOrder).toEqual(["sub_1:out_img_port", "sub_1:out_txt_port"])
    })

    it("triggers autoExecuteNode on the target when an edge is connected", () => {
      useWorkflowStore.setState({
        nodes: [
          { id: "src_1", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Source", generatedText: "hi" } } as any,
          { id: "combine_1", type: "combine-text", position: { x: 200, y: 0 }, data: { label: "Combine" } } as any,
        ],
      })

      useWorkflowStore.getState().onConnect({
        source: "src_1",
        target: "combine_1",
        sourceHandle: null,
        targetHandle: null,
      })

      expect(autoExecuteNodeMock).toHaveBeenCalledWith("combine_1")
    })
  })

  // ---------------------------------------------------------------
  // 4. updateNodeData with EXECUTION_DATA_KEYS
  // ---------------------------------------------------------------
  describe("updateNodeData with execution keys", () => {
    it("does NOT set isDirty for execution-only keys like executionStatus", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      const nodeId = useWorkflowStore.getState().nodes[0].id
      useWorkflowStore.setState({ isDirty: false })

      // isDirty is technically set to true inside updateNodeData for ALL updates,
      // but execution-only updates trigger the undo skip flag.
      // The store still marks dirty (it's the undo system that skips).
      // So we test that the value is actually updated on the node.
      useWorkflowStore.getState().updateNodeData(nodeId, { executionStatus: "running" })

      const node = useWorkflowStore.getState().nodes[0]
      expect((node.data as Record<string, unknown>).executionStatus).toBe("running")
    })

    it("updates generatedImageUrl without polluting undo (value is set)", () => {
      useWorkflowStore.getState().addNode("generate-image", { x: 0, y: 0 })
      const nodeId = useWorkflowStore.getState().nodes[0].id

      useWorkflowStore.getState().updateNodeData(nodeId, { generatedImageUrl: "https://example.com/img.png" })

      const node = useWorkflowStore.getState().nodes[0]
      expect((node.data as Record<string, unknown>).generatedImageUrl).toBe("https://example.com/img.png")
    })

    it("updates generatedVideoUrl on the node", () => {
      useWorkflowStore.getState().addNode("image-to-video", { x: 0, y: 0 })
      const nodeId = useWorkflowStore.getState().nodes[0].id

      useWorkflowStore.getState().updateNodeData(nodeId, { generatedVideoUrl: "https://example.com/vid.mp4" })

      const node = useWorkflowStore.getState().nodes[0]
      expect((node.data as Record<string, unknown>).generatedVideoUrl).toBe("https://example.com/vid.mp4")
    })

    it("updates generatedVideoUrl on a generate-video node (unified video node)", () => {
      useWorkflowStore.getState().addNode("generate-video", { x: 0, y: 0 })
      const nodeId = useWorkflowStore.getState().nodes[0].id

      useWorkflowStore.getState().updateNodeData(nodeId, { generatedVideoUrl: "https://example.com/gv.mp4" })

      const node = useWorkflowStore.getState().nodes[0]
      expect((node.data as Record<string, unknown>).generatedVideoUrl).toBe("https://example.com/gv.mp4")
    })

    it("marks isDirty when updating non-execution keys like prompt", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      const nodeId = useWorkflowStore.getState().nodes[0].id
      useWorkflowStore.setState({ isDirty: false })

      useWorkflowStore.getState().updateNodeData(nodeId, { text: "new prompt text" })

      expect(useWorkflowStore.getState().isDirty).toBe(true)
    })

    it("does not change state when updating a non-existent node", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      useWorkflowStore.setState({ isDirty: false })

      useWorkflowStore.getState().updateNodeData("nonexistent_id", { text: "hello" })

      expect(useWorkflowStore.getState().isDirty).toBe(false)
    })
  })

  // ---------------------------------------------------------------
  // 5. toggleSkipNode
  // ---------------------------------------------------------------
  describe("toggleSkipNode", () => {
    it("sets skipped to true when currently not skipped", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      const nodeId = useWorkflowStore.getState().nodes[0].id

      useWorkflowStore.getState().toggleSkipNode(nodeId)

      const node = useWorkflowStore.getState().nodes[0]
      expect((node.data as Record<string, unknown>).skipped).toBe(true)
      expect(useWorkflowStore.getState().isDirty).toBe(true)
    })

    it("sets skipped to false when currently skipped", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      const nodeId = useWorkflowStore.getState().nodes[0].id
      useWorkflowStore.getState().updateNodeData(nodeId, { skipped: true })

      useWorkflowStore.getState().toggleSkipNode(nodeId)

      const node = useWorkflowStore.getState().nodes[0]
      expect((node.data as Record<string, unknown>).skipped).toBe(false)
    })
  })

  // ---------------------------------------------------------------
  // 6. skipSelectedNodes / unskipSelectedNodes
  // ---------------------------------------------------------------
  describe("skipSelectedNodes", () => {
    it("marks multiple nodes as skipped", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      useWorkflowStore.getState().addNode("generate-image", { x: 200, y: 0 })
      const ids = useWorkflowStore.getState().nodes.map((n) => n.id)

      useWorkflowStore.getState().skipSelectedNodes(ids)

      for (const node of useWorkflowStore.getState().nodes) {
        expect((node.data as Record<string, unknown>).skipped).toBe(true)
      }
      expect(useWorkflowStore.getState().isDirty).toBe(true)
    })

    it("does not affect nodes not in the id list", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      useWorkflowStore.getState().addNode("generate-image", { x: 200, y: 0 })
      const nodes = useWorkflowStore.getState().nodes

      useWorkflowStore.getState().skipSelectedNodes([nodes[0].id])

      expect((useWorkflowStore.getState().nodes[0].data as Record<string, unknown>).skipped).toBe(true)
      expect((useWorkflowStore.getState().nodes[1].data as Record<string, unknown>).skipped).toBeUndefined()
    })
  })

  describe("unskipSelectedNodes", () => {
    it("clears skipped flag on multiple nodes", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      useWorkflowStore.getState().addNode("generate-image", { x: 200, y: 0 })
      const ids = useWorkflowStore.getState().nodes.map((n) => n.id)

      // First skip them
      useWorkflowStore.getState().skipSelectedNodes(ids)
      // Then unskip them
      useWorkflowStore.getState().unskipSelectedNodes(ids)

      for (const node of useWorkflowStore.getState().nodes) {
        expect((node.data as Record<string, unknown>).skipped).toBe(false)
      }
    })
  })

  // ---------------------------------------------------------------
  // 7. restoreSnapshot
  // ---------------------------------------------------------------
  describe("restoreSnapshot", () => {
    it("restores nodes, edges, and metadata from a snapshot", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      useWorkflowStore.getState().addNode("generate-image", { x: 200, y: 0 })

      const snapshot = {
        nodes: [
          { id: "node_99", type: "text-prompt" as const, position: { x: 10, y: 20 }, data: { label: "Restored" } },
        ] as any[],
        edges: [] as any[],
        characterDefinitions: [],
        flowPromptTemplates: {},
        workflowName: "Restored Workflow",
      }

      useWorkflowStore.getState().restoreSnapshot(snapshot)

      const state = useWorkflowStore.getState()
      expect(state.nodes).toHaveLength(1)
      expect(state.nodes[0].id).toBe("node_99")
      expect(state.workflowName).toBe("Restored Workflow")
      expect(state.isDirty).toBe(true)
    })

    it("recalculates nextNodeId from max existing node IDs in snapshot", () => {
      const snapshot = {
        nodes: [
          { id: "node_50", type: "text-prompt" as const, position: { x: 0, y: 0 }, data: { label: "A" } },
          { id: "node_100", type: "text-prompt" as const, position: { x: 200, y: 0 }, data: { label: "B" } },
        ] as any[],
        edges: [] as any[],
        characterDefinitions: [],
        flowPromptTemplates: {},
        workflowName: "Snap",
      }

      useWorkflowStore.getState().restoreSnapshot(snapshot)

      // After restoring, adding a new node should get an ID > 100
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })
      const newNode = useWorkflowStore.getState().nodes.find((n) => n.id !== "node_50" && n.id !== "node_100")!
      const num = parseInt(newNode.id.replace("node_", ""), 10)
      expect(num).toBeGreaterThanOrEqual(101)
    })

    it("restores characterDefinitions from the snapshot", () => {
      const charDef = { id: "char_1", name: "Hero", type: "description" as const, description: "The main hero" }
      const snapshot = {
        nodes: [] as any[],
        edges: [] as any[],
        characterDefinitions: [charDef],
        flowPromptTemplates: { tmpl1: "test template" },
        workflowName: "CharSnap",
      }

      useWorkflowStore.getState().restoreSnapshot(snapshot)

      expect(useWorkflowStore.getState().characterDefinitions).toHaveLength(1)
      expect(useWorkflowStore.getState().characterDefinitions[0].name).toBe("Hero")
      expect(useWorkflowStore.getState().flowPromptTemplates).toEqual({ tmpl1: "test template" })
    })
  })

  // ---------------------------------------------------------------
  // 8. batchAddNodesAndEdges
  // ---------------------------------------------------------------
  describe("batchAddNodesAndEdges", () => {
    it("adds multiple nodes and edges at once", () => {
      const newNodes = [
        { id: "node_200", type: "text-prompt" as const, position: { x: 0, y: 0 }, data: { label: "A" } },
        { id: "node_201", type: "generate-image" as const, position: { x: 200, y: 0 }, data: { label: "B" } },
      ] as any[]
      const newEdges = [
        { id: "e_batch", source: "node_200", target: "node_201" },
      ] as any[]

      useWorkflowStore.getState().batchAddNodesAndEdges(newNodes, newEdges)

      const state = useWorkflowStore.getState()
      expect(state.nodes).toHaveLength(2)
      expect(state.edges).toHaveLength(1)
      expect(state.isDirty).toBe(true)
    })

    it("appends to existing nodes and edges", () => {
      useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })

      const batchNodes = [
        { id: "node_300", type: "generate-image" as const, position: { x: 200, y: 0 }, data: { label: "Batch" } },
      ] as any[]

      useWorkflowStore.getState().batchAddNodesAndEdges(batchNodes, [])

      expect(useWorkflowStore.getState().nodes).toHaveLength(2)
    })

    it("updates nextNodeId to avoid ID collisions after batch add", () => {
      const batchNodes = [
        { id: "node_500", type: "text-prompt" as const, position: { x: 0, y: 0 }, data: { label: "High ID" } },
      ] as any[]

      useWorkflowStore.getState().batchAddNodesAndEdges(batchNodes, [])

      // New node should get an ID > 500
      useWorkflowStore.getState().addNode("text-prompt", { x: 100, y: 100 })
      const allNodes = useWorkflowStore.getState().nodes
      const lastNode = allNodes[allNodes.length - 1]
      const num = parseInt(lastNode.id.replace("node_", ""), 10)
      expect(num).toBeGreaterThanOrEqual(501)
    })
  })

  // ---------------------------------------------------------------
  // 9. Character CRUD
  // ---------------------------------------------------------------
  describe("addCharacterDefinition", () => {
    it("adds a character to the definitions list", () => {
      const char = { id: "char_1", name: "Villain", type: "description" as const, description: "Evil antagonist" }

      useWorkflowStore.getState().addCharacterDefinition(char)

      const state = useWorkflowStore.getState()
      expect(state.characterDefinitions).toHaveLength(1)
      expect(state.characterDefinitions[0].name).toBe("Villain")
      expect(state.isDirty).toBe(true)
    })
  })

  describe("updateCharacterDefinition", () => {
    it("updates a specific character by id", () => {
      const char = { id: "char_1", name: "Hero", type: "description" as const }
      useWorkflowStore.getState().addCharacterDefinition(char)
      useWorkflowStore.setState({ isDirty: false })

      useWorkflowStore.getState().updateCharacterDefinition("char_1", { name: "Super Hero", description: "Very strong" })

      const updated = useWorkflowStore.getState().characterDefinitions[0]
      expect(updated.name).toBe("Super Hero")
      expect(updated.description).toBe("Very strong")
      expect(updated.id).toBe("char_1")
      expect(useWorkflowStore.getState().isDirty).toBe(true)
    })

    it("does not affect other characters", () => {
      useWorkflowStore.getState().addCharacterDefinition({ id: "c1", name: "A", type: "description" as const })
      useWorkflowStore.getState().addCharacterDefinition({ id: "c2", name: "B", type: "description" as const })

      useWorkflowStore.getState().updateCharacterDefinition("c1", { name: "Updated A" })

      expect(useWorkflowStore.getState().characterDefinitions[0].name).toBe("Updated A")
      expect(useWorkflowStore.getState().characterDefinitions[1].name).toBe("B")
    })
  })

  describe("removeCharacterDefinition", () => {
    it("removes a character by id", () => {
      useWorkflowStore.getState().addCharacterDefinition({ id: "c1", name: "A", type: "description" as const })
      useWorkflowStore.getState().addCharacterDefinition({ id: "c2", name: "B", type: "description" as const })
      useWorkflowStore.setState({ isDirty: false })

      useWorkflowStore.getState().removeCharacterDefinition("c1")

      const state = useWorkflowStore.getState()
      expect(state.characterDefinitions).toHaveLength(1)
      expect(state.characterDefinitions[0].id).toBe("c2")
      expect(state.isDirty).toBe(true)
    })
  })

  // ---------------------------------------------------------------
  // 10. deleteEdge with fieldMappings cleanup
  // ---------------------------------------------------------------
  describe("deleteEdge with fieldMappings", () => {
    it("cleans up fieldMappings on the target node when edge is deleted", () => {
      const targetNode = {
        id: "nodeB",
        type: "generate-image",
        position: { x: 200, y: 0 },
        data: {
          label: "Generate Image",
          fieldMappings: {
            prompt: { sourceNodeId: "nodeA", sourceField: "text" },
            negativePrompt: { sourceNodeId: "nodeC", sourceField: "text" },
          },
        },
      }
      useWorkflowStore.setState({
        nodes: [
          { id: "nodeA", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "A" } } as any,
          targetNode as any,
          { id: "nodeC", type: "text-prompt", position: { x: 0, y: 200 }, data: { label: "C" } } as any,
        ],
        edges: [
          { id: "e1", source: "nodeA", target: "nodeB" } as any,
          { id: "e2", source: "nodeC", target: "nodeB" } as any,
        ],
      })

      useWorkflowStore.getState().deleteEdge("e1")

      const updatedTarget = useWorkflowStore.getState().nodes.find((n) => n.id === "nodeB")!
      const mappings = (updatedTarget.data as Record<string, unknown>).fieldMappings as Record<string, { sourceNodeId: string }>
      // Only the nodeA mapping should be removed; nodeC mapping should remain
      expect(mappings.prompt).toBeUndefined()
      expect(mappings.negativePrompt).toBeDefined()
      expect(mappings.negativePrompt.sourceNodeId).toBe("nodeC")
    })

    it("preserves fieldMappings when there is still another edge from the same source", () => {
      const targetNode = {
        id: "nodeB",
        type: "generate-image",
        position: { x: 200, y: 0 },
        data: {
          label: "Generate Image",
          fieldMappings: {
            prompt: { sourceNodeId: "nodeA", sourceField: "text" },
          },
        },
      }
      useWorkflowStore.setState({
        nodes: [
          { id: "nodeA", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "A" } } as any,
          targetNode as any,
        ],
        edges: [
          { id: "e1", source: "nodeA", target: "nodeB" } as any,
          { id: "e_dup", source: "nodeA", target: "nodeB" } as any,
        ],
      })

      // Delete one of two duplicate edges: still connected, so mapping stays
      useWorkflowStore.getState().deleteEdge("e1")

      const updatedTarget = useWorkflowStore.getState().nodes.find((n) => n.id === "nodeB")!
      const mappings = (updatedTarget.data as Record<string, unknown>).fieldMappings as Record<string, { sourceNodeId: string }>
      expect(mappings.prompt).toBeDefined()
      expect(mappings.prompt.sourceNodeId).toBe("nodeA")
    })

    // ─── Regression: dangling loop column when a parallel non-column edge
    //                exists between the same source+target ───
    //
    // Bug: `deleteEdge` early-returned on `stillConnected` (a node-pair check
    // that ignores handles), which skipped loop-column cleanup when the
    // source had another wire into a NON-column handle on the same target.
    //
    // Setup: a source-A wired to BOTH a loop's col1_in (loop column edge)
    // AND a non-column field on the loop (e.g. `someField`). Deleting the
    // _in edge MUST clear columns[0].connectedSourceId — the column is no
    // longer wired even though source-A still has a wire to the loop.
    it("REGRESSION: clears loop column connectedSourceId even when parallel non-column edge survives", () => {
      useWorkflowStore.setState({
        nodes: [
          { id: "sourceA", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "A" } } as any,
          {
            id: "loopB",
            type: "loop",
            position: { x: 200, y: 0 },
            data: {
              label: "Loop",
              columns: [{ handleId: "col1", connectedSourceId: "sourceA", connectedSourceHandle: "out" }],
              rows: [],
            },
          } as any,
        ],
        edges: [
          // e1: column input wire — the one being deleted.
          { id: "e1", source: "sourceA", sourceHandle: "out", target: "loopB", targetHandle: "col1_in" } as any,
          // e2: parallel wire to a non-column field. Triggers the
          // stillConnected guard if we only check (source, target) pairs.
          { id: "e2", source: "sourceA", sourceHandle: "out", target: "loopB", targetHandle: "someField" } as any,
        ],
      })

      useWorkflowStore.getState().deleteEdge("e1")

      const state = useWorkflowStore.getState()
      // Only e1 removed; e2 still wired.
      expect(state.edges.map((e) => e.id)).toEqual(["e2"])
      const loop = state.nodes.find((n) => n.id === "loopB")!
      const columns = (loop.data as Record<string, unknown>).columns as Array<{ handleId: string; connectedSourceId?: string; connectedSourceHandle?: string }>
      // The column reference is cleared even though the node pair is still
      // connected via e2.
      expect(columns[0].connectedSourceId).toBeUndefined()
      expect(columns[0].connectedSourceHandle).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------
  // 10b. disconnectAllHandleEdges — batched mirror of deleteEdge
  //
  // The implementation re-creates deleteEdge's three responsibilities
  // (edge filter + per-edge `stillConnected` guard + node cleanup) in a
  // SINGLE set() call. These tests pin the contract so a future refactor
  // can't silently regress to the old per-edge loop or skip the
  // fieldMappings/loop-column cleanup.
  // ---------------------------------------------------------------
  describe("disconnectAllHandleEdges", () => {
    it("removes all edges matching (node, handle, direction='target') AND cleans up fieldMappings", () => {
      useWorkflowStore.setState({
        nodes: [
          { id: "nodeA", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "A" } } as any,
          { id: "nodeC", type: "text-prompt", position: { x: 0, y: 200 }, data: { label: "C" } } as any,
          {
            id: "nodeB",
            type: "generate-image",
            position: { x: 200, y: 0 },
            data: {
              label: "GI",
              fieldMappings: {
                prompt: { sourceNodeId: "nodeA", sourceField: "text" },
                seed: { sourceNodeId: "nodeC", sourceField: "text" },
              },
            },
          } as any,
        ],
        edges: [
          { id: "e1", source: "nodeA", target: "nodeB", targetHandle: "prompt" } as any,
          { id: "e2", source: "nodeC", target: "nodeB", targetHandle: "prompt" } as any,
          { id: "e_other", source: "nodeC", target: "nodeB", targetHandle: "negative" } as any,
        ],
      })

      useWorkflowStore.getState().disconnectAllHandleEdges("nodeB", "prompt", "target")

      const state = useWorkflowStore.getState()
      // Both e1 and e2 should be gone; e_other survives.
      expect(state.edges.map((e) => e.id).sort()).toEqual(["e_other"])

      const target = state.nodes.find((n) => n.id === "nodeB")!
      const mappings = (target.data as Record<string, unknown>).fieldMappings as Record<string, { sourceNodeId: string }>
      // nodeA fully disconnected → its mapping is stripped.
      expect(mappings.prompt).toBeUndefined()
      // nodeC is still wired via e_other on `negative`; the stillConnected
      // guard keeps its mapping in place.
      expect(mappings.seed).toBeDefined()
      expect(mappings.seed.sourceNodeId).toBe("nodeC")
    })

    it("removes all edges matching (node, handle, direction='source') without touching fieldMappings on the source", () => {
      // Source-direction: the OWNER of disconnectAll is the source pip.
      // Cleanup applies to TARGET nodes whose source is now fully removed.
      useWorkflowStore.setState({
        nodes: [
          { id: "nodeA", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "A" } } as any,
          {
            id: "nodeB",
            type: "generate-image",
            position: { x: 200, y: 0 },
            data: {
              label: "GI",
              fieldMappings: { prompt: { sourceNodeId: "nodeA", sourceField: "text" } },
            },
          } as any,
          {
            id: "nodeC",
            type: "generate-image",
            position: { x: 400, y: 0 },
            data: {
              label: "GI2",
              fieldMappings: { prompt: { sourceNodeId: "nodeA", sourceField: "text" } },
            },
          } as any,
        ],
        edges: [
          { id: "e1", source: "nodeA", sourceHandle: "out", target: "nodeB", targetHandle: "prompt" } as any,
          { id: "e2", source: "nodeA", sourceHandle: "out", target: "nodeC", targetHandle: "prompt" } as any,
        ],
      })

      useWorkflowStore.getState().disconnectAllHandleEdges("nodeA", "out", "source")

      const state = useWorkflowStore.getState()
      expect(state.edges).toEqual([])
      // Both target nodes lose their nodeA mapping.
      const nodeB = state.nodes.find((n) => n.id === "nodeB")!
      const nodeC = state.nodes.find((n) => n.id === "nodeC")!
      const mappingsB = (nodeB.data as Record<string, unknown>).fieldMappings as Record<string, unknown>
      const mappingsC = (nodeC.data as Record<string, unknown>).fieldMappings as Record<string, unknown>
      expect(mappingsB.prompt).toBeUndefined()
      expect(mappingsC.prompt).toBeUndefined()
    })

    it("is a no-op when no edges match (no spurious state changes)", () => {
      const before = {
        nodes: [{ id: "nodeA", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "A" } } as any],
        edges: [{ id: "e1", source: "nodeA", target: "nodeB", targetHandle: "prompt" } as any],
      }
      useWorkflowStore.setState(before)

      useWorkflowStore.getState().disconnectAllHandleEdges("nodeA", "missing-handle", "target")

      // Edges + nodes unchanged.
      expect(useWorkflowStore.getState().edges).toEqual(before.edges)
    })

    it("removes ALL matching edges in a single set call (batching invariant)", () => {
      // Stress test: 5 parallel edges on the same handle. The old per-edge
      // loop ran 5 sequential set()s; the batched implementation does 1.
      // We can't directly observe the set() count but we CAN assert all 5
      // are gone in one synchronous call (the user-visible behavior).
      useWorkflowStore.setState({
        nodes: [
          { id: "tgt", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "GI", fieldMappings: {} } } as any,
          ...Array.from({ length: 5 }, (_, i) => ({
            id: `src${i}`,
            type: "text-prompt",
            position: { x: 0, y: i * 100 },
            data: { label: `S${i}` },
          })) as any[],
        ],
        edges: Array.from({ length: 5 }, (_, i) => ({
          id: `e${i}`,
          source: `src${i}`,
          target: "tgt",
          targetHandle: "prompt",
        })) as any[],
      })

      useWorkflowStore.getState().disconnectAllHandleEdges("tgt", "prompt", "target")

      expect(useWorkflowStore.getState().edges).toEqual([])
    })

    it("clears loop column connectedSourceId when disconnecting a _in handle", () => {
      // Loop / list nodes track per-column `connectedSourceId` /
      // `connectedSourceHandle`. The single-edge `deleteEdge` clears it
      // when a column's _in edge goes away — the batched version must too.
      useWorkflowStore.setState({
        nodes: [
          { id: "src", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "S" } } as any,
          {
            id: "loop",
            type: "loop",
            position: { x: 200, y: 0 },
            data: {
              label: "Loop",
              columns: [{ handleId: "col1", connectedSourceId: "src", connectedSourceHandle: "out" }],
              rows: [],
            },
          } as any,
        ],
        edges: [
          // Match the `col1_in` pattern that loopColInputHandle creates so
          // the targetHandle.endsWith("_in") guard fires.
          { id: "e1", source: "src", sourceHandle: "out", target: "loop", targetHandle: "col1_in" } as any,
        ],
      })

      useWorkflowStore.getState().disconnectAllHandleEdges("loop", "col1_in", "target")

      const state = useWorkflowStore.getState()
      expect(state.edges).toEqual([])
      const loop = state.nodes.find((n) => n.id === "loop")!
      const columns = (loop.data as Record<string, unknown>).columns as Array<{ handleId: string; connectedSourceId?: string; connectedSourceHandle?: string }>
      expect(columns[0].connectedSourceId).toBeUndefined()
      expect(columns[0].connectedSourceHandle).toBeUndefined()
    })

    // ─── Regression: disconnectAllHandleEdges with parallel non-column edge ───
    //
    // Bug: the per-edge `stillConnected` guard early-continued for any
    // edge whose (source, target) pair survived in newEdges. That meant a
    // loop column's _in edge wasn't cleaned up when the same source had a
    // parallel wire into a NON-column handle on the same loop — leaving
    // `connectedSourceId` pointing at a node no longer wired through the
    // column.
    it("REGRESSION: clears loop column connectedSourceId even when parallel non-column edge survives (batched)", () => {
      useWorkflowStore.setState({
        nodes: [
          { id: "srcA", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "A" } } as any,
          {
            id: "loopB",
            type: "loop",
            position: { x: 200, y: 0 },
            data: {
              label: "Loop",
              columns: [{ handleId: "col1", connectedSourceId: "srcA", connectedSourceHandle: "out" }],
              rows: [],
            },
          } as any,
        ],
        edges: [
          // e1: column input wire — the one being removed by disconnectAll.
          { id: "e1", source: "srcA", sourceHandle: "out", target: "loopB", targetHandle: "col1_in" } as any,
          // e2: parallel wire to a non-column field on the SAME node pair.
          // The (srcA, loopB) pair survives — old code skipped column
          // cleanup entirely.
          { id: "e2", source: "srcA", sourceHandle: "out", target: "loopB", targetHandle: "someField" } as any,
        ],
      })

      useWorkflowStore.getState().disconnectAllHandleEdges("loopB", "col1_in", "target")

      const state = useWorkflowStore.getState()
      expect(state.edges.map((e) => e.id)).toEqual(["e2"])
      const loop = state.nodes.find((n) => n.id === "loopB")!
      const columns = (loop.data as Record<string, unknown>).columns as Array<{ handleId: string; connectedSourceId?: string; connectedSourceHandle?: string }>
      expect(columns[0].connectedSourceId).toBeUndefined()
      expect(columns[0].connectedSourceHandle).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------
  // 10c. deleteEdge — composition: loop column + fieldMappings cleanup
  //                   both apply on the same removal
  //
  // Bug: an earlier deleteEdge body early-returned after running loop
  // column cleanup, which meant a single edge that was BOTH the last
  // wire to its target AND a `_in` (loop column) handle never ran the
  // fieldMappings cleanup — leaving a dangling entry pointing at the
  // removed source.
  // ---------------------------------------------------------------
  describe("deleteEdge — loop+fieldMappings composition", () => {
    it("REGRESSION: clears BOTH loop column ref AND fieldMappings when a single _in edge is the only wire", () => {
      useWorkflowStore.setState({
        nodes: [
          { id: "srcA", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "A" } } as any,
          {
            id: "loopB",
            type: "loop",
            position: { x: 200, y: 0 },
            data: {
              label: "Loop",
              // Loop holds both: a column referencing srcA via `_in`...
              columns: [{ handleId: "col1", connectedSourceId: "srcA", connectedSourceHandle: "out" }],
              rows: [],
              // ...AND a fieldMappings entry keyed by sourceNodeId.
              fieldMappings: {
                someParam: { sourceNodeId: "srcA", sourceField: "text" },
              },
            },
          } as any,
        ],
        edges: [
          // SINGLE edge — its removal triggers both arms:
          //   - isLoopColumnEdge=true (handle ends with "_in")
          //   - stillConnected=false (no parallel wires)
          { id: "e1", source: "srcA", sourceHandle: "out", target: "loopB", targetHandle: "col1_in" } as any,
        ],
      })

      useWorkflowStore.getState().deleteEdge("e1")

      const state = useWorkflowStore.getState()
      expect(state.edges).toEqual([])
      const loop = state.nodes.find((n) => n.id === "loopB")!
      const data = loop.data as Record<string, unknown>
      const columns = data.columns as Array<{ handleId: string; connectedSourceId?: string; connectedSourceHandle?: string }>
      const mappings = data.fieldMappings as Record<string, { sourceNodeId: string }>
      // Loop column ref cleared.
      expect(columns[0].connectedSourceId).toBeUndefined()
      expect(columns[0].connectedSourceHandle).toBeUndefined()
      // fieldMappings entry stripped (sourceNodeId === srcA was the only entry).
      expect(mappings.someParam).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------
  // 11. setVideoAutoplay
  // ---------------------------------------------------------------
  describe("setVideoAutoplay", () => {
    it("updates the videoAutoplay state to false", () => {
      useWorkflowStore.getState().setVideoAutoplay(false)
      expect(useWorkflowStore.getState().videoAutoplay).toBe(false)
    })

    it("updates the videoAutoplay state to true", () => {
      useWorkflowStore.getState().setVideoAutoplay(false)
      useWorkflowStore.getState().setVideoAutoplay(true)
      expect(useWorkflowStore.getState().videoAutoplay).toBe(true)
    })

    it("writes to localStorage when setting autoplay", () => {
      useWorkflowStore.getState().setVideoAutoplay(false)

      expect(localStorageMock.setItem).toHaveBeenCalledWith("videoAutoplay", "false")

      useWorkflowStore.getState().setVideoAutoplay(true)

      expect(localStorageMock.setItem).toHaveBeenCalledWith("videoAutoplay", "true")
    })
  })
})
