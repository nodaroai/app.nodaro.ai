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

import { executeNodeForList, expandLoopResults, writeListResultMeta } from "../list-execution"
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

  it("flags __listRunning during the fan-out and clears it afterwards", async () => {
    // __listRunning exempts the shared node from the abandon-guard while N
    // concurrent iterations write the same currentJobId slot (Task 6 fix).
    mockExecuteNode.mockResolvedValue(undefined)
    mockExtractNodeOutput.mockReturnValue("result.png")

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["a", "b"], makeCtx())

    // Set true on the initial running-state write…
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({
      __listRunning: true,
    }))
    // …and cleared in the finally (last write must leave it false).
    const clearCall = mockUpdateNodeData.mock.calls.find(
      ([, patch]) => (patch as Record<string, unknown>).__listRunning === false,
    )
    expect(clearCall).toBeDefined()
    // The clear must be the final fan-out write so no later write re-flags it.
    const lastCall = mockUpdateNodeData.mock.calls[mockUpdateNodeData.mock.calls.length - 1]
    expect((lastCall[1] as Record<string, unknown>).__listRunning).toBe(false)
  })

  it("clears __listRunning even when the whole batch fails", async () => {
    // The finally must run on throw too, or a failed batch leaves the node
    // permanently exempt from the abandon-guard.
    mockExecuteNode.mockRejectedValue(new Error("fail"))

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["a"], makeCtx())

    const lastCall = mockUpdateNodeData.mock.calls[mockUpdateNodeData.mock.calls.length - 1]
    expect((lastCall[1] as Record<string, unknown>).__listRunning).toBe(false)
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

  // All-or-nothing fan-out (spec §6.4.2, R17): one failed UGC Clip fails the node.
  it("an all-or-nothing node type fails on ONE failed item and still writes the list in index order", async () => {
    mockNodes = [makeNode({ type: "ugc-clip" })]
    mockExecuteNode.mockImplementation(async (_n: unknown, _c: unknown, _p: unknown, _m: unknown, i: number) => {
      if (i === 1) throw new Error("provider 503")
      return `https://cdn.example/${i}.mp4`
    })

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["a", "b"], makeCtx(), undefined)

    const lastCall = mockUpdateNodeData.mock.calls[mockUpdateNodeData.mock.calls.length - 1]
    expect(lastCall[1]).toEqual(expect.objectContaining({
      executionStatus: "failed",
      __listResults: ["https://cdn.example/0.mp4", ""],
    }))
    expect(lastCall[1].errorMessage).toContain("1/2 succeeded")
  })

  it("a normal node type keeps today's partial result as completed", async () => {
    mockNodes = [makeNode({ type: "generate-image" })]
    mockExecuteNode.mockImplementation(async (_n: unknown, _c: unknown, _p: unknown, _m: unknown, i: number) => {
      if (i === 1) throw new Error("provider 503")
      return `https://cdn.example/${i}.png`
    })

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["a", "b"], makeCtx(), undefined)

    const lastCall = mockUpdateNodeData.mock.calls[mockUpdateNodeData.mock.calls.length - 1]
    expect(lastCall[1]).toEqual(expect.objectContaining({
      executionStatus: "completed",
      __listResults: ["https://cdn.example/0.png", ""],
    }))
  })

  it("an all-or-nothing node with every item succeeding completes", async () => {
    mockNodes = [makeNode({ type: "ugc-clip" })]
    mockExecuteNode.mockImplementation(async (_n: unknown, _c: unknown, _p: unknown, _m: unknown, i: number) => `v${i}`)

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["a", "b"], makeCtx(), undefined)

    const lastCall = mockUpdateNodeData.mock.calls[mockUpdateNodeData.mock.calls.length - 1]
    expect(lastCall[1].executionStatus).toBe("completed")
  })

  it("resets __listResultMeta to [] at batch start", async () => {
    mockExecuteNode.mockResolvedValue(undefined)

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["a", "b"], makeCtx())

    expect(mockUpdateNodeData.mock.calls[0][1]).toEqual(expect.objectContaining({ __listResultMeta: [] }))
  })

  it("names why an item failed (toasts are muted for the batch), never a cancelled item's stop", async () => {
    let callCount = 0
    mockExecuteNode.mockImplementation(async () => {
      callCount++
      if (callCount === 1) throw new Error("This post's video link has expired.")
      throw new Error("Cancelled")
    })

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["a", "b"], makeCtx())

    const lastCall = mockUpdateNodeData.mock.calls[mockUpdateNodeData.mock.calls.length - 1]
    expect(lastCall[1].errorMessage).toBe("0/2 succeeded, 2 failed — This post's video link has expired.")
  })

  it("adds no reason when the failure has no words of its own", async () => {
    mockExecuteNode.mockRejectedValue("boom")

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["a"], makeCtx())

    const lastCall = mockUpdateNodeData.mock.calls[mockUpdateNodeData.mock.calls.length - 1]
    expect(lastCall[1].errorMessage).toBe("0/1 succeeded, 1 failed")
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

  it("generatedResults is assembled in list-index order regardless of completion order", async () => {
    // Mock executeNode to resolve out of order: iter 2 first, then 0, then 1.
    const timings: Record<number, number> = { 0: 40, 1: 60, 2: 10 }
    mockExecuteNode.mockImplementation(async (
      _node: unknown,
      _ctx: unknown,
      _prompt: unknown,
      _url: unknown,
      iterIndex: number,
    ) => {
      await new Promise((r) => setTimeout(r, timings[iterIndex ?? 0]))
      return `https://cdn/img${iterIndex}.png`
    })
    mockNodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Gen Image",
          generatedResults: [
            { url: "https://cdn/old.png", timestamp: "t", jobId: "old" },
          ],
        },
      }),
    ]
    // Emulate store-backed updateNodeData so pre-batch snapshot reads the pre-existing history.
    mockUpdateNodeData.mockImplementation((id: string, updates: Record<string, unknown>) => {
      const node = mockNodes.find((n) => n.id === id)
      if (node) node.data = { ...node.data, ...updates }
    })

    await executeNodeForList(
      mockNodes[0] as unknown as WorkflowNode,
      ["a", "b", "c"],
      makeCtx(),
    )

    const final = (mockNodes[0].data as Record<string, unknown>)
      .generatedResults as Array<{ url: string }>
    expect(final.map((r) => r.url)).toEqual([
      "https://cdn/img0.png",
      "https://cdn/img1.png",
      "https://cdn/img2.png",
      "https://cdn/old.png", // preserved pre-batch history
    ])
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

  it("does not clone list source types (list, split-text)", () => {
    mockNodes = [
      makeNode({
        id: "list1",
        type: "list",
        data: {
          label: "Table",
          __listResults: ["a", "b"],
          __listInputs: ["x", "y"],
        },
      }),
    ]
    expandLoopResults()

    // list type is a multi-result node but LIST_SOURCE_TYPES are excluded from cloning.
    // setState is still called but the list node should NOT be hidden and no _iter_ clones created.
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

// ---------------------------------------------------------------------------
// The driving list is applied to the input it is WIRED to, on the row it came from
// ---------------------------------------------------------------------------

describe("executeNodeForList — fan-out plan (handle + rows)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes = [makeNode()]
    mockExecuteNode.mockResolvedValue(undefined)
    mockExtractNodeOutput.mockReturnValue("out.png")
  })

  const run = (items: string[], plan: { rows: Array<number | undefined>; targetHandle: string | null | undefined }) =>
    executeNodeForList(mockNodes[0] as unknown as WorkflowNode, items, makeCtx(), plan)

  it("a list that drives through the prompt handle still overrides the prompt", async () => {
    await run(["p1", "p2"], { rows: [0, 1], targetHandle: "prompt" })
    expect(mockExecuteNode.mock.calls.map((c) => c[2])).toEqual(["p1", "p2"])
  })

  it("a list that drives through `negative` is NOT written into the prompt", async () => {
    await run(["avoid blur", "avoid text"], { rows: [0, 1], targetHandle: "negative" })
    expect(mockExecuteNode).toHaveBeenCalledTimes(2)
    for (const call of mockExecuteNode.mock.calls) {
      expect(call[2]).toBeUndefined()
      expect(call[3]).toBeUndefined()
    }
  })

  it("each iteration resolves its inputs on ITS row, while keeping its own iteration number", async () => {
    // rows [0, 0, 2, 2] = two rows (1 and 3 of the table) x repeat 2.
    const ctx = makeCtx()
    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["p1", "p1", "p3", "p3"], ctx, {
      rows: [0, 0, 2, 2],
      targetHandle: "prompt",
    })
    const calls = mockExecuteNode.mock.calls
    // Identity (idempotency key, result slot) stays the iteration number…
    expect(calls.map((c) => c[4])).toEqual([0, 1, 2, 3])
    // …the inputs are read from the row, passed as its own argument.
    expect(calls.map((c) => c[7])).toEqual([0, 0, 2, 2])
  })

  it("the row NEVER rides on the context — ctx reaches everything the node executes (a Sub-Workflow's children)", async () => {
    const ctx = makeCtx()
    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["p1", "p3"], ctx, { rows: [0, 2], targetHandle: "prompt" })
    for (const call of mockExecuteNode.mock.calls) {
      expect(call[1]).toBe(ctx)
      expect(Object.keys(call[1] as object)).not.toContain("listRowIndex")
    }
  })

  it("an empty driving cell (a row another column keeps alive) overrides nothing", async () => {
    await run(["p1", "", "p3"], { rows: [0, 1, 2], targetHandle: "prompt" })
    expect(mockExecuteNode.mock.calls.map((c) => c[2])).toEqual(["p1", undefined, "p3"])
    expect(mockExecuteNode.mock.calls.map((c) => c[7])).toEqual([0, 1, 2])
  })

  it("without a plan nothing changes (repeat-only / provider-only / direct callers)", async () => {
    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["my prompt"], makeCtx())
    const call = mockExecuteNode.mock.calls[0]
    expect(call[2]).toBe("my prompt")
    expect(call[7]).toBeUndefined()
  })
})

describe("executeNodeForList — each iteration keeps its own result (A1b)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("the batch keeps the job id, thumbnail and render stamps each iteration landed, in list order", async () => {
    // The store applies every patch (the batch start empties the history).
    mockNodes = [makeNode({ type: "apply-edl", data: { label: "Render Clip", generatedResults: [{ url: "old.mp4", jobId: "job-old", timestamp: "t" }] } })]
    mockUpdateNodeData.mockReset().mockImplementation((id: string, patch: Record<string, unknown>) => {
      mockNodes = mockNodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
    })
    // Each iteration lands its take the way poll-job does: prepended, in
    // COMPLETION order — row 2 before row 0; row 1 renders nothing.
    const takes = [
      { url: "a.mp4", jobId: "job-a", thumbnailUrl: "a.jpg", timestamp: "t", quality: "proxy", clipKey: "0-1" },
      undefined,
      { url: "c.mp4", jobId: "job-c", thumbnailUrl: "c.jpg", timestamp: "t", quality: "proxy", clipKey: "4-5" },
    ]
    mockExecuteNode.mockReset().mockImplementation(async (...args: unknown[]) => {
      const take = takes[args[4] as number]
      if (!take) return ""
      const prev = (mockNodes[0].data.generatedResults as unknown[] | undefined) ?? []
      mockNodes = [{ ...mockNodes[0], data: { ...mockNodes[0].data, generatedResults: [take, ...prev] } }]
      return take.url
    })

    await executeNodeForList(mockNodes[0] as unknown as WorkflowNode, ["x", "y", "z"], makeCtx())

    const data = mockNodes[0].data
    expect(data.__listResults).toEqual(["a.mp4", "", "c.mp4"])
    expect(data.generatedResults).toEqual([
      expect.objectContaining({ url: "a.mp4", jobId: "job-a", thumbnailUrl: "a.jpg", quality: "proxy", clipKey: "0-1" }),
      expect.objectContaining({ url: "c.mp4", jobId: "job-c", thumbnailUrl: "c.jpg", quality: "proxy", clipKey: "4-5" }),
      expect.objectContaining({ url: "old.mp4", jobId: "job-old" }),
    ])
  })
})

describe("writeListResultMeta", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes = [makeNode({ type: "ugc-clip", data: { label: "Clip", __listResultMeta: [] } })]
  })

  it("writes row i and leaves the others, whatever order the iterations finish in", () => {
    writeListResultMeta("n1", 1, { warnings: ["frame_check_failed"], durationSec: 9 })
    expect(mockUpdateNodeData).toHaveBeenLastCalledWith("n1", {
      __listResultMeta: [undefined, { warnings: ["frame_check_failed"], durationSec: 9 }],
    })
    // The store applies the patch; the next write reads it back and keeps row 1.
    mockNodes[0].data.__listResultMeta = [undefined, { warnings: ["frame_check_failed"], durationSec: 9 }]
    writeListResultMeta("n1", 0, { warnings: [], durationSec: 12 })
    expect(mockUpdateNodeData).toHaveBeenLastCalledWith("n1", {
      __listResultMeta: [{ warnings: [], durationSec: 12 }, { warnings: ["frame_check_failed"], durationSec: 9 }],
    })
  })
})
