// A Tighten Episode node's Continue (decided 2026-10-13) is a run option of the
// click's run only (handleRunSingleNode → executeNode's argument → the
// executor), never written on the node: a click that never starts — the price
// confirm declined, the balance refused, a pre-run check refusing it — leaves
// nothing that could turn the next plain Run into a continuation of an old run.
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest"

const mockMarkNodesStatus = vi.fn()
const mockExecuteNode = vi.fn()
const mockRunWorkflow = vi.fn()
const mockCollapseExpandedClones = vi.fn()
const mockGate = vi.fn()
const mockUpdateNodeData = vi.fn()
let mockNodes: any[] = []
let mockEdges: any[] = []

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: mockNodes,
      edges: mockEdges,
      updateNodeData: mockUpdateNodeData,
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
const pricing = vi.hoisted(() => ({ credits: false, figure: 0 }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => pricing.credits }))
vi.mock("../ugc-run-estimate", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  runCreditsWithUgc: async () => ({ credits: pricing.figure }),
  ugcRunParts: () => null,
}))
vi.mock("@/lib/query-client", () => ({ queryClient: { fetchQuery: vi.fn() } }))
vi.mock("@/lib/query-keys", () => ({ queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } } }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))

vi.mock("../types", () => ({
  MAX_CONSECUTIVE_POLL_FAILURES: 5,
  updateAwaitingReviewIfChanged: vi.fn(),
  NODE_CREDIT_COSTS: {} as Record<string, number>,
  isExecutableNode: (n: any) => n.type === "tighten-episode",
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

import { handleRunSingleNode } from "../run-handlers"

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

const CONTINUE = { mode: "from-failed", jobId: "job-0" } as const
const run = (opts?: Parameters<typeof handleRunSingleNode>[6]) =>
  handleRunSingleNode("t1", makeCtx(), "p1", vi.fn().mockResolvedValue(undefined), vi.fn(), { current: new Set() }, opts)
const wroteContinuation = () =>
  mockUpdateNodeData.mock.calls.some(([, patch]) => patch && typeof patch === "object" && "useCaseContinue" in (patch as object))

beforeEach(() => {
  vi.clearAllMocks()
  pricing.credits = false
  mockNodes = [{ id: "t1", type: "tighten-episode", position: { x: 0, y: 0 }, data: { label: "Tighten Episode", useCaseJobId: "job-0", executionStatus: "failed" } }]
  mockEdges = []
  mockExecuteNode.mockResolvedValue(undefined)
  mockGate.mockResolvedValue(true)
})

describe("a Tighten Episode Continue is that run's option, never node data", () => {
  it("a Continue that runs hands the continuation to the node's executor as an argument — one run, never a fan-out", async () => {
    expect(await run({ usecaseContinue: CONTINUE })).toBe(true)
    expect(mockExecuteNode).toHaveBeenCalledTimes(1)
    const args = mockExecuteNode.mock.calls[0]!
    expect(args[8]).toEqual({ usecaseContinue: CONTINUE })
    expect(wroteContinuation()).toBe(false)
  })

  it("a Continue whose run never starts (a check refuses it after the click) leaves nothing behind: the next Run is a fresh run", async () => {
    // Every early return of the ▶ — a declined price confirm, a refused balance,
    // a refused pre-run check, a canvas gone read-only — ends before the executor.
    mockGate.mockResolvedValueOnce(false)
    expect(await run({ usecaseContinue: CONTINUE })).toBe(false)
    expect(mockExecuteNode).not.toHaveBeenCalled()
    expect(wroteContinuation()).toBe(false)
    expect(mockNodes[0].data).not.toHaveProperty("useCaseContinue")

    expect(await run()).toBe(true)
    expect(mockExecuteNode).toHaveBeenCalledTimes(1)
    expect(mockExecuteNode.mock.calls[0]![8]).toBeUndefined()
  })

  it("a declined price confirm: the same — no continuation survives the click", async () => {
    // An episode costs more than the confirm threshold: the ▶ asks first.
    pricing.credits = true
    pricing.figure = 5000
    const confirmRun = vi.fn().mockResolvedValue(false)
    const declined = await handleRunSingleNode("t1", makeCtx({ confirmRun }), "p1", vi.fn(), vi.fn(), { current: new Set() }, { usecaseContinue: CONTINUE })
    expect(confirmRun).toHaveBeenCalledTimes(1)
    expect(declined).toBe(false)
    expect(mockExecuteNode).not.toHaveBeenCalled()
    expect(wroteContinuation()).toBe(false)
    // The next ▶, confirmed: a fresh run.
    const ok = await handleRunSingleNode("t1", makeCtx({ confirmRun: vi.fn().mockResolvedValue(true) }), "p1", vi.fn(), vi.fn(), { current: new Set() })
    expect(ok).toBe(true)
    expect(mockExecuteNode).toHaveBeenCalledTimes(1)
    expect(mockExecuteNode.mock.calls[0]![8]).toBeUndefined()
  })
})
