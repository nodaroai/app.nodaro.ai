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
  clearConnectedListRows,
  resetNodeAccumulation,
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

// ---------------------------------------------------------------------------
// clearConnectedListRows
// ---------------------------------------------------------------------------

describe("clearConnectedListRows", () => {
  it("clears rows on a list node whose only column is connected to upstream", () => {
    const listNode = {
      id: "list-1",
      type: "list",
      position: { x: 0, y: 0 },
      data: {
        label: "List",
        columns: [{ id: "c1", handleId: "col_c1", connectedSourceId: "upstream-1" }],
        // Stale rows persisted from previous run's upstream output.
        rows: [["stale-1"], ["stale-2"], ["stale-3"]],
      },
    } as any

    clearConnectedListRows([listNode])

    // Fully-connected → collapses to a single empty row so the live upstream
    // resolver drives row count from scratch.
    expect(mockUpdateNodeData).toHaveBeenCalledWith("list-1", { rows: [[""]] })
  })

  it("only clears cells in connected columns, preserves manual columns", () => {
    const loopNode = {
      id: "loop-1",
      type: "loop",
      position: { x: 0, y: 0 },
      data: {
        label: "Table",
        columns: [
          { id: "c1", handleId: "col_c1", connectedSourceId: "up-1" },
          { id: "c2", handleId: "col_c2" }, // manual
        ],
        rows: [
          ["from-upstream-1", "manual-a"],
          ["from-upstream-2", "manual-b"],
        ],
      },
    } as any

    clearConnectedListRows([loopNode])

    // Manual column kept, connected column cleared.
    expect(mockUpdateNodeData).toHaveBeenCalledWith("loop-1", {
      rows: [
        ["", "manual-a"],
        ["", "manual-b"],
      ],
    })
  })

  it("skips list/loop nodes with no connected columns (fully manual table)", () => {
    const manualList = {
      id: "list-manual",
      type: "list",
      position: { x: 0, y: 0 },
      data: {
        label: "Manual List",
        columns: [{ id: "c1", handleId: "col_c1" }], // no connectedSourceId
        rows: [["user-typed-1"], ["user-typed-2"]],
      },
    } as any

    clearConnectedListRows([manualList])

    // Fully-manual tables untouched so user-entered rows are preserved.
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
  })

  it("skips non-list/loop node types", () => {
    const imgNode = {
      id: "img-1",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: { label: "Image", rows: [["whatever"]] },
    } as any

    clearConnectedListRows([imgNode])

    expect(mockUpdateNodeData).not.toHaveBeenCalled()
  })

  it("handles list node with no columns defined (legacy/uninitialized)", () => {
    const legacyList = {
      id: "list-legacy",
      type: "list",
      position: { x: 0, y: 0 },
      data: { label: "Legacy", items: "line1\nline2" },
    } as any

    clearConnectedListRows([legacyList])

    // Nothing to clear when there are no columns — legacy `items` format
    // isn't upstream-driven.
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
  })

  it("runs across multiple list/loop nodes in a single pass", () => {
    const nodes = [
      {
        id: "list-a",
        type: "list",
        position: { x: 0, y: 0 },
        data: {
          columns: [{ id: "c1", handleId: "col_c1", connectedSourceId: "up" }],
          rows: [["x"]],
        },
      },
      {
        id: "list-b",
        type: "loop",
        position: { x: 0, y: 0 },
        data: {
          columns: [{ id: "c1", handleId: "col_c1", connectedSourceId: "up" }],
          rows: [["y"], ["z"]],
        },
      },
    ] as any

    clearConnectedListRows(nodes)

    expect(mockUpdateNodeData).toHaveBeenCalledTimes(2)
    expect(mockUpdateNodeData).toHaveBeenCalledWith("list-a", { rows: [[""]] })
    expect(mockUpdateNodeData).toHaveBeenCalledWith("list-b", { rows: [[""]] })
  })
})

// ---------------------------------------------------------------------------
// Run handlers — clearConnectedListRows integration
// ---------------------------------------------------------------------------

describe("run handlers clear connected list rows at execution start", () => {
  function makeConnectedListNode() {
    return {
      id: "list-x",
      type: "list",
      position: { x: 0, y: 0 },
      data: {
        label: "List",
        columns: [{ id: "c1", handleId: "col_c1", connectedSourceId: "up-1" }],
        rows: [["stale-1"], ["stale-2"]],
      },
    }
  }

  it("handleRun clears rows before starting the workflow", async () => {
    const listNode = makeConnectedListNode()
    const execNode = makeNode("exec", "generate-image")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [listNode, execNode],
      edges: [],
    })

    const ctx = makeCtx()
    await handleRun(ctx, "p1", "wf-1", vi.fn().mockResolvedValue(undefined), vi.fn())

    expect(mockUpdateNodeData).toHaveBeenCalledWith("list-x", { rows: [[""]] })
  })

  it("handleRunSelected clears rows even for lists outside the selection", async () => {
    // The list sits downstream of a selected exec node; the selection only
    // contains the exec node, but running it still drives the list.
    const listNode = makeConnectedListNode()
    const execNode = makeNode("exec", "generate-image", { selected: true })
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [execNode, listNode],
      edges: [],
    })

    const ctx = makeCtx()
    await handleRunSelected(ctx, "p1", vi.fn().mockResolvedValue(undefined), vi.fn())

    expect(mockUpdateNodeData).toHaveBeenCalledWith("list-x", { rows: [[""]] })
  })

  it("handleRunFromHere clears rows before starting", async () => {
    const listNode = makeConnectedListNode()
    const execNode = makeNode("exec", "generate-image")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [listNode, execNode],
      edges: [],
    })

    const ctx = makeCtx()
    await handleRunFromHere("exec", ctx, "p1", vi.fn().mockResolvedValue(undefined), vi.fn())

    expect(mockUpdateNodeData).toHaveBeenCalledWith("list-x", { rows: [[""]] })
  })
})

// ---------------------------------------------------------------------------
// resetNodeAccumulation
// ---------------------------------------------------------------------------

describe("resetNodeAccumulation", () => {
  function makeNodeWithAccumulation() {
    // Use generate-image because the test-file mock whitelists only a small
    // set of node types for isExecutableNode. The accumulation logic is
    // type-agnostic: the same clearing applies to every executable node
    // (extract-field, filter-list, etc. in production).
    return {
      id: "ef",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: {
        label: "Generator",
        // Accumulated history from two prior runs — the root cause of the
        // downstream list display growing across runs.
        generatedResults: [
          { url: "run2-a", jobId: "j2", timestamp: "t2" },
          { url: "run2-b", jobId: "j2", timestamp: "t2" },
          { url: "run1-a", jobId: "j1", timestamp: "t1" },
          { url: "run1-b", jobId: "j1", timestamp: "t1" },
        ],
        activeResultIndex: 0,
        __listResults: ["run2-a", "run2-b"],
        __listTotal: 2,
        __listCompleted: 2,
        __listInputs: ["in-a", "in-b"],
        listResults: ["run2-a", "run2-b"],
      },
    } as any
  }

  it("empties generatedResults and resets activeResultIndex on an executable node", () => {
    const ef = makeNodeWithAccumulation()

    resetNodeAccumulation([ef])

    expect(mockUpdateNodeData).toHaveBeenCalledTimes(1)
    const [id, patch] = mockUpdateNodeData.mock.calls[0]
    expect(id).toBe("ef")
    expect(patch.generatedResults).toEqual([])
    // activeResultIndex already 0 in the fixture — skipped as a no-op write.
    expect("activeResultIndex" in patch).toBe(false)
  })

  it("resets non-zero activeResultIndex", () => {
    const node = {
      id: "n",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: {
        generatedResults: [{ url: "a" }, { url: "b" }],
        activeResultIndex: 1,
      },
    } as any

    resetNodeAccumulation([node])

    const patch = mockUpdateNodeData.mock.calls[0][1]
    expect(patch.activeResultIndex).toBe(0)
    expect(patch.generatedResults).toEqual([])
  })

  it("clears all listResults-style accumulation fields", () => {
    const ef = makeNodeWithAccumulation()

    resetNodeAccumulation([ef])

    const patch = mockUpdateNodeData.mock.calls[0][1]
    expect(patch.__listResults).toBeUndefined()
    expect(patch.__listTotal).toBeUndefined()
    expect(patch.__listCompleted).toBeUndefined()
    expect(patch.__listInputs).toBeUndefined()
    expect(patch.listResults).toBeUndefined()
  })

  it("skips source nodes entirely (text-prompt, upload-*, triggers, list, loop)", () => {
    const textPrompt = {
      id: "tp",
      type: "text-prompt",
      position: { x: 0, y: 0 },
      data: { text: "hello", generatedResults: [{ text: "stale" }] },
    } as any
    const listNode = {
      id: "ln",
      type: "list",
      position: { x: 0, y: 0 },
      data: { rows: [["a"]], generatedResults: [{ text: "stale" }] },
    } as any

    resetNodeAccumulation([textPrompt, listNode])

    // Source types must be preserved — isExecutableNode filter drops them.
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
  })

  it("skips nodes with no accumulation fields set (no pointless store write)", () => {
    const freshNode = {
      id: "fresh",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: { label: "Fresh" },
    } as any

    resetNodeAccumulation([freshNode])

    expect(mockUpdateNodeData).not.toHaveBeenCalled()
  })

  it("only patches fields that are currently set, leaves others untouched", () => {
    const partial = {
      id: "p",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: {
        label: "Partial",
        generatedResults: [{ url: "img-a", jobId: "j1" }],
        // __listResults, listResults, activeResultIndex not set
      },
    } as any

    resetNodeAccumulation([partial])

    const patch = mockUpdateNodeData.mock.calls[0][1]
    expect(patch.generatedResults).toEqual([])
    expect("__listResults" in patch).toBe(false)
    expect("listResults" in patch).toBe(false)
    expect("activeResultIndex" in patch).toBe(false)
  })

  it("skips already-empty generatedResults to avoid no-op writes", () => {
    const emptyGen = {
      id: "eg",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: { generatedResults: [] },
    } as any

    resetNodeAccumulation([emptyGen])

    expect(mockUpdateNodeData).not.toHaveBeenCalled()
  })

  it("runs across a mixed batch of nodes", () => {
    const execA = makeNodeWithAccumulation()
    const textPrompt = {
      id: "tp",
      type: "text-prompt",
      position: { x: 0, y: 0 },
      data: { text: "x" },
    } as any
    const execB = {
      id: "img",
      type: "image-to-video",
      position: { x: 0, y: 0 },
      data: { generatedResults: [{ url: "old" }] },
    } as any

    resetNodeAccumulation([execA, textPrompt, execB])

    expect(mockUpdateNodeData).toHaveBeenCalledTimes(2)
    const patchedIds = mockUpdateNodeData.mock.calls.map((c: any[]) => c[0])
    expect(patchedIds).toEqual(expect.arrayContaining(["ef", "img"]))
    expect(patchedIds).not.toContain("tp")
  })
})

// ---------------------------------------------------------------------------
// Run handlers — resetNodeAccumulation integration
// ---------------------------------------------------------------------------

describe("run handlers reset accumulation at execution start", () => {
  function makeAccumulatedExecNode(id: string, type = "generate-image", extras: any = {}) {
    return {
      id,
      type,
      position: { x: 0, y: 0 },
      data: {
        label: type,
        generatedResults: [{ url: "prior-run-1", jobId: "j1" }, { url: "prior-run-2", jobId: "j2" }],
        activeResultIndex: 1,
        ...extras,
      },
    }
  }

  it("handleRun resets generatedResults on every executable node", async () => {
    const execA = makeAccumulatedExecNode("a", "generate-image")
    const execB = makeAccumulatedExecNode("b", "image-to-video")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [execA, execB],
      edges: [],
    })

    const ctx = makeCtx()
    await handleRun(ctx, "p1", "wf-1", vi.fn().mockResolvedValue(undefined), vi.fn())

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ generatedResults: [], activeResultIndex: 0 }),
    )
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "b",
      expect.objectContaining({ generatedResults: [], activeResultIndex: 0 }),
    )
  })

  it("handleRunSingleNode preserves generatedResults on the target node (history kept across re-runs)", async () => {
    const target = makeAccumulatedExecNode("target", "generate-image", {
      __listResults: ["stale-a", "stale-b"],
      __listTotal: 2,
      __listCompleted: 2,
    })
    const sibling = makeAccumulatedExecNode("sibling", "generate-image")
    mockNodes.splice(0, mockNodes.length, target, sibling)

    const ctx = makeCtx()
    const pollRef = { current: new Set<any>() } as any
    await handleRunSingleNode("target", ctx, "p1", vi.fn().mockResolvedValue(undefined), vi.fn(), pollRef)

    // generatedResults / activeResultIndex preserved on target (history intact).
    const generatedResultPatches = mockUpdateNodeData.mock.calls
      .filter((c: any[]) => c[1]?.generatedResults !== undefined)
      .map((c: any[]) => c[0])
    expect(generatedResultPatches).toEqual([])

    // But transient list-state fields on the target are still cleared.
    const listStatePatch = mockUpdateNodeData.mock.calls.find(
      (c: any[]) => c[0] === "target" && c[1]?.__listResults === undefined && "__listResults" in c[1],
    )
    expect(listStatePatch).toBeDefined()

    // Sibling's data is untouched.
    const siblingPatches = mockUpdateNodeData.mock.calls.filter((c: any[]) => c[0] === "sibling")
    expect(siblingPatches).toEqual([])
  })

  it("handleRunSelected resets only selected executable nodes", async () => {
    const selected = { ...makeAccumulatedExecNode("sel", "generate-image"), selected: true }
    const unselected = { ...makeAccumulatedExecNode("unsel", "generate-image"), selected: false }
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [selected, unselected],
      edges: [],
    })

    const ctx = makeCtx()
    await handleRunSelected(ctx, "p1", vi.fn().mockResolvedValue(undefined), vi.fn())

    const patchedIds = mockUpdateNodeData.mock.calls
      .filter((c: any[]) => c[1]?.generatedResults !== undefined)
      .map((c: any[]) => c[0])
    expect(patchedIds).toEqual(["sel"])
  })

  it("handleRunFromHere preserves generatedResults on downstream nodes (history kept)", async () => {
    const upstream = makeAccumulatedExecNode("up", "generate-image")
    const start = makeAccumulatedExecNode("start", "image-to-video")
    const downstream = makeAccumulatedExecNode("down", "text-to-speech")
    mockCollapseExpandedClones.mockReturnValue({
      nodes: [upstream, start, downstream],
      edges: [
        { id: "e1", source: "up", target: "start" },
        { id: "e2", source: "start", target: "down" },
      ],
    })

    const ctx = makeCtx()
    await handleRunFromHere("start", ctx, "p1", vi.fn().mockResolvedValue(undefined), vi.fn())

    // With preserveHistory, generatedResults is NOT cleared on subset nodes —
    // the new run prepends to existing history via syncNodeStatesToStore.
    const patchedIds = mockUpdateNodeData.mock.calls
      .filter((c: any[]) => c[1]?.generatedResults !== undefined)
      .map((c: any[]) => c[0])
    expect(patchedIds).not.toContain("up")
    expect(patchedIds).not.toContain("start")
    expect(patchedIds).not.toContain("down")
  })
})
