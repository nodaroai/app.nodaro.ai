import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock variables (declared before vi.mock calls)
// ---------------------------------------------------------------------------

const mockUpdateNodeData = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastInfo = vi.fn()
const mockExecuteNode = vi.fn()
const mockExecuteNodeForList = vi.fn()
const mockRejectAllManualEdits = vi.fn()
const mockBuildExecutionLevels = vi.fn()
const mockGetEffectivelySkippedIds = vi.fn()
const mockCollapseExpandedClones = vi.fn()
const mockExpandLoopResults = vi.fn()
const mockGetListInputForNode = vi.fn()
const mockHasCredits = vi.fn()
const mockGetJobStatus = vi.fn()
let mockNodes: any[] = []
let mockEdges: any[] = []

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
    }),
  },
}))

vi.mock("@/lib/api", () => ({
  getJobStatus: (...args: unknown[]) => mockGetJobStatus(...args),
  getUserCredits: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  }),
}))

vi.mock("@/lib/edition", () => ({
  hasCredits: () => mockHasCredits(),
}))

vi.mock("@/lib/query-client", () => ({
  queryClient: { fetchQuery: vi.fn() },
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    credits: { balance: (id: string) => ["credits", "balance", id] },
  },
}))

vi.mock("@/hooks/use-model-credits", () => ({
  getCachedCredits: vi.fn(),
}))

vi.mock("../types", () => ({
  WorkflowStaleError: class WorkflowStaleError extends Error {
    constructor() {
      super("Workflow changed during execution")
    }
  },
  NODE_CREDIT_COSTS: { "generate-image": 1 } as Record<string, number>,
  isExecutableNode: (n: any) => {
    const EXECUTABLE = new Set([
      "generate-image",
      "image-to-video",
      "generate-script",
      "text-to-speech",
    ])
    return EXECUTABLE.has(n.type ?? "")
  },
}))

vi.mock("../execution-graph", () => ({
  buildExecutionLevels: (...args: unknown[]) =>
    mockBuildExecutionLevels(...args),
  getEffectivelySkippedIds: (...args: unknown[]) =>
    mockGetEffectivelySkippedIds(...args),
  collapseExpandedClones: (...args: unknown[]) =>
    mockCollapseExpandedClones(...args),
}))

vi.mock("../node-input-resolver", () => ({
  getListInputForNode: (...args: unknown[]) =>
    mockGetListInputForNode(...args),
}))

vi.mock("../execute-node", () => ({
  executeNode: (...args: unknown[]) => mockExecuteNode(...args),
  rejectAllManualEdits: (...args: unknown[]) =>
    mockRejectAllManualEdits(...args),
}))

vi.mock("../list-execution", () => ({
  executeNodeForList: (...args: unknown[]) =>
    mockExecuteNodeForList(...args),
  expandLoopResults: (...args: unknown[]) => mockExpandLoopResults(...args),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  handleRun,
  handleRunSingleNode,
  handleRunFromHere,
  handleRunSelected,
} from "../run-handlers"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: any = {}) {
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
    setInsufficientCreditsData: vi.fn(),
    ...overrides,
  } as any
}

function makeNode(id: string, type = "generate-image", extras: any = {}) {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: type },
    ...extras,
  }
}

function makeEdge(source: string, target: string) {
  return { id: `${source}->${target}`, source, target }
}

// ---------------------------------------------------------------------------
// Common test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockNodes = []
  mockEdges = []

  mockCollapseExpandedClones.mockReturnValue({
    nodes: mockNodes,
    edges: mockEdges,
  })
  mockBuildExecutionLevels.mockReturnValue([mockNodes])
  mockGetEffectivelySkippedIds.mockReturnValue(new Set())
  mockExecuteNode.mockResolvedValue(undefined)
  mockExecuteNodeForList.mockResolvedValue(undefined)
  mockGetListInputForNode.mockReturnValue(null)
  mockHasCredits.mockReturnValue(false)
})

// ---------------------------------------------------------------------------
// handleRun
// ---------------------------------------------------------------------------

describe("handleRun", () => {
  it("shows error toast when no executable nodes", async () => {
    const nonExecNode = makeNode("n1", "text-prompt")
    mockNodes.push(nonExecNode)
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [nonExecNode],
      edges: [],
    })

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRun(ctx, "p1", save, setIsRunning, pollIntervalsRef)

    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining("No executable nodes found"),
    )
    expect(setIsRunning).not.toHaveBeenCalled()
  })

  it("calls rejectAllManualEdits and collapseExpandedClones", async () => {
    const node = makeNode("n1", "generate-image")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [node],
      edges: [],
    })
    mockBuildExecutionLevels.mockReturnValue([[node]])

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRun(ctx, "p1", save, setIsRunning, pollIntervalsRef)

    expect(mockRejectAllManualEdits).toHaveBeenCalled()
    expect(mockCollapseExpandedClones).toHaveBeenCalled()
  })

  it("saves project before running", async () => {
    const node = makeNode("n1", "generate-image")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [node],
      edges: [],
    })
    mockBuildExecutionLevels.mockReturnValue([[node]])

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRun(ctx, "p1", save, setIsRunning, pollIntervalsRef)

    expect(save).toHaveBeenCalledWith("p1")
  })

  it("sets isRunning to true", async () => {
    const node = makeNode("n1", "generate-image")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [node],
      edges: [],
    })
    mockBuildExecutionLevels.mockReturnValue([[node]])

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRun(ctx, "p1", save, setIsRunning, pollIntervalsRef)

    expect(setIsRunning).toHaveBeenCalledWith(true)
  })

  it("shows success toast on completion", async () => {
    const node = makeNode("n1", "generate-image")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [node],
      edges: [],
    })
    mockBuildExecutionLevels.mockReturnValue([[node]])

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRun(ctx, "p1", save, setIsRunning, pollIntervalsRef)

    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Workflow execution complete",
    )
    expect(mockExpandLoopResults).toHaveBeenCalled()
  })

  it("shows error toast when execution fails", async () => {
    const node = makeNode("n1", "generate-image")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [node],
      edges: [],
    })
    mockBuildExecutionLevels.mockReturnValue([[node]])
    mockExecuteNode.mockRejectedValue(new Error("Provider timeout"))

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRun(ctx, "p1", save, setIsRunning, pollIntervalsRef)

    expect(mockToastError).toHaveBeenCalledWith(
      "Workflow execution stopped due to errors",
    )
  })
})

// ---------------------------------------------------------------------------
// handleRunSingleNode
// ---------------------------------------------------------------------------

describe("handleRunSingleNode", () => {
  it("returns early when node not found", async () => {
    mockNodes = []
    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRunSingleNode(
      "missing",
      ctx,
      "p1",
      save,
      setIsRunning,
      pollIntervalsRef,
    )

    expect(setIsRunning).not.toHaveBeenCalled()
    expect(mockExecuteNode).not.toHaveBeenCalled()
  })

  it("shows error for non-executable node", async () => {
    const node = makeNode("n1", "text-prompt")
    mockNodes = [node]
    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRunSingleNode(
      "n1",
      ctx,
      "p1",
      save,
      setIsRunning,
      pollIntervalsRef,
    )

    expect(mockToastError).toHaveBeenCalledWith(
      "This node type cannot be run individually.",
    )
    expect(setIsRunning).not.toHaveBeenCalled()
  })

  it("calls executeNode for single node", async () => {
    const node = makeNode("n1", "generate-image")
    mockNodes = [node]
    mockGetListInputForNode.mockReturnValue(null)

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRunSingleNode(
      "n1",
      ctx,
      "p1",
      save,
      setIsRunning,
      pollIntervalsRef,
    )

    // Wait for the .finally() to run
    await vi.waitFor(() => {
      expect(mockExecuteNode).toHaveBeenCalledWith(node, ctx)
    })
    expect(setIsRunning).toHaveBeenCalledWith(true)
    expect(save).toHaveBeenCalledWith("p1")
  })

  it("calls executeNodeForList when list items exist", async () => {
    const node = makeNode("n1", "generate-image")
    mockNodes = [node]
    const listItems = ["item1", "item2", "item3"]
    mockGetListInputForNode.mockReturnValue(listItems)

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRunSingleNode(
      "n1",
      ctx,
      "p1",
      save,
      setIsRunning,
      pollIntervalsRef,
    )

    await vi.waitFor(() => {
      expect(mockExecuteNodeForList).toHaveBeenCalledWith(
        node,
        listItems,
        ctx,
      )
    })
  })
})

// ---------------------------------------------------------------------------
// handleRunFromHere
// ---------------------------------------------------------------------------

describe("handleRunFromHere", () => {
  it("returns early when start node not found", async () => {
    mockCollapseExpandedClones.mockReturnValue({ nodes: [], edges: [] })

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRunFromHere(
      "missing",
      ctx,
      "p1",
      save,
      setIsRunning,
      pollIntervalsRef,
    )

    expect(setIsRunning).not.toHaveBeenCalled()
    expect(mockBuildExecutionLevels).not.toHaveBeenCalled()
  })

  it("collects downstream nodes via BFS", async () => {
    const nodeA = makeNode("a", "generate-image")
    const nodeB = makeNode("b", "image-to-video")
    const nodeC = makeNode("c", "text-to-speech")
    const edgeAB = makeEdge("a", "b")
    const edgeBtoC = makeEdge("b", "c")

    mockCollapseExpandedClones.mockReturnValue({
      nodes: [nodeA, nodeB, nodeC],
      edges: [edgeAB, edgeBtoC],
    })
    mockBuildExecutionLevels.mockReturnValue([[nodeA], [nodeB], [nodeC]])

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRunFromHere(
      "a",
      ctx,
      "p1",
      save,
      setIsRunning,
      pollIntervalsRef,
    )

    // buildExecutionLevels should receive all 3 downstream nodes
    expect(mockBuildExecutionLevels).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "a" }),
        expect.objectContaining({ id: "b" }),
        expect.objectContaining({ id: "c" }),
      ]),
      expect.any(Array),
    )
  })

  it("shows error when no executable nodes downstream", async () => {
    const nonExec = makeNode("n1", "text-prompt")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [nonExec],
      edges: [],
    })

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRunFromHere(
      "n1",
      ctx,
      "p1",
      save,
      setIsRunning,
      pollIntervalsRef,
    )

    expect(mockToastError).toHaveBeenCalledWith(
      "No executable nodes found downstream.",
    )
    expect(setIsRunning).not.toHaveBeenCalled()
  })

  it("runs downstream nodes and shows success", async () => {
    const nodeA = makeNode("a", "generate-image")
    const nodeB = makeNode("b", "image-to-video")
    const edgeAB = makeEdge("a", "b")

    mockCollapseExpandedClones.mockReturnValue({
      nodes: [nodeA, nodeB],
      edges: [edgeAB],
    })
    mockBuildExecutionLevels.mockReturnValue([[nodeA], [nodeB]])

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRunFromHere(
      "a",
      ctx,
      "p1",
      save,
      setIsRunning,
      pollIntervalsRef,
    )

    expect(setIsRunning).toHaveBeenCalledWith(true)
    expect(mockToastInfo).toHaveBeenCalledWith(
      "Running from here...",
      expect.objectContaining({ description: "2 node(s) to run" }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith("Run from here complete")
    expect(mockExpandLoopResults).toHaveBeenCalled()
    expect(save).toHaveBeenCalledWith("p1")
  })
})

// ---------------------------------------------------------------------------
// handleRunSelected
// ---------------------------------------------------------------------------

describe("handleRunSelected", () => {
  it("shows error when no nodes selected", async () => {
    const node = makeNode("n1", "generate-image", { selected: false })
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [node],
      edges: [],
    })

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRunSelected(ctx, "p1", save, setIsRunning, pollIntervalsRef)

    expect(mockToastError).toHaveBeenCalledWith("No nodes selected.")
    expect(setIsRunning).not.toHaveBeenCalled()
  })

  it("filters to only selected nodes", async () => {
    const nodeA = makeNode("a", "generate-image", { selected: true })
    const nodeB = makeNode("b", "image-to-video", { selected: false })
    const nodeC = makeNode("c", "text-to-speech", { selected: true })

    mockCollapseExpandedClones.mockReturnValue({
      nodes: [nodeA, nodeB, nodeC],
      edges: [],
    })
    mockBuildExecutionLevels.mockReturnValue([[nodeA, nodeC]])

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRunSelected(ctx, "p1", save, setIsRunning, pollIntervalsRef)

    // buildExecutionLevels should only receive selected nodes
    expect(mockBuildExecutionLevels).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "a" }),
        expect.objectContaining({ id: "c" }),
      ]),
      expect.any(Array),
    )
    // nodeB should not be included
    const calledNodes = mockBuildExecutionLevels.mock.calls[0][0]
    expect(calledNodes).toHaveLength(2)
    expect(calledNodes.find((n: any) => n.id === "b")).toBeUndefined()
  })

  it("shows error when no executable nodes in selection", async () => {
    const node = makeNode("n1", "text-prompt", { selected: true })
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [node],
      edges: [],
    })

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRunSelected(ctx, "p1", save, setIsRunning, pollIntervalsRef)

    expect(mockToastError).toHaveBeenCalledWith(
      "No executable nodes in selection.",
    )
    expect(setIsRunning).not.toHaveBeenCalled()
  })

  it("runs selected nodes and shows success", async () => {
    const nodeA = makeNode("a", "generate-image", { selected: true })
    const nodeB = makeNode("b", "image-to-video", { selected: true })

    mockCollapseExpandedClones.mockReturnValue({
      nodes: [nodeA, nodeB],
      edges: [],
    })
    mockBuildExecutionLevels.mockReturnValue([[nodeA, nodeB]])

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    const pollIntervalsRef = { current: new Set() } as any

    await handleRunSelected(ctx, "p1", save, setIsRunning, pollIntervalsRef)

    expect(setIsRunning).toHaveBeenCalledWith(true)
    expect(mockToastInfo).toHaveBeenCalledWith(
      "Running selected nodes...",
      expect.objectContaining({ description: "2 node(s) to run" }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith("Run selected complete")
    expect(mockExpandLoopResults).toHaveBeenCalled()
    expect(save).toHaveBeenCalledWith("p1")
  })
})
