// "Run up to here": the same partial-run machinery as "Run from here" (one
// runWorkflow with a node-id subset), over the upstream nodes that have not run,
// behind the run-confirm dialog (above the spend threshold, as Run from here),
// with the node itself left out.
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest"

const mockMarkNodesStatus = vi.fn()
const mockRunWorkflow = vi.fn()
const mockCollapseExpandedClones = vi.fn()
const mockGate = vi.fn()
const mockToastInfo = vi.fn()
const mockToastError = vi.fn()
let mockNodes: any[] = []
let mockEdges: any[] = []

vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn(), info: (...a: unknown[]) => mockToastInfo(...a) } }))

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
const mockHasCredits = vi.fn(() => false)
vi.mock("@/lib/edition", () => ({ hasCredits: () => mockHasCredits() }))
vi.mock("@/lib/query-client", () => ({ queryClient: { fetchQuery: vi.fn() } }))
vi.mock("@/lib/query-keys", () => ({ queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } } }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))

vi.mock("../types", () => ({
  MAX_CONSECUTIVE_POLL_FAILURES: 5,
  updateAwaitingReviewIfChanged: vi.fn(),
  NODE_CREDIT_COSTS: {} as Record<string, number>,
  isExecutableNode: (n: any) => n.type === "generate-image" || n.type === "apply-edl",
  getFanOutMultiplier: () => 1,
  getCostMultiplier: () => 1,
  getCostFactors: () => ({ fanOut: 1, units: 1, unitKind: null }),
}))

// The real saved-output reader (it decides which upstream nodes "have run"); the
// rest of the graph module is stubbed like the other handler suites do.
vi.mock("../execution-graph", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildExecutionLevels: vi.fn(() => []),
  getEffectivelySkippedIds: vi.fn(() => new Set()),
  collapseExpandedClones: (...args: unknown[]) => mockCollapseExpandedClones(...args),
}))
vi.mock("../node-input-resolver", () => ({
  getListInputForNode: vi.fn(() => null),
  getListFanOutForNode: vi.fn(() => undefined),
}))
vi.mock("../execute-node", () => ({ executeNode: vi.fn(), rejectAllManualEdits: vi.fn() }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn(), expandLoopResults: vi.fn() }))
vi.mock("../video-link-run-gate", () => ({
  ensureVideoLinksBeforeRun: (...args: unknown[]) => mockGate(...args),
}))

import { getCachedCredits } from "@/ee/hooks/use-model-credits"
import { detachActiveWorkflowStream, handleRunUpToHere, RUN_CONFIRM_CREDITS } from "../run-handlers"

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

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target })
const ranImage = { generatedResults: [{ url: "https://cdn/x.png" }], activeResultIndex: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  // a -> b -> c, and c -> d downstream of the node asked about.
  mockNodes = [node("a", "generate-image"), node("b", "generate-image"), node("c", "apply-edl"), node("d", "generate-image")]
  mockEdges = [edge("a", "b"), edge("b", "c"), edge("c", "d")]
  mockCollapseExpandedClones.mockImplementation(() => ({ nodes: mockNodes, edges: mockEdges }))
  mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })
  mockGate.mockResolvedValue(true)
  mockHasCredits.mockReturnValue(false)
  vi.mocked(getCachedCredits).mockReset()
})

const save = () => vi.fn().mockResolvedValue(undefined)

describe("handleRunUpToHere", () => {
  it("runs the upstream nodes that have not run, as one subset run, and not the node itself", async () => {
    await handleRunUpToHere("c", makeCtx(), "p1", save(), vi.fn())
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    const [workflowId, ids] = mockRunWorkflow.mock.calls[0]!
    expect(workflowId).toBe("wf-mock-1")
    expect([...(ids as string[])].sort()).toEqual(["a", "b"])
  })

  it("marks only the nodes it runs as pending, never the node itself or what follows it", async () => {
    await handleRunUpToHere("c", makeCtx(), "p1", save(), vi.fn())
    expect(mockMarkNodesStatus).toHaveBeenCalledWith(["a", "b"], "pending")
    const marked = mockMarkNodesStatus.mock.calls.flatMap((c) => c[0] as string[])
    expect(marked).not.toContain("c")
    expect(marked).not.toContain("d")
  })

  it("leaves out an upstream node that already holds its output", async () => {
    mockNodes[1] = node("b", "generate-image", ranImage)
    await handleRunUpToHere("c", makeCtx(), "p1", save(), vi.fn())
    expect(mockToastInfo).toHaveBeenCalledWith("Nothing upstream needs to run.")
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  // Decided 2026-10-08: the same spend-threshold rule as Run from here. One
  // upstream node (a -> c) so the estimate is exactly that node's price.
  describe("the confirm follows the spend threshold", () => {
    beforeEach(() => {
      mockNodes = [node("a", "generate-image"), node("c", "apply-edl")]
      mockEdges = [edge("a", "c")]
      mockHasCredits.mockReturnValue(true)
    })

    it("asks above the threshold, and a Cancel starts nothing", async () => {
      vi.mocked(getCachedCredits).mockReturnValue(RUN_CONFIRM_CREDITS + 1)
      const confirmRun = vi.fn().mockResolvedValue(false)
      await handleRunUpToHere("c", makeCtx({ confirmRun }), "p1", save(), vi.fn())
      expect(confirmRun).toHaveBeenCalledWith(
        expect.objectContaining({ trigger: "up-to-here", alwaysConfirm: false, nodeCount: 1, estimatedCredits: RUN_CONFIRM_CREDITS + 1 }),
      )
      expect(mockRunWorkflow).not.toHaveBeenCalled()
      expect(mockMarkNodesStatus).not.toHaveBeenCalled()
    })

    it("does not ask at exactly the threshold, and runs", async () => {
      vi.mocked(getCachedCredits).mockReturnValue(RUN_CONFIRM_CREDITS)
      const confirmRun = vi.fn().mockResolvedValue(false)
      await handleRunUpToHere("c", makeCtx({ confirmRun }), "p1", save(), vi.fn())
      expect(confirmRun).not.toHaveBeenCalled()
      expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    })

    it("does not ask for a cheap run, and runs", async () => {
      vi.mocked(getCachedCredits).mockReturnValue(1)
      const confirmRun = vi.fn().mockResolvedValue(false)
      await handleRunUpToHere("c", makeCtx({ confirmRun }), "p1", save(), vi.fn())
      expect(confirmRun).not.toHaveBeenCalled()
      expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    })

    it("does not ask on an edition with no credits", async () => {
      mockHasCredits.mockReturnValue(false)
      const confirmRun = vi.fn().mockResolvedValue(false)
      await handleRunUpToHere("c", makeCtx({ confirmRun }), "p1", save(), vi.fn())
      expect(confirmRun).not.toHaveBeenCalled()
      expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    })
  })

  it("starts the run once the confirm says yes", async () => {
    mockHasCredits.mockReturnValue(true)
    vi.mocked(getCachedCredits).mockReturnValue(RUN_CONFIRM_CREDITS + 1)
    const confirmRun = vi.fn().mockResolvedValue(true)
    await handleRunUpToHere("c", makeCtx({ confirmRun }), "p1", save(), vi.fn())
    expect(confirmRun).toHaveBeenCalledTimes(1)
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
  })

  it("passes the video-link gate over the nodes it runs", async () => {
    const setIsRunning = vi.fn()
    await handleRunUpToHere("c", makeCtx(), "p1", save(), setIsRunning)
    expect(mockGate).toHaveBeenCalledWith(["a", "b"], setIsRunning)
  })

  it("a refused video-link gate stops the run cold", async () => {
    mockGate.mockResolvedValue(false)
    await handleRunUpToHere("c", makeCtx(), "p1", save(), vi.fn())
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(mockMarkNodesStatus).not.toHaveBeenCalled()
  })

  it("says so when there is nothing upstream at all", async () => {
    await handleRunUpToHere("a", makeCtx(), "p1", save(), vi.fn())
    expect(mockToastInfo).toHaveBeenCalledWith("Nothing upstream needs to run.")
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("reports the number of nodes to run", async () => {
    await handleRunUpToHere("c", makeCtx(), "p1", save(), vi.fn())
    expect(mockToastInfo).toHaveBeenCalledWith("Running up to here...", expect.objectContaining({ description: "2 node(s) to run" }))
  })
})
