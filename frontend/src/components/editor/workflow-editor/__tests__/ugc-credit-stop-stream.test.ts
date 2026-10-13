import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// A server run that stops UGC Creator for want of credits opens the buy-credits
// dialog — once per run, with the refusing route's numbers — while the run is
// followed (streamBackendExecution's applyStates).

const mockStreamWorkflowExecution = vi.fn()
const mockGetWorkflowExecution = vi.fn()
let mockNodes: Array<{ id: string; type?: string; data: Record<string, unknown> }> = []

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ nodes: mockNodes, edges: [], updateNodeData: vi.fn() }),
    setState: (updater: unknown) => {
      const next =
        typeof updater === "function"
          ? (updater as (s: { nodes: typeof mockNodes }) => { nodes?: typeof mockNodes })({ nodes: mockNodes })
          : (updater as { nodes?: typeof mockNodes })
      if (next?.nodes) mockNodes = next.nodes
    },
  },
}))
vi.mock("@/lib/api", () => ({
  getJobStatusLean: vi.fn(),
  getUserCredits: vi.fn(),
  getWorkflowExecution: (...args: unknown[]) => mockGetWorkflowExecution(...args),
  streamWorkflowExecution: (...args: unknown[]) => mockStreamWorkflowExecution(...args),
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }) }))
vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/lib/query-client", () => ({ queryClient: { fetchQuery: vi.fn(), getQueryData: () => ({ tier: "pro" }) } }))
vi.mock("@/lib/query-keys", () => ({ queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } } }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))
vi.mock("../types", () => ({
  WorkflowStaleError: class WorkflowStaleError extends Error {},
  MAX_CONSECUTIVE_POLL_FAILURES: 20,
  NODE_CREDIT_COSTS: {} as Record<string, number>,
  isExecutableNode: () => true,
}))
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: vi.fn().mockReturnValue([]),
  getEffectivelySkippedIds: vi.fn().mockReturnValue(new Set()),
  collapseExpandedClones: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
}))
vi.mock("../node-input-resolver", () => ({ getListInputForNode: vi.fn().mockReturnValue(null), getListFanOutForNode: vi.fn().mockReturnValue(undefined) }))
vi.mock("../execute-node", () => ({ executeNode: vi.fn().mockResolvedValue(undefined), rejectAllManualEdits: vi.fn() }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn().mockResolvedValue(undefined), expandLoopResults: vi.fn() }))
vi.mock("../clear-run-results", () => ({ clearedConnectedListRows: () => null }))

import { streamBackendExecution, teardownActiveWorkflowStream } from "../run-handlers"
import type { ExecutionContext } from "../types"

const makeCtx = () => ({
  userId: "u1",
  projectId: "p1",
  trackInterval: (i: unknown) => i,
  untrackInterval: vi.fn(),
  save: vi.fn(),
  setIsRunning: vi.fn(),
  isWorkflowStale: () => false,
  isStorageError: () => false,
  setShowStorageExceeded: vi.fn(),
  setStorageExceededData: vi.fn(),
  setShowInsufficientCredits: vi.fn(),
  setInsufficientCreditsData: vi.fn(),
})

const STOPPED = {
  status: "failed", nodeType: "ugc-creator", error: "Insufficient credits", errorCode: "insufficient_credits",
  startedAt: "2026-10-05T10:00:00.000Z", completedAt: "2026-10-05T10:00:20.000Z",
  output: { ugcCandidates: [{ imageUrl: "https://cdn.example/a.png", record: { v: 1 } }], ugcShortfall: { required: 18, balance: 5 } },
}

function tick(states: Record<string, unknown>) {
  const calls = mockStreamWorkflowExecution.mock.calls
  const callbacks = calls[calls.length - 1]?.[1] as { onNodeStatesChanged?: (s: Record<string, unknown>) => void }
  callbacks.onNodeStatesChanged?.(states)
}

describe("a server run's credits stop at UGC Creator", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    teardownActiveWorkflowStream()
    mockNodes = [{ id: "creator", type: "ugc-creator", data: { label: "UGC Creator", executionStatus: "running" } }]
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", nodeStates: {} })
  })
  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  it("opens the buy-credits dialog once, with the route's numbers, however often the state is painted", () => {
    const ctx = makeCtx()
    streamBackendExecution("exec-1", ctx as unknown as ExecutionContext, vi.fn())
    tick({ creator: STOPPED })
    tick({ creator: STOPPED })
    expect(ctx.setInsufficientCreditsData).toHaveBeenCalledTimes(1)
    expect(ctx.setInsufficientCreditsData).toHaveBeenCalledWith({ required: 18, available: 5, tier: "pro" })
    expect(ctx.setShowInsufficientCredits).toHaveBeenCalledTimes(1)
    expect(ctx.setShowInsufficientCredits).toHaveBeenCalledWith(true)
  })

  it("a stop that names no numbers (a deployment payer withholds the balance) opens nothing", () => {
    const ctx = makeCtx()
    streamBackendExecution("exec-1", ctx as unknown as ExecutionContext, vi.fn())
    tick({ creator: { ...STOPPED, output: { ugcCandidates: STOPPED.output.ugcCandidates } } })
    expect(ctx.setShowInsufficientCredits).not.toHaveBeenCalled()
  })
})
