import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The RUN-level word-timings refusal has to see NESTED graphs.
 *
 * `wordTimingsPreflight` only inspects the graph it is handed, so a
 * transcribe(whisper) → add-captions chain living inside a referenced workflow
 * passed every gate: the parent's upstream nodes executed and billed, and the
 * run was refused mid-flight when the sub-workflow opened. The contract the docs
 * state is "the run does not start: nothing executes and nothing is billed", so
 * the nested walk runs in the SAME funnel all four run triggers pass through,
 * before any mutation.
 */

const mockToastError = vi.fn()
const mockExecuteNode = vi.fn()
const mockBuildExecutionLevels = vi.fn()
const mockGetEffectivelySkippedIds = vi.fn()
const mockCollapseExpandedClones = vi.fn()
const mockRunWorkflow = vi.fn()
const mockFetchQuery = vi.fn()
const mockEstimateRunCredits = vi.fn()
const mockNestedPreflight = vi.fn()
type TestNode = { id: string; type: string; position: { x: number; y: number }; data: { label: string } }
let mockNodes: TestNode[] = []
let mockEdges: unknown[] = []

vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn(), info: vi.fn() } }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: mockNodes, edges: mockEdges,
      updateNodeData: vi.fn(), markNodesStatus: vi.fn(),
      isDirty: false, workflowId: "wf-1",
    }),
  },
}))
vi.mock("@/lib/api", () => ({
  getJobStatusLean: vi.fn(),
  getUserCredits: vi.fn(),
  runWorkflow: (...a: unknown[]) => mockRunWorkflow(...a),
  getWorkflowExecution: vi.fn(),
  withDedupRaceRetry: <T,>(fn: () => Promise<T>) => fn(),
  WorkflowAlreadyRunningError: class extends Error {},
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }) }))
vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/lib/query-client", () => ({
  queryClient: { fetchQuery: (...a: unknown[]) => mockFetchQuery(...a), getQueryData: () => undefined },
}))
vi.mock("@/lib/query-keys", () => ({ queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } } }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))
vi.mock("../estimate-run-credits", () => ({ estimateRunCredits: (...a: unknown[]) => mockEstimateRunCredits(...a) }))
vi.mock("../types", () => ({
  WorkflowStaleError: class extends Error {},
  MAX_CONSECUTIVE_POLL_FAILURES: 5,
  updateAwaitingReviewIfChanged: () => {},
  NODE_CREDIT_COSTS: { "sub-workflow": 0 } as Record<string, number>,
  isExecutableNode: (n: { type?: string }) => n.type === "sub-workflow",
  getFanOutMultiplier: () => 1,
}))
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: (...a: unknown[]) => mockBuildExecutionLevels(...a),
  getEffectivelySkippedIds: (...a: unknown[]) => mockGetEffectivelySkippedIds(...a),
  collapseExpandedClones: (...a: unknown[]) => mockCollapseExpandedClones(...a),
}))
vi.mock("../node-input-resolver", () => ({ getListInputForNode: () => null, getListFanOutForNode: () => undefined }))
vi.mock("../execute-node", () => ({ executeNode: (...a: unknown[]) => mockExecuteNode(...a), rejectAllManualEdits: vi.fn() }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn(), expandLoopResults: vi.fn() }))
// The nested walk itself is unit-tested in sub-workflow-preflight.test.ts; here
// it stands in for "a referenced workflow the run must not start".
vi.mock("../sub-workflow-preflight", () => ({
  nestedWordTimingsPreflight: (...a: unknown[]) => mockNestedPreflight(...a),
}))

const { handleRun, detachActiveWorkflowStream } = await import("../run-handlers")

// A Run started by a test leaves the module's stream slot taken; the next test
// would meet a run "already followed" and its Run would refuse without testing anything.
afterEach(() => detachActiveWorkflowStream())

const SUB = { id: "s1", type: "sub-workflow", position: { x: 0, y: 0 }, data: { label: "Captions Route" } }

function makeCtx() {
  return {
    userId: "u1", projectId: "p1",
    trackInterval: (i: unknown) => i, untrackInterval: vi.fn(),
    save: vi.fn(), setIsRunning: vi.fn(),
    isWorkflowStale: () => false, isStorageError: () => false,
    setShowStorageExceeded: vi.fn(), setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(), setInsufficientCreditsData: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockNodes = [SUB]
  mockEdges = []
  mockCollapseExpandedClones.mockReturnValue({ nodes: [SUB], edges: [] })
  mockBuildExecutionLevels.mockReturnValue([[SUB]])
  mockGetEffectivelySkippedIds.mockReturnValue(new Set())
  mockExecuteNode.mockResolvedValue(undefined)
  mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })
  mockFetchQuery.mockResolvedValue({ total: 100_000, tier: "pro" })
  mockEstimateRunCredits.mockReturnValue(10)
  mockNestedPreflight.mockResolvedValue(null)
})

describe("Run all and the nested word-timings refusal", () => {
  it("does not start the run when a referenced workflow holds a wordless transcript chain", async () => {
    mockNestedPreflight.mockResolvedValue('Node "Inner Transcribe": whisper returns no word timings')

    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(mockToastError).toHaveBeenCalledWith('Node "Inner Transcribe": whisper returns no word timings')
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(mockExecuteNode).not.toHaveBeenCalled()
  })

  it("asks about the nodes this run will execute, and runs when they are clean", async () => {
    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())

    expect(mockNestedPreflight).toHaveBeenCalledWith([SUB])
    expect(mockRunWorkflow).toHaveBeenCalled()
  })
})
