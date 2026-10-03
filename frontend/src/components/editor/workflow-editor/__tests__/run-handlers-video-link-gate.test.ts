// Every Run path passes the video-link gate: after the confirm, before any
// mutation, and a refusal stops the run cold. Three of the four handlers execute
// on the SERVER from the saved workflow, so a handler that forgets the gate
// hands a web page to a video node — this file is the net for a fifth handler.
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest"

const mockMarkNodesStatus = vi.fn()
const mockExecuteNode = vi.fn()
const mockRunWorkflow = vi.fn()
const mockCollapseExpandedClones = vi.fn()
const mockGate = vi.fn()
let mockNodes: any[] = []
let mockEdges: any[] = []

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: mockNodes,
      edges: mockEdges,
      updateNodeData: vi.fn(),
      markNodesStatus: mockMarkNodesStatus,
      isDirty: true,
      workflowId: "wf-mock-1",
    }),
  },
}))

vi.mock("@/lib/api", () => ({
  getJobStatusLean: vi.fn(),
  getUserCredits: vi.fn(),
  runWorkflow: (...args: unknown[]) => mockRunWorkflow(...args),
  getWorkflowExecution: vi.fn(),
  streamWorkflowExecution: vi.fn(() => () => {}),
  withDedupRaceRetry: <T,>(fn: () => Promise<T>) => fn(),
  WorkflowAlreadyRunningError: class extends Error { executionId = "" },
  NodaroConnectionRequiredError: class extends Error {},
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }),
}))
vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => false }))
vi.mock("@/lib/query-client", () => ({ queryClient: { fetchQuery: vi.fn() } }))
vi.mock("@/lib/query-keys", () => ({ queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } } }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))

vi.mock("../types", () => ({
  MAX_CONSECUTIVE_POLL_FAILURES: 5,
  updateAwaitingReviewIfChanged: vi.fn(),
  NODE_CREDIT_COSTS: {} as Record<string, number>,
  isExecutableNode: (n: any) => n.type === "video-to-video" || n.type === "generate-image",
  getFanOutMultiplier: () => 1,
}))

vi.mock("../execution-graph", () => ({
  buildExecutionLevels: vi.fn(() => []),
  getEffectivelySkippedIds: vi.fn(() => new Set()),
  collapseExpandedClones: (...args: unknown[]) => mockCollapseExpandedClones(...args),
}))
vi.mock("../node-input-resolver", () => ({
  getListInputForNode: vi.fn(() => null),
  getListFanOutForNode: vi.fn(() => undefined),
}))
vi.mock("../execute-node", () => ({
  executeNode: (...args: unknown[]) => mockExecuteNode(...args),
  rejectAllManualEdits: vi.fn(),
}))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn(), expandLoopResults: vi.fn() }))

vi.mock("../video-link-run-gate", () => ({
  ensureVideoLinksBeforeRun: (...args: unknown[]) => mockGate(...args),
}))

import { detachActiveWorkflowStream, handleRun, handleRunSingleNode, handleRunFromHere, handleRunSelected } from "../run-handlers"

// A Run started by a test leaves the module's stream slot taken; the next test
// would meet a run "already followed" and its Run would (rightly) refuse.
afterEach(() => detachActiveWorkflowStream())

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (i: unknown) => i,
    untrackInterval: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
    setInsufficientCreditsData: vi.fn(),
    ...overrides,
  } as any
}

const node = (id: string, type: string, extras: Record<string, unknown> = {}) => ({
  id, type, position: { x: 0, y: 0 }, data: { label: type }, ...extras,
})
const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target })

beforeEach(() => {
  vi.clearAllMocks()
  mockNodes = [node("link", "youtube-video"), node("a", "video-to-video"), node("b", "video-to-video", { selected: true })]
  mockEdges = [edge("link", "a"), edge("a", "b")]
  mockCollapseExpandedClones.mockImplementation(() => ({ nodes: mockNodes, edges: mockEdges }))
  mockExecuteNode.mockResolvedValue(undefined)
  mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })
  mockGate.mockResolvedValue(true)
})

describe("the video-link gate sits in front of every Run path", () => {
  it("Execute-All: gated on every executable node", async () => {
    const setIsRunning = vi.fn()
    await handleRun(makeCtx(), "p1", "wf-1", vi.fn().mockResolvedValue(undefined), setIsRunning)
    expect(mockGate).toHaveBeenCalledWith(["a", "b"], setIsRunning)
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
  })

  it("Run-from-here: gated on the downstream scope", async () => {
    const setIsRunning = vi.fn()
    await handleRunFromHere("b", makeCtx(), "p1", vi.fn().mockResolvedValue(undefined), setIsRunning)
    expect(mockGate).toHaveBeenCalledWith(["b"], setIsRunning)
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
  })

  it("Run-selected: gated on the selection", async () => {
    const setIsRunning = vi.fn()
    await handleRunSelected(makeCtx(), "p1", vi.fn().mockResolvedValue(undefined), setIsRunning)
    expect(mockGate).toHaveBeenCalledWith(["b"], setIsRunning)
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
  })

  it("Single node: gated on that node", async () => {
    const setIsRunning = vi.fn()
    await handleRunSingleNode("a", makeCtx(), "p1", vi.fn().mockResolvedValue(undefined), setIsRunning, { current: new Set() })
    expect(mockGate).toHaveBeenCalledWith(["a"], setIsRunning)
    expect(mockExecuteNode).toHaveBeenCalledTimes(1)
  })

  it("a refusal stops every path BEFORE it touches anything — no pending flip, no save, no run", async () => {
    mockGate.mockResolvedValue(false)
    const save = vi.fn().mockResolvedValue(undefined)
    const setIsRunning = vi.fn()
    await handleRun(makeCtx(), "p1", "wf-1", save, setIsRunning)
    await handleRunFromHere("b", makeCtx(), "p1", save, setIsRunning)
    await handleRunSelected(makeCtx(), "p1", save, setIsRunning)
    await handleRunSingleNode("a", makeCtx(), "p1", save, setIsRunning, { current: new Set() })

    expect(mockGate).toHaveBeenCalledTimes(4)
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(mockExecuteNode).not.toHaveBeenCalled()
    expect(mockMarkNodesStatus).not.toHaveBeenCalled()
    expect(mockCollapseExpandedClones).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(setIsRunning).not.toHaveBeenCalled()
  })

  it("a cancelled confirm never reaches the gate — Cancel downloads nothing", async () => {
    const confirmRun = vi.fn().mockResolvedValue(false)
    await handleRun(makeCtx({ confirmRun }), "p1", "wf-1", vi.fn(), vi.fn())
    expect(confirmRun).toHaveBeenCalled()
    expect(mockGate).not.toHaveBeenCalled()
  })

  it("the file is written BEFORE the pre-run save — the server reads the saved workflow", async () => {
    const order: string[] = []
    mockGate.mockImplementation(async () => { order.push("gate"); return true })
    const save = vi.fn(async () => { order.push("save") })
    mockRunWorkflow.mockImplementation(async () => { order.push("run"); return { executionId: "exec-1" } })
    await handleRun(makeCtx(), "p1", "wf-1", save, vi.fn())
    expect(order).toEqual(["gate", "save", "run"])
  })
})
