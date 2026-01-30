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

import { useWorkflowStore } from "../use-workflow-store"

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
      expect((node.data as Record<string, unknown>).provider).toBe("nano-banana")
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
      expect(state.selectedNodeId).toBe(state.nodes[1].id)
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
})
