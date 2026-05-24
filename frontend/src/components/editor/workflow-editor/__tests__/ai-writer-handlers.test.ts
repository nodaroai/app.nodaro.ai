import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mockUpdateNodeData = vi.fn()
const mockDeleteNode = vi.fn()
const mockBatchAddNodesAndEdges = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastInfo = vi.fn()
const mockExecuteNode = vi.fn()
let mockNodes: any[] = []
let mockEdges: any[] = []

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
  },
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: mockNodes,
      edges: mockEdges,
      updateNodeData: mockUpdateNodeData,
      deleteNode: mockDeleteNode,
      batchAddNodesAndEdges: mockBatchAddNodesAndEdges,
    }),
  },
}))

vi.mock("@/types/nodes", () => ({
  NODE_DEFINITIONS: [
    {
      type: "generate-image",
      defaultData: { label: "Generate Image", provider: "flux" },
    },
  ],
}))

vi.mock("../execute-node", () => ({
  executeNode: (...args: unknown[]) => mockExecuteNode(...args),
}))

import {
  handleCreateNodesFromWriter,
  handleRunAllWriterImageNodes,
} from "../ai-writer-handlers"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
  position: { x: number; y: number } = { x: 0, y: 0 },
): any {
  return { id, type, data: { label: type, ...data }, position }
}

function makeEdge(
  source: string,
  target: string,
  sourceHandle = "out",
  targetHandle = "in",
): any {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle,
    targetHandle,
  }
}

function makeWriterNode(
  id: string,
  data: Record<string, unknown> = {},
  position: { x: number; y: number } = { x: 100, y: 100 },
): any {
  return makeNode(id, "ai-writer", data, position)
}

function makeCtx(): any {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (i: any) => i,
    untrackInterval: vi.fn(),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
  }
}

function makePollIntervalsRef(): any {
  return { current: new Set() }
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockNodes = []
  mockEdges = []
  mockExecuteNode.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// handleCreateNodesFromWriter
// ---------------------------------------------------------------------------

describe("handleCreateNodesFromWriter", () => {
  it("returns early when writer node is not found", () => {
    mockNodes = [makeNode("node_1", "generate-image")]

    handleCreateNodesFromWriter("nonexistent")

    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockBatchAddNodesAndEdges).not.toHaveBeenCalled()
  })

  it("shows error toast when generatedItems is undefined", () => {
    mockNodes = [makeWriterNode("w1")]

    handleCreateNodesFromWriter("w1")

    expect(mockToastError).toHaveBeenCalledWith(
      "No generated prompts to create nodes from. Run the Generate Text node first.",
    )
    expect(mockBatchAddNodesAndEdges).not.toHaveBeenCalled()
  })

  it("shows error toast when generatedItems is empty array", () => {
    mockNodes = [makeWriterNode("w1", { generatedItems: [] })]

    handleCreateNodesFromWriter("w1")

    expect(mockToastError).toHaveBeenCalledWith(
      "No generated prompts to create nodes from. Run the Generate Text node first.",
    )
    expect(mockBatchAddNodesAndEdges).not.toHaveBeenCalled()
  })

  it("deletes old created nodes before creating new ones", () => {
    mockNodes = [
      makeWriterNode("w1", {
        generatedItems: ["prompt 1"],
        createdNodeIds: ["old_1", "old_2"],
      }),
    ]

    handleCreateNodesFromWriter("w1")

    expect(mockDeleteNode).toHaveBeenCalledWith("old_1")
    expect(mockDeleteNode).toHaveBeenCalledWith("old_2")
    expect(mockDeleteNode).toHaveBeenCalledTimes(2)
  })

  it("creates correct number of generate-image nodes", () => {
    const items = ["prompt A", "prompt B", "prompt C"]
    mockNodes = [makeWriterNode("w1", { generatedItems: items })]

    handleCreateNodesFromWriter("w1")

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    expect(newNodes).toHaveLength(3)
    for (const node of newNodes) {
      expect(node.type).toBe("generate-image")
    }
  })

  it("positions nodes in a 2-column grid", () => {
    const items = ["p1", "p2", "p3", "p4", "p5"]
    const writerX = 100
    const writerY = 200
    mockNodes = [
      makeWriterNode("w1", { generatedItems: items }, { x: writerX, y: writerY }),
    ]

    handleCreateNodesFromWriter("w1")

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    const startX = writerX + 400
    const COL_SPACING = 320
    const ROW_SPACING = 280

    expect(newNodes[0].position).toEqual({ x: startX, y: writerY })
    expect(newNodes[1].position).toEqual({ x: startX + COL_SPACING, y: writerY })
    expect(newNodes[2].position).toEqual({ x: startX, y: writerY + ROW_SPACING })
    expect(newNodes[3].position).toEqual({
      x: startX + COL_SPACING,
      y: writerY + ROW_SPACING,
    })
    expect(newNodes[4].position).toEqual({
      x: startX,
      y: writerY + ROW_SPACING * 2,
    })
  })

  it("creates writer->image edges for each generated node", () => {
    const items = ["p1", "p2"]
    mockNodes = [makeWriterNode("w1", { generatedItems: items })]

    handleCreateNodesFromWriter("w1")

    const [, newEdges] = mockBatchAddNodesAndEdges.mock.calls[0]
    const writerEdges = newEdges.filter((e: any) => e.source === "w1")
    expect(writerEdges).toHaveLength(2)
    for (const edge of writerEdges) {
      expect(edge.sourceHandle).toBe("text")
      expect(edge.targetHandle).toBe("in")
    }
  })

  it("creates face->image edges when a face node is connected", () => {
    const items = ["p1", "p2"]
    const faceNode = makeNode("face_1", "face")
    const writerNode = makeWriterNode("w1", { generatedItems: items })
    mockNodes = [writerNode, faceNode]
    mockEdges = [makeEdge("face_1", "w1", "faceRef", "in")]

    handleCreateNodesFromWriter("w1")

    const [, newEdges] = mockBatchAddNodesAndEdges.mock.calls[0]
    const faceEdges = newEdges.filter((e: any) => e.source === "face_1")
    expect(faceEdges).toHaveLength(2)
    for (const edge of faceEdges) {
      expect(edge.sourceHandle).toBe("faceRef")
      expect(edge.targetHandle).toBe("in")
    }
  })

  it("finds any face node on canvas when none directly connected", () => {
    const items = ["p1"]
    const faceNode = makeNode("face_1", "face")
    const writerNode = makeWriterNode("w1", { generatedItems: items })
    mockNodes = [writerNode, faceNode]
    mockEdges = []

    handleCreateNodesFromWriter("w1")

    const [, newEdges] = mockBatchAddNodesAndEdges.mock.calls[0]
    const faceEdges = newEdges.filter((e: any) => e.source === "face_1")
    expect(faceEdges).toHaveLength(1)
  })

  it("truncates prompts longer than 1500 characters", () => {
    const longPrompt = "a".repeat(2000)
    mockNodes = [makeWriterNode("w1", { generatedItems: [longPrompt] })]

    handleCreateNodesFromWriter("w1")

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    expect(newNodes[0].data.prompt).toHaveLength(1503) // 1500 + "..."
    expect(newNodes[0].data.prompt.endsWith("...")).toBe(true)
  })

  it("calls batchAddNodesAndEdges and updates writer with createdNodeIds", () => {
    const items = ["p1", "p2"]
    mockNodes = [makeWriterNode("node_1", { generatedItems: items })]

    handleCreateNodesFromWriter("node_1")

    expect(mockBatchAddNodesAndEdges).toHaveBeenCalledTimes(1)
    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    const createdIds = newNodes.map((n: any) => n.id)

    expect(mockUpdateNodeData).toHaveBeenCalledWith("node_1", {
      createdNodeIds: createdIds,
    })
  })

  it("shows success toast with count", () => {
    const items = ["p1", "p2", "p3"]
    mockNodes = [makeWriterNode("w1", { generatedItems: items })]

    handleCreateNodesFromWriter("w1")

    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Created 3 Generate Image nodes",
    )
  })

  it("shows success toast with face and reference info", () => {
    const items = ["p1"]
    const faceNode = makeNode("face_1", "face")
    const uploadNode = makeNode("upload_1", "upload-image")
    const writerNode = makeWriterNode("w1", { generatedItems: items })
    mockNodes = [writerNode, faceNode, uploadNode]
    mockEdges = [
      makeEdge("face_1", "w1", "faceRef", "in"),
      makeEdge("upload_1", "w1", "image", "in"),
    ]

    handleCreateNodesFromWriter("w1")

    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Created 1 Generate Image nodes (with Face + 1 ref image)",
    )
  })

  it("creates reference image source edges for connected image nodes", () => {
    const items = ["p1"]
    const uploadNode = makeNode("upload_1", "upload-image")
    const characterNode = makeNode("char_1", "character")
    const writerNode = makeWriterNode("w1", { generatedItems: items })
    mockNodes = [writerNode, uploadNode, characterNode]
    mockEdges = [
      makeEdge("upload_1", "w1", "image", "in"),
      makeEdge("char_1", "w1", "characterRef", "in"),
    ]

    handleCreateNodesFromWriter("w1")

    const [, newEdges] = mockBatchAddNodesAndEdges.mock.calls[0]
    const uploadEdges = newEdges.filter((e: any) => e.source === "upload_1")
    expect(uploadEdges).toHaveLength(1)
    expect(uploadEdges[0].sourceHandle).toBe("image")

    const charEdges = newEdges.filter((e: any) => e.source === "char_1")
    expect(charEdges).toHaveLength(1)
    expect(charEdges[0].sourceHandle).toBe("characterRef")
  })

  it("applies default data from NODE_DEFINITIONS to created nodes", () => {
    mockNodes = [makeWriterNode("w1", { generatedItems: ["test prompt"] })]

    handleCreateNodesFromWriter("w1")

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    expect(newNodes[0].data.provider).toBe("flux")
  })

  it("does not truncate prompts that are exactly 1500 characters", () => {
    const exactPrompt = "b".repeat(1500)
    mockNodes = [makeWriterNode("w1", { generatedItems: [exactPrompt] })]

    handleCreateNodesFromWriter("w1")

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    expect(newNodes[0].data.prompt).toBe(exactPrompt)
    expect(newNodes[0].data.prompt).toHaveLength(1500)
  })
})

// ---------------------------------------------------------------------------
// handleRunAllWriterImageNodes
// ---------------------------------------------------------------------------

describe("handleRunAllWriterImageNodes", () => {
  it("returns early when writer node is not found", async () => {
    mockNodes = [makeNode("node_1", "generate-image")]

    await handleRunAllWriterImageNodes("nonexistent", makeCtx(), makePollIntervalsRef())

    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockExecuteNode).not.toHaveBeenCalled()
  })

  it("shows error when no createdNodeIds", async () => {
    mockNodes = [makeWriterNode("w1")]

    await handleRunAllWriterImageNodes("w1", makeCtx(), makePollIntervalsRef())

    expect(mockToastError).toHaveBeenCalledWith(
      "No image nodes to run. Create nodes first.",
    )
    expect(mockExecuteNode).not.toHaveBeenCalled()
  })

  it("shows error when createdNodeIds is empty array", async () => {
    mockNodes = [makeWriterNode("w1", { createdNodeIds: [] })]

    await handleRunAllWriterImageNodes("w1", makeCtx(), makePollIntervalsRef())

    expect(mockToastError).toHaveBeenCalledWith(
      "No image nodes to run. Create nodes first.",
    )
  })

  it("shows error when created nodes no longer exist on canvas", async () => {
    mockNodes = [makeWriterNode("w1", { createdNodeIds: ["gone_1", "gone_2"] })]

    await handleRunAllWriterImageNodes("w1", makeCtx(), makePollIntervalsRef())

    expect(mockToastError).toHaveBeenCalledWith(
      "Created image nodes no longer exist on canvas.",
    )
  })

  it("shows error when created nodes exist but are not generate-image type", async () => {
    mockNodes = [
      makeWriterNode("w1", { createdNodeIds: ["n1"] }),
      makeNode("n1", "text-prompt"),
    ]

    await handleRunAllWriterImageNodes("w1", makeCtx(), makePollIntervalsRef())

    expect(mockToastError).toHaveBeenCalledWith(
      "Created image nodes no longer exist on canvas.",
    )
  })

  it("resets execution status on all target nodes before running", async () => {
    const imgNode1 = makeNode("img_1", "generate-image", {
      executionStatus: "completed",
    })
    const imgNode2 = makeNode("img_2", "generate-image", {
      executionStatus: "error",
      errorMessage: "prev failure",
    })
    mockNodes = [
      makeWriterNode("w1", { createdNodeIds: ["img_1", "img_2"] }),
      imgNode1,
      imgNode2,
    ]

    await handleRunAllWriterImageNodes("w1", makeCtx(), makePollIntervalsRef())

    expect(mockUpdateNodeData).toHaveBeenCalledWith("img_1", {
      executionStatus: "idle",
      errorMessage: undefined,
    })
    expect(mockUpdateNodeData).toHaveBeenCalledWith("img_2", {
      executionStatus: "idle",
      errorMessage: undefined,
    })
  })

  it("calls setIsRunning(true) and then setIsRunning(false) when done", async () => {
    const imgNode = makeNode("img_1", "generate-image")
    mockNodes = [
      makeWriterNode("w1", { createdNodeIds: ["img_1"] }),
      imgNode,
    ]
    const ctx = makeCtx()

    await handleRunAllWriterImageNodes("w1", ctx, makePollIntervalsRef())

    expect(ctx.setIsRunning).toHaveBeenCalledWith(true)
    expect(ctx.setIsRunning).toHaveBeenCalledWith(false)
  })

  it("does not call setIsRunning(false) when poll intervals are still active", async () => {
    const imgNode = makeNode("img_1", "generate-image")
    mockNodes = [
      makeWriterNode("w1", { createdNodeIds: ["img_1"] }),
      imgNode,
    ]
    const ctx = makeCtx()
    const pollRef = makePollIntervalsRef()
    pollRef.current.add(123)

    await handleRunAllWriterImageNodes("w1", ctx, pollRef)

    expect(ctx.setIsRunning).toHaveBeenCalledWith(true)
    expect(ctx.setIsRunning).not.toHaveBeenCalledWith(false)
  })

  it("executes all target nodes via executeNode", async () => {
    const img1 = makeNode("img_1", "generate-image")
    const img2 = makeNode("img_2", "generate-image")
    const img3 = makeNode("img_3", "generate-image")
    mockNodes = [
      makeWriterNode("w1", { createdNodeIds: ["img_1", "img_2", "img_3"] }),
      img1,
      img2,
      img3,
    ]

    await handleRunAllWriterImageNodes("w1", makeCtx(), makePollIntervalsRef())

    expect(mockExecuteNode).toHaveBeenCalledTimes(3)
  })

  it("shows success toast with succeeded/total count", async () => {
    const img1 = makeNode("img_1", "generate-image", {
      executionStatus: "completed",
    })
    const img2 = makeNode("img_2", "generate-image", {
      executionStatus: "completed",
    })
    mockNodes = [
      makeWriterNode("w1", { createdNodeIds: ["img_1", "img_2"] }),
      img1,
      img2,
    ]

    await handleRunAllWriterImageNodes("w1", makeCtx(), makePollIntervalsRef())

    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Image generation complete: 2/2 succeeded",
    )
  })

  it("handles execute failures gracefully without throwing", async () => {
    const img1 = makeNode("img_1", "generate-image")
    const img2 = makeNode("img_2", "generate-image")
    mockNodes = [
      makeWriterNode("w1", { createdNodeIds: ["img_1", "img_2"] }),
      img1,
      img2,
    ]
    mockExecuteNode
      .mockRejectedValueOnce(new Error("generation failed"))
      .mockResolvedValueOnce(undefined)

    await handleRunAllWriterImageNodes("w1", makeCtx(), makePollIntervalsRef())

    expect(mockExecuteNode).toHaveBeenCalledTimes(2)
    expect(mockToastSuccess).toHaveBeenCalledTimes(1)
  })

  it("only runs generate-image nodes from createdNodeIds", async () => {
    const img1 = makeNode("img_1", "generate-image")
    const textNode = makeNode("txt_1", "text-prompt")
    mockNodes = [
      makeWriterNode("w1", { createdNodeIds: ["img_1", "txt_1"] }),
      img1,
      textNode,
    ]

    await handleRunAllWriterImageNodes("w1", makeCtx(), makePollIntervalsRef())

    expect(mockExecuteNode).toHaveBeenCalledTimes(1)
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Image generation complete: 0/1 succeeded",
    )
  })
})
