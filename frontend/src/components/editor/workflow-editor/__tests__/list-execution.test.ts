import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUpdateNodeData = vi.fn()
const mockSetState = vi.fn()
let mockNodes: Array<{ id: string; type?: string; data: Record<string, unknown>; position: { x: number; y: number }; hidden?: boolean }> = []
let mockEdges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }> = []

const mockExecuteNode = vi.fn()
const mockExtractNodeOutput = vi.fn()

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      updateNodeData: mockUpdateNodeData,
      nodes: mockNodes,
      edges: mockEdges,
    }),
    setState: (state: unknown) => mockSetState(state),
  },
}))

vi.mock("../execute-node", () => ({
  executeNode: (...args: unknown[]) => mockExecuteNode(...args),
}))

vi.mock("../execution-graph", () => ({
  extractNodeOutput: (...args: unknown[]) => mockExtractNodeOutput(...args),
}))

import { executeNodeForList, expandLoopResults } from "../list-execution"
import type { ExecutionContext } from "../types"
import type { WorkflowNode } from "@/types/nodes"

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (i) => i,
    untrackInterval: vi.fn(),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
    ...overrides,
  } as ExecutionContext
}

function makeNode(overrides: Partial<typeof mockNodes[0]> = {}): typeof mockNodes[0] {
  return {
    id: "n1",
    type: "generate-image",
    position: { x: 0, y: 0 },
    data: { label: "Gen Image" },
    ...overrides,
  }
}

describe("executeNodeForList", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes = [makeNode()]
  })

  it("initializes list execution state", async () => {
    mockExecuteNode.mockResolvedValue(undefined)
    mockExtractNodeOutput.mockReturnValue("result.png")

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["a", "b"], makeCtx())

    // First call should set running state with list metadata
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({
      executionStatus: "running",
      __listTotal: 2,
      __listCompleted: 0,
      __listResults: [],
    }))
  })

  it("executes node for each item in the list", async () => {
    mockExecuteNode.mockResolvedValue(undefined)
    mockExtractNodeOutput.mockReturnValue("result.png")

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["a", "b", "c"], makeCtx())

    expect(mockExecuteNode).toHaveBeenCalledTimes(3)
  })

  it("passes text as overridePrompt for non-URL items", async () => {
    mockExecuteNode.mockResolvedValue(undefined)
    mockExtractNodeOutput.mockReturnValue("out.png")

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["my prompt"], makeCtx())

    // executeNode(freshNode, ctx, overridePrompt, overrideImageUrl, listIterationIndex)
    // For text: overridePrompt="my prompt", overrideImageUrl=undefined
    expect(mockExecuteNode).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "my prompt",
      undefined,
      0,
      expect.any(String),
    )
  })

  it("passes URL as overrideImageUrl for URL items", async () => {
    mockExecuteNode.mockResolvedValue(undefined)
    mockExtractNodeOutput.mockReturnValue("out.png")

    await executeNodeForList(
      mockNodes[0] as unknown as WorkflowNode,
      ["https://example.com/img.png"],
      makeCtx(),
    )

    expect(mockExecuteNode).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      "https://example.com/img.png",
      0,
      expect.any(String),
    )
  })

  it("detects URLs by extension pattern", async () => {
    mockExecuteNode.mockResolvedValue(undefined)
    mockExtractNodeOutput.mockReturnValue("out.mp4")

    await executeNodeForList(
      mockNodes[0] as unknown as WorkflowNode,
      ["video.mp4"],
      makeCtx(),
    )

    // .mp4 matches the regex, so treated as URL
    expect(mockExecuteNode).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      "video.mp4",
      0,
      expect.any(String),
    )
  })

  it("sets completed status when all items succeed", async () => {
    mockExecuteNode.mockResolvedValue(undefined)
    mockExtractNodeOutput.mockReturnValue("result.png")

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["a"], makeCtx())

    // Last updateNodeData call should set completed
    const lastCall = mockUpdateNodeData.mock.calls[mockUpdateNodeData.mock.calls.length - 1]
    expect(lastCall[1]).toEqual(expect.objectContaining({
      executionStatus: "completed",
      __listTotal: 1,
    }))
  })

  it("sets failed status when all items fail", async () => {
    mockExecuteNode.mockRejectedValue(new Error("fail"))

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["a"], makeCtx())

    const lastCall = mockUpdateNodeData.mock.calls[mockUpdateNodeData.mock.calls.length - 1]
    expect(lastCall[1]).toEqual(expect.objectContaining({
      executionStatus: "failed",
    }))
  })

  it("includes error message with counts when partially failed", async () => {
    let callCount = 0
    mockExecuteNode.mockImplementation(async () => {
      callCount++
      if (callCount === 2) throw new Error("fail")
    })
    mockExtractNodeOutput.mockReturnValue("out.png")

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["a", "b"], makeCtx())

    const lastCall = mockUpdateNodeData.mock.calls[mockUpdateNodeData.mock.calls.length - 1]
    expect(lastCall[1].errorMessage).toContain("1/2 succeeded")
    expect(lastCall[1].errorMessage).toContain("1 failed")
  })

  it("stops early when workflow is stale", async () => {
    let callCount = 0
    const ctx = makeCtx({
      isWorkflowStale: () => callCount > 0,
    })
    mockExecuteNode.mockImplementation(async () => { callCount++ })
    mockExtractNodeOutput.mockReturnValue("out.png")

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["a", "b", "c"], ctx)

    expect(mockExecuteNode).toHaveBeenCalledTimes(1)
  })
})

describe("expandLoopResults", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes = []
    mockEdges = []
    mockSetState.mockReset()
  })

  it("does nothing when no nodes have __listResults", () => {
    mockNodes = [makeNode({ data: { label: "Img" } })]
    expandLoopResults()
    expect(mockSetState).not.toHaveBeenCalled()
  })

  it("does nothing when __listResults has only 1 item", () => {
    mockNodes = [makeNode({ data: { label: "Img", __listResults: ["a"] } })]
    expandLoopResults()
    expect(mockSetState).not.toHaveBeenCalled()
  })

  it("creates clones for multi-result nodes", () => {
    mockNodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Gen",
          __listResults: ["url1", "url2"],
          __listInputs: ["prompt1", "prompt2"],
        },
      }),
    ]
    mockEdges = []
    expandLoopResults()

    expect(mockSetState).toHaveBeenCalledTimes(1)
    const state = mockSetState.mock.calls[0][0]
    // Original node should be hidden
    expect(state.nodes.find((n: any) => n.id === "n1")?.hidden).toBe(true)
    // 2 clones should exist
    expect(state.nodes.find((n: any) => n.id === "n1_iter_0")).toBeDefined()
    expect(state.nodes.find((n: any) => n.id === "n1_iter_1")).toBeDefined()
  })

  it("clone data has correct labels and status", () => {
    mockNodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Gen",
          __listResults: ["url1", ""],
          __listInputs: ["a", "b"],
        },
      }),
    ]
    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    const clone0 = state.nodes.find((n: any) => n.id === "n1_iter_0")
    const clone1 = state.nodes.find((n: any) => n.id === "n1_iter_1")
    expect(clone0.data.label).toBe("Gen #1")
    expect(clone0.data.executionStatus).toBe("completed")
    expect(clone1.data.label).toBe("Gen #2")
    expect(clone1.data.executionStatus).toBe("failed") // empty result = failed
  })

  it("sets __expandedClone flag on clones", () => {
    mockNodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Gen",
          __listResults: ["url1", "url2"],
          __listInputs: ["a", "b"],
        },
      }),
    ]
    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    const clone0 = state.nodes.find((n: any) => n.id === "n1_iter_0")
    expect(clone0.data.__expandedClone).toBe(true)
    expect(clone0.data.__expandedFrom).toBe("n1")
  })

  it("does not clone list source types (loop, list, split-text)", () => {
    mockNodes = [
      makeNode({
        id: "loop1",
        type: "loop",
        data: {
          label: "Table",
          __listResults: ["a", "b"],
          __listInputs: ["x", "y"],
        },
      }),
    ]
    expandLoopResults()

    // loop type is a multi-result node but LIST_SOURCE_TYPES are excluded from cloning.
    // setState is still called but the loop node should NOT be hidden and no _iter_ clones created.
    if (mockSetState.mock.calls.length > 0) {
      const state = mockSetState.mock.calls[0][0]
      const cloneNodes = state.nodes.filter((n: any) => n.id.includes("_iter_"))
      expect(cloneNodes).toHaveLength(0)
    }
  })

  it("positions clones with 220px vertical spacing", () => {
    mockNodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        position: { x: 100, y: 200 },
        data: {
          label: "Gen",
          __listResults: ["a", "b", "c"],
          __listInputs: ["x", "y", "z"],
        },
      }),
    ]
    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    const c0 = state.nodes.find((n: any) => n.id === "n1_iter_0")
    const c1 = state.nodes.find((n: any) => n.id === "n1_iter_1")
    const c2 = state.nodes.find((n: any) => n.id === "n1_iter_2")
    expect(c0.position).toEqual({ x: 100, y: 200 })
    expect(c1.position).toEqual({ x: 100, y: 420 })
    expect(c2.position).toEqual({ x: 100, y: 640 })
  })

  it("creates clone edges between cloned pipeline nodes", () => {
    mockNodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: { label: "Gen", __listResults: ["a", "b"], __listInputs: ["x", "y"] },
      }),
      makeNode({
        id: "n2",
        type: "image-to-video",
        data: { label: "I2V", __listResults: ["v1", "v2"], __listInputs: ["", ""] },
      }),
    ]
    mockEdges = [{ id: "e1", source: "n1", target: "n2" }]
    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    const cloneEdges = state.edges.filter((e: any) => e.id.includes("_iter_"))
    expect(cloneEdges).toHaveLength(2)
    expect(cloneEdges[0]).toEqual(expect.objectContaining({
      source: "n1_iter_0",
      target: "n2_iter_0",
    }))
    expect(cloneEdges[1]).toEqual(expect.objectContaining({
      source: "n1_iter_1",
      target: "n2_iter_1",
    }))
  })
})
