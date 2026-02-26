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
const mockRunWorkflow = vi.fn()
const mockGetWorkflowExecution = vi.fn()
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
      workflowId: "wf-mock-1",
    }),
  },
}))

vi.mock("@/lib/api", () => ({
  getJobStatus: (...args: unknown[]) => mockGetJobStatus(...args),
  getUserCredits: vi.fn(),
  runWorkflow: (...args: unknown[]) => mockRunWorkflow(...args),
  getWorkflowExecution: (...args: unknown[]) => mockGetWorkflowExecution(...args),
  WorkflowAlreadyRunningError: class WorkflowAlreadyRunningError extends Error {
    executionId: string
    constructor(executionId: string) {
      super("already running")
      this.name = "WorkflowAlreadyRunningError"
      this.executionId = executionId
    }
  },
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
  mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })
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

    await handleRun(ctx, "p1", "wf-1", save, setIsRunning)

    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining("No executable nodes found"),
    )
    expect(setIsRunning).not.toHaveBeenCalled()
  })

  it("shows error toast when workflowId is null", async () => {
    const node = makeNode("n1", "generate-image")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [node],
      edges: [],
    })

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()

    await handleRun(ctx, "p1", null, save, setIsRunning)

    expect(mockToastError).toHaveBeenCalledWith(
      "Save the workflow before running.",
    )
  })

  it("calls rejectAllManualEdits and collapseExpandedClones", async () => {
    const node = makeNode("n1", "generate-image")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [node],
      edges: [],
    })
    mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()

    await handleRun(ctx, "p1", "wf-1", save, setIsRunning)

    expect(mockRejectAllManualEdits).toHaveBeenCalled()
    expect(mockCollapseExpandedClones).toHaveBeenCalled()
  })

  it("saves project before running", async () => {
    const node = makeNode("n1", "generate-image")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [node],
      edges: [],
    })
    mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()

    await handleRun(ctx, "p1", "wf-1", save, setIsRunning)

    expect(save).toHaveBeenCalledWith("p1")
  })

  it("calls runWorkflow and sets isRunning", async () => {
    const node = makeNode("n1", "generate-image")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [node],
      edges: [],
    })
    mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()

    await handleRun(ctx, "p1", "wf-1", save, setIsRunning)

    expect(mockRunWorkflow).toHaveBeenCalledWith("wf-1")
    expect(setIsRunning).toHaveBeenCalledWith(true)
  })

  it("marks nodes as pending before calling backend", async () => {
    const node = makeNode("n1", "generate-image")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [node],
      edges: [],
    })
    mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()

    await handleRun(ctx, "p1", "wf-1", save, setIsRunning)

    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", {
      executionStatus: "pending",
    })
  })

  it("clears pending states and shows error on backend failure", async () => {
    const node = makeNode("n1", "generate-image")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [node],
      edges: [],
    })
    mockRunWorkflow.mockRejectedValue(new Error("Server error"))

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()

    await handleRun(ctx, "p1", "wf-1", save, setIsRunning)

    expect(mockToastError).toHaveBeenCalledWith(
      "Failed to start workflow",
      expect.objectContaining({ description: "Server error" }),
    )
    // Should clear pending states
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", {
      executionStatus: undefined,
    })
    expect(setIsRunning).toHaveBeenCalledWith(false)
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
      null,
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
      null,
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
      null,
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
      null,
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

    await handleRunFromHere("missing", ctx, "p1", save, setIsRunning)

    expect(setIsRunning).not.toHaveBeenCalled()
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("collects downstream nodes via BFS and passes nodeIds to backend", async () => {
    const nodeA = makeNode("a", "generate-image")
    const nodeB = makeNode("b", "image-to-video")
    const nodeC = makeNode("c", "text-to-speech")
    const edgeAB = makeEdge("a", "b")
    const edgeBtoC = makeEdge("b", "c")

    mockCollapseExpandedClones.mockReturnValue({
      nodes: [nodeA, nodeB, nodeC],
      edges: [edgeAB, edgeBtoC],
    })

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()

    await handleRunFromHere("a", ctx, "p1", save, setIsRunning)

    expect(mockRunWorkflow).toHaveBeenCalledWith(
      "wf-mock-1",
      expect.arrayContaining(["a", "b", "c"]),
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

    await handleRunFromHere("n1", ctx, "p1", save, setIsRunning)

    expect(mockToastError).toHaveBeenCalledWith(
      "No executable nodes found downstream.",
    )
    expect(setIsRunning).not.toHaveBeenCalled()
  })

  it("calls runWorkflow and sets isRunning", async () => {
    const nodeA = makeNode("a", "generate-image")
    const nodeB = makeNode("b", "image-to-video")
    const edgeAB = makeEdge("a", "b")

    mockCollapseExpandedClones.mockReturnValue({
      nodes: [nodeA, nodeB],
      edges: [edgeAB],
    })

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()

    await handleRunFromHere("a", ctx, "p1", save, setIsRunning)

    expect(setIsRunning).toHaveBeenCalledWith(true)
    expect(mockToastInfo).toHaveBeenCalledWith(
      "Running from here...",
      expect.objectContaining({ description: "2 node(s) to run" }),
    )
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

    await handleRunSelected(ctx, "p1", save, setIsRunning)

    expect(mockToastError).toHaveBeenCalledWith("No nodes selected.")
    expect(setIsRunning).not.toHaveBeenCalled()
  })

  it("passes only selected node IDs to backend", async () => {
    const nodeA = makeNode("a", "generate-image", { selected: true })
    const nodeB = makeNode("b", "image-to-video", { selected: false })
    const nodeC = makeNode("c", "text-to-speech", { selected: true })

    mockCollapseExpandedClones.mockReturnValue({
      nodes: [nodeA, nodeB, nodeC],
      edges: [],
    })

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()

    await handleRunSelected(ctx, "p1", save, setIsRunning)

    // runWorkflow should receive only selected node IDs
    expect(mockRunWorkflow).toHaveBeenCalledWith(
      "wf-mock-1",
      expect.arrayContaining(["a", "c"]),
    )
    const calledIds = mockRunWorkflow.mock.calls[0][1]
    expect(calledIds).toHaveLength(2)
    expect(calledIds).not.toContain("b")
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

    await handleRunSelected(ctx, "p1", save, setIsRunning)

    expect(mockToastError).toHaveBeenCalledWith(
      "No executable nodes in selection.",
    )
    expect(setIsRunning).not.toHaveBeenCalled()
  })

  it("calls runWorkflow and sets isRunning", async () => {
    const nodeA = makeNode("a", "generate-image", { selected: true })
    const nodeB = makeNode("b", "image-to-video", { selected: true })

    mockCollapseExpandedClones.mockReturnValue({
      nodes: [nodeA, nodeB],
      edges: [],
    })

    const ctx = makeCtx()
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()

    await handleRunSelected(ctx, "p1", save, setIsRunning)

    expect(setIsRunning).toHaveBeenCalledWith(true)
    expect(mockToastInfo).toHaveBeenCalledWith(
      "Running selected nodes...",
      expect.objectContaining({ description: "2 node(s) to run" }),
    )
    expect(save).toHaveBeenCalledWith("p1")
  })
})
