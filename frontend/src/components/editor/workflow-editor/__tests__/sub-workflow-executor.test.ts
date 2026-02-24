import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

const mockToastError = vi.fn()
vi.mock("sonner", () => ({
  toast: { error: (...args: any[]) => mockToastError(...args) },
}))

const mockUpdateNodeData = vi.fn()
const mockGetState = vi.fn()
const mockSetState = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: (...args: any[]) => mockGetState(...args),
    setState: (...args: any[]) => mockSetState(...args),
  },
}))

const mockSupabaseSelect = vi.fn()
const mockSupabaseEq = vi.fn()
const mockSupabaseSingle = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () => ({
      select: (...args: any[]) => {
        mockSupabaseSelect(...args)
        return {
          eq: (...eqArgs: any[]) => {
            mockSupabaseEq(...eqArgs)
            return {
              single: () => mockSupabaseSingle(),
            }
          },
        }
      },
    }),
  }),
}))

const mockBuildExecutionLevels = vi.fn()
const mockExtractNodeOutput = vi.fn()
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: (...args: any[]) => mockBuildExecutionLevels(...args),
  extractNodeOutput: (...args: any[]) => mockExtractNodeOutput(...args),
}))

const mockIsExecutableNode = vi.fn()
vi.mock("../types", () => ({
  isExecutableNode: (...args: any[]) => mockIsExecutableNode(...args),
}))

const mockExecuteNode = vi.fn()
vi.mock("../execute-node", () => ({
  executeNode: (...args: any[]) => mockExecuteNode(...args),
}))

vi.mock("../node-input-resolver", () => ({
  getListInputForNode: vi.fn(() => null),
}))

vi.mock("../list-execution", () => ({
  executeNodeForList: vi.fn(),
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => "mock scene prompt"),
}))

// ---------------------------------------------------------------------------
// Import (after mocks)
// ---------------------------------------------------------------------------

import { executeSubWorkflow } from "../sub-workflow-executor"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): any {
  return { id, type, data: { label: type, ...data }, position: { x: 0, y: 0 } }
}

function makeEdge(source: string, target: string, targetHandle?: string): any {
  return { id: `${source}->${target}`, source, target, targetHandle }
}

function setupDefaultStore(nodes: any[] = [], edges: any[] = []) {
  mockGetState.mockReturnValue({
    updateNodeData: mockUpdateNodeData,
    nodes,
    edges,
  })
}

const mockCtx: any = {
  abortSignal: new AbortController().signal,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  setupDefaultStore()
})

describe("executeSubWorkflow", () => {
  // -------------------------------------------------------------------------
  // Validation errors
  // -------------------------------------------------------------------------

  describe("validation errors", () => {
    it("rejects when referencedWorkflowId is missing", async () => {
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "",
        routeSnapshot: null,
      })

      await expect(executeSubWorkflow(node, mockCtx)).rejects.toThrow("No workflow selected")
      expect(mockUpdateNodeData).toHaveBeenCalledWith("sw-1", expect.objectContaining({
        executionStatus: "failed",
        errorMessage: "No workflow selected",
      }))
      expect(mockToastError).toHaveBeenCalled()
    })

    it("rejects when routeSnapshot is null", async () => {
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "wf-123",
        routeSnapshot: null,
      })

      await expect(executeSubWorkflow(node, mockCtx)).rejects.toThrow("No route configured")
      expect(mockUpdateNodeData).toHaveBeenCalledWith("sw-1", expect.objectContaining({
        executionStatus: "failed",
        errorMessage: "No route configured",
      }))
    })

    it("rejects when max depth is exceeded", async () => {
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "wf-123",
        routeSnapshot: { routeId: "r1", inputLabel: "Test", inputPorts: [], outputPorts: [], visibleOutputPortId: "" },
      })

      await expect(executeSubWorkflow(node, mockCtx, new Set(), 5)).rejects.toThrow("Max nesting depth exceeded")
      expect(mockUpdateNodeData).toHaveBeenCalledWith("sw-1", expect.objectContaining({
        executionStatus: "failed",
      }))
    })

    it("rejects on circular reference (executingRouteKeys)", async () => {
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "wf-123",
        selectedRouteId: "route-1",
        routeSnapshot: { routeId: "route-1", inputLabel: "Test", inputPorts: [], outputPorts: [], visibleOutputPortId: "" },
      })

      const executingKeys = new Set(["wf-123:route-1"])
      await expect(executeSubWorkflow(node, mockCtx, executingKeys)).rejects.toThrow("Circular reference detected")
      expect(mockToastError).toHaveBeenCalled()
    })

    it("allows self-referencing with a different route", async () => {
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "wf-123",
        selectedRouteId: "route-B",
        routeSnapshot: {
          routeId: "route-B",
          inputLabel: "Route B",
          inputPorts: [],
          outputPorts: [{ id: "op1", name: "Out", mediaType: "any" }],
          visibleOutputPortId: "op1",
        },
      })

      // Route A is already executing — route B should still be allowed
      const executingKeys = new Set(["wf-123:route-A"])

      mockSupabaseSingle.mockResolvedValue({
        data: {
          id: "wf-123",
          nodes: [
            { id: "in-B", type: "sub-workflow-input", data: { label: "In B", routeId: "route-B", ports: [] }, position: { x: 0, y: 0 } },
            { id: "out-B", type: "sub-workflow-output", data: { label: "Out B", routeId: "route-B", ports: [{ id: "op1", name: "Out", mediaType: "any" }], visibleOutputPortId: "op1" }, position: { x: 200, y: 0 } },
          ],
          edges: [{ id: "e1", source: "in-B", target: "out-B" }],
        },
        error: null,
      })

      await executeSubWorkflow(node, mockCtx, executingKeys)
      expect(mockUpdateNodeData).toHaveBeenCalledWith("sw-1", expect.objectContaining({ executionStatus: "completed" }))
    })
  })

  // -------------------------------------------------------------------------
  // Workflow loading
  // -------------------------------------------------------------------------

  describe("workflow loading", () => {
    it("rejects when supabase returns an error", async () => {
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "wf-123",
        selectedRouteId: "route-1",
        routeSnapshot: { routeId: "route-1", inputLabel: "Test", inputPorts: [], outputPorts: [], visibleOutputPortId: "" },
      })

      mockSupabaseSingle.mockResolvedValue({ data: null, error: { message: "not found" } })

      await expect(executeSubWorkflow(node, mockCtx)).rejects.toThrow("Referenced workflow not found")
    })

    it("rejects when route nodes are not found in loaded workflow", async () => {
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "wf-123",
        selectedRouteId: "route-1",
        routeSnapshot: { routeId: "route-1", inputLabel: "Test", inputPorts: [], outputPorts: [], visibleOutputPortId: "" },
      })

      // Return a workflow with no sub-workflow-input/output nodes
      mockSupabaseSingle.mockResolvedValue({
        data: {
          id: "wf-123",
          nodes: [makeNode("n1", "generate-image")],
          edges: [],
        },
        error: null,
      })

      await expect(executeSubWorkflow(node, mockCtx)).rejects.toThrow("Route input/output nodes not found")
    })
  })

  // -------------------------------------------------------------------------
  // Successful execution
  // -------------------------------------------------------------------------

  describe("successful execution", () => {
    const inputNode = makeNode("input-1", "sub-workflow-input", {
      routeId: "route-1",
      ports: [{ id: "p1", name: "Prompt", mediaType: "text" }],
    })
    const genNode = makeNode("gen-1", "generate-image", {})
    const outputNode = makeNode("output-1", "sub-workflow-output", {
      routeId: "route-1",
      ports: [{ id: "op1", name: "Image", mediaType: "image" }],
      visibleOutputPortId: "op1",
    })
    const subEdges = [
      makeEdge("input-1", "gen-1"),
      makeEdge("gen-1", "output-1", "op1"),
    ]

    function setupSuccessfulExecution() {
      const parentTextNode = makeNode("text-1", "text-prompt", { text: "hello" })
      const parentEdge = makeEdge("text-1", "sw-1")
      parentEdge.targetHandle = "in_p1"

      setupDefaultStore(
        [parentTextNode, makeNode("sw-1", "sub-workflow", {})],
        [parentEdge],
      )

      mockSupabaseSingle.mockResolvedValue({
        data: {
          id: "wf-123",
          nodes: [inputNode, genNode, outputNode],
          edges: subEdges,
        },
        error: null,
      })

      mockExtractNodeOutput.mockReturnValue("hello")
      mockIsExecutableNode.mockImplementation((n: any) => n.type !== "sub-workflow-input" && n.type !== "sub-workflow-output")

      // Build levels returns the gen node (input already has injected values)
      const namespacedGen = { ...genNode, id: "__sub_sw-1_gen-1", data: { ...genNode.data, hidden: true } }
      mockBuildExecutionLevels.mockReturnValue([[namespacedGen]])
      mockExecuteNode.mockResolvedValue(undefined)
    }

    it("marks node as running at start", async () => {
      setupSuccessfulExecution()
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "wf-123",
        selectedRouteId: "route-1",
        routeSnapshot: {
          routeId: "route-1",
          inputLabel: "Process",
          inputPorts: [{ id: "p1", name: "Prompt", mediaType: "text" }],
          outputPorts: [{ id: "op1", name: "Image", mediaType: "image" }],
          visibleOutputPortId: "op1",
        },
      })

      await executeSubWorkflow(node, mockCtx)

      // First call to updateNodeData should be setting 'running'
      expect(mockUpdateNodeData).toHaveBeenCalledWith("sw-1", expect.objectContaining({
        executionStatus: "running",
      }))
    })

    it("namespaces IDs with __sub_<nodeId>_ prefix", async () => {
      setupSuccessfulExecution()
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "wf-123",
        selectedRouteId: "route-1",
        routeSnapshot: {
          routeId: "route-1",
          inputLabel: "Process",
          inputPorts: [{ id: "p1", name: "Prompt", mediaType: "text" }],
          outputPorts: [{ id: "op1", name: "Image", mediaType: "image" }],
          visibleOutputPortId: "op1",
        },
      })

      await executeSubWorkflow(node, mockCtx)

      // Check that setState was called with namespaced nodes
      expect(mockSetState).toHaveBeenCalledWith(expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "__sub_sw-1_input-1" }),
          expect.objectContaining({ id: "__sub_sw-1_gen-1" }),
          expect.objectContaining({ id: "__sub_sw-1_output-1" }),
        ]),
      }))
    })

    it("calls buildExecutionLevels with namespaced nodes", async () => {
      setupSuccessfulExecution()
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "wf-123",
        selectedRouteId: "route-1",
        routeSnapshot: {
          routeId: "route-1",
          inputLabel: "Process",
          inputPorts: [{ id: "p1", name: "Prompt", mediaType: "text" }],
          outputPorts: [{ id: "op1", name: "Image", mediaType: "image" }],
          visibleOutputPortId: "op1",
        },
      })

      await executeSubWorkflow(node, mockCtx)

      expect(mockBuildExecutionLevels).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: expect.stringContaining("__sub_sw-1_") }),
        ]),
        expect.any(Array),
      )
    })

    it("marks node as completed on success", async () => {
      setupSuccessfulExecution()
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "wf-123",
        selectedRouteId: "route-1",
        routeSnapshot: {
          routeId: "route-1",
          inputLabel: "Process",
          inputPorts: [{ id: "p1", name: "Prompt", mediaType: "text" }],
          outputPorts: [{ id: "op1", name: "Image", mediaType: "image" }],
          visibleOutputPortId: "op1",
        },
      })

      await executeSubWorkflow(node, mockCtx)

      // Last call before cleanup should mark completed
      expect(mockUpdateNodeData).toHaveBeenCalledWith("sw-1", expect.objectContaining({
        executionStatus: "completed",
      }))
    })
  })

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  describe("cleanup", () => {
    it("removes namespaced nodes/edges from store on success", async () => {
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "wf-123",
        selectedRouteId: "route-1",
        routeSnapshot: {
          routeId: "route-1",
          inputLabel: "Process",
          inputPorts: [],
          outputPorts: [],
          visibleOutputPortId: "",
        },
      })

      const inputNode = makeNode("input-1", "sub-workflow-input", { routeId: "route-1", ports: [] })
      const outputNode = makeNode("output-1", "sub-workflow-output", { routeId: "route-1", ports: [], visibleOutputPortId: "" })

      mockSupabaseSingle.mockResolvedValue({
        data: { id: "wf-123", nodes: [inputNode, outputNode], edges: [makeEdge("input-1", "output-1")] },
        error: null,
      })

      setupDefaultStore([], [])
      mockBuildExecutionLevels.mockReturnValue([])
      mockIsExecutableNode.mockReturnValue(false)

      // After execution, getState should return nodes with the prefix
      // The finally block will filter them out
      const namespacedNodes = [
        { id: "__sub_sw-1_input-1", type: "sub-workflow-input", data: { routeId: "route-1", ports: [] } },
        { id: "__sub_sw-1_output-1", type: "sub-workflow-output", data: { routeId: "route-1", ports: [], visibleOutputPortId: "" } },
        { id: "other-node", type: "generate-image", data: {} },
      ]
      const namespacedEdges = [
        { id: "__sub_sw-1_e1", source: "__sub_sw-1_input-1", target: "__sub_sw-1_output-1" },
        { id: "e-keep", source: "a", target: "b" },
      ]

      // On the final getState call (cleanup), return with namespaced items
      let callCount = 0
      mockGetState.mockImplementation(() => {
        callCount++
        // Return namespaced items for cleanup calls
        return {
          updateNodeData: mockUpdateNodeData,
          nodes: namespacedNodes,
          edges: namespacedEdges,
        }
      })

      await executeSubWorkflow(node, mockCtx)

      // The final setState should filter out namespaced items
      const lastSetState = mockSetState.mock.calls[mockSetState.mock.calls.length - 1][0]
      const finalNodes = lastSetState.nodes
      const finalEdges = lastSetState.edges

      expect(finalNodes).toEqual([{ id: "other-node", type: "generate-image", data: {} }])
      expect(finalEdges).toEqual([{ id: "e-keep", source: "a", target: "b" }])
    })

    it("removes namespaced items on failure too", async () => {
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "wf-123",
        selectedRouteId: "route-1",
        routeSnapshot: {
          routeId: "route-1",
          inputLabel: "Process",
          inputPorts: [],
          outputPorts: [],
          visibleOutputPortId: "",
        },
      })

      mockSupabaseSingle.mockResolvedValue({
        data: null,
        error: { message: "not found" },
      })

      const namespacedNodes = [
        { id: "__sub_sw-1_x", type: "test", data: {} },
        { id: "keep", type: "test", data: {} },
      ]
      mockGetState.mockReturnValue({
        updateNodeData: mockUpdateNodeData,
        nodes: namespacedNodes,
        edges: [],
      })

      await expect(executeSubWorkflow(node, mockCtx)).rejects.toThrow()

      // Final setState should still clean up namespaced items
      const lastSetState = mockSetState.mock.calls[mockSetState.mock.calls.length - 1][0]
      expect(lastSetState.nodes).toEqual([{ id: "keep", type: "test", data: {} }])
    })

    it("re-throws original error", async () => {
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "wf-123",
        selectedRouteId: "route-1",
        routeSnapshot: {
          routeId: "route-1",
          inputLabel: "Process",
          inputPorts: [],
          outputPorts: [],
          visibleOutputPortId: "",
        },
      })

      mockSupabaseSingle.mockResolvedValue({
        data: null,
        error: { message: "not found" },
      })

      setupDefaultStore()

      await expect(executeSubWorkflow(node, mockCtx)).rejects.toThrow("Referenced workflow not found")
    })

    it("clears subWorkflowProgress on failure", async () => {
      const node = makeNode("sw-1", "sub-workflow", {
        referencedWorkflowId: "wf-123",
        selectedRouteId: "route-1",
        routeSnapshot: {
          routeId: "route-1",
          inputLabel: "Process",
          inputPorts: [],
          outputPorts: [],
          visibleOutputPortId: "",
        },
      })

      mockSupabaseSingle.mockResolvedValue({
        data: null,
        error: { message: "not found" },
      })

      setupDefaultStore()

      await expect(executeSubWorkflow(node, mockCtx)).rejects.toThrow()

      expect(mockUpdateNodeData).toHaveBeenCalledWith("sw-1", expect.objectContaining({
        executionStatus: "failed",
        subWorkflowProgress: undefined,
      }))
    })
  })
})
