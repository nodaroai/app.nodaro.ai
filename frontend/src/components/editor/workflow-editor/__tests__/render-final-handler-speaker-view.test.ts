import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { translate } from "@/lib/i18n"

/**
 * Render final and Update preview on a Speaker View (C3.4): while it has no
 * price (C4) neither runs — the click says why and stops before the rule, the
 * newer-run check, the confirm, the save or the run, as the server's preflight
 * would refuse the same run. Apply EDL is untouched by the refusal.
 */
const mockToastError = vi.fn()
const mockToastInfo = vi.fn()
const mockRunWorkflow = vi.fn()
const mockMarkNodesStatus = vi.fn()
const mockCollapseExpandedClones = vi.fn()
const mockEstimateRunCredits = vi.fn()
const mockEstimateRunCreditLines = vi.fn()
const mockFetchQuery = vi.fn()
const mockRule = vi.fn()
const mockNewerPatches = vi.fn()
const mockUnchanged = vi.fn()
const mockListExecutions = vi.fn()
const mockUpdateNodeData = vi.fn()
const mockGate = vi.fn()
const mockToastWarning = vi.fn()
const mockSetRenderCheck = vi.fn()
type TestNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
let mockNodes: TestNode[] = []
let mockEdges: unknown[] = []
let mockDirty = false

vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn(), info: (...a: unknown[]) => mockToastInfo(...a), warning: (...a: unknown[]) => mockToastWarning(...a) },
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: mockNodes, edges: mockEdges,
      updateNodeData: (...a: unknown[]) => mockUpdateNodeData(...a),
      markNodesStatus: (...a: unknown[]) => mockMarkNodesStatus(...a),
      setRenderCheck: (...a: unknown[]) => mockSetRenderCheck(...a),
      isDirty: mockDirty, workflowId: "wf-1", isReadOnly: false,
    }),
  },
}))
class MockAlreadyRunning extends Error { executionId = "exec-live" }
vi.mock("@/lib/api", () => ({
  getJobStatusLean: vi.fn(),
  getJobStatus: vi.fn(),
  getUserCredits: vi.fn(),
  runWorkflow: (...a: unknown[]) => mockRunWorkflow(...a),
  getWorkflowExecution: vi.fn().mockResolvedValue({ triggerType: "manual", nodeStates: {} }),
  listWorkflowExecutions: (...a: unknown[]) => mockListExecutions(...a),
  streamWorkflowExecution: vi.fn(() => new Promise(() => {})),
  withDedupRaceRetry: <T,>(fn: () => Promise<T>) => fn(),
  WorkflowAlreadyRunningError: MockAlreadyRunning,
}))
vi.mock("@/hooks/use-workflow-persistence", () => ({
  TERMINAL_RESTORABLE_STATUSES: "completed,failed",
  restoreEndedEditorRun: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }) }))
vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/lib/query-client", () => ({
  queryClient: { fetchQuery: (...a: unknown[]) => mockFetchQuery(...a), getQueryData: () => undefined },
}))
vi.mock("@/lib/query-keys", () => ({ queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } } }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))
vi.mock("../estimate-run-credits", () => ({
  estimateRunCredits: (...a: unknown[]) => mockEstimateRunCredits(...a),
  estimateRunCreditLines: (...a: unknown[]) => mockEstimateRunCreditLines(...a),
  sumRunCreditLines: (lines: readonly { credits: number }[]) => lines.reduce((s, l) => s + l.credits, 0),
  runNodeLabel: (n: { type?: string; data?: { label?: unknown } }) => (typeof n.data?.label === "string" ? n.data.label : n.type ?? ""),
}))
vi.mock("../types", () => ({
  WorkflowStaleError: class extends Error {},
  MAX_CONSECUTIVE_POLL_FAILURES: 5,
  updateAwaitingReviewIfChanged: () => {},
  NODE_CREDIT_COSTS: {} as Record<string, number>,
  isExecutableNode: (n: { type?: string }) => n.type !== "upload-video",
  SERVER_RUN_ONLY_TYPES: new Set<string>(),
  getFanOutMultiplier: () => 1,
}))
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: vi.fn(() => []),
  getEffectivelySkippedIds: vi.fn(() => new Set()),
  collapseExpandedClones: (...a: unknown[]) => mockCollapseExpandedClones(...a),
}))
vi.mock("../node-input-resolver", () => ({ getListInputForNode: () => null, getListFanOutForNode: () => undefined }))
vi.mock("../execute-node", () => ({ executeNode: vi.fn(), rejectAllManualEdits: vi.fn() }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn(), expandLoopResults: vi.fn() }))
vi.mock("../sub-workflow-preflight", () => ({ nestedRunPreflight: vi.fn().mockResolvedValue(null) }))
vi.mock("../video-link-run-gate", () => ({ ensureVideoLinksBeforeRun: (...a: unknown[]) => mockGate(...a) }))
vi.mock("../render-final-checks", () => ({
  renderRuleVerdict: (...a: unknown[]) => mockRule(...a),
  newerRunPatches: (...a: unknown[]) => mockNewerPatches(...a),
  finalIsUnchanged: (...a: unknown[]) => mockUnchanged(...a),
}))

const { handleRenderFinal } = await import("../render-final-handler")
const { detachActiveWorkflowStream, RUN_CONFIRM_CREDITS } = await import("../run-handlers")

afterEach(() => {
  vi.useRealTimers()
  detachActiveWorkflowStream()
  delete window.__NODARO_RUNTIME__
})

const n = (id: string, type: string, data: Record<string, unknown> = {}): TestNode => ({
  id, type, position: { x: 0, y: 0 }, data: { label: id, ...data },
})
const PLAN = n("plan", "edit-plan")
const VIEW = n("view", "speaker-view", { quality: "proxy" })
const CUT = n("cut", "apply-edl", { quality: "proxy" })
const EDGES = [
  { id: "a", source: "plan", target: "view", targetHandle: "edl" },
  { id: "b", source: "plan", target: "cut", targetHandle: "edl" },
]
const ctx = () => ({
  userId: "u1", projectId: "p1",
  trackInterval: (i: unknown) => i, untrackInterval: vi.fn(),
  save: vi.fn(), setIsRunning: vi.fn(),
  isWorkflowStale: () => false, isStorageError: () => false,
  setShowStorageExceeded: vi.fn(), setStorageExceededData: vi.fn(),
  setShowInsufficientCredits: vi.fn(), setInsufficientCreditsData: vi.fn(),
  confirmRun: vi.fn().mockResolvedValue(true),
})

beforeEach(() => {
  vi.clearAllMocks()
  window.__NODARO_RUNTIME__ = { previewStopRule: true }
  mockDirty = false
  mockNodes = [PLAN, VIEW, CUT]
  mockEdges = EDGES
  mockCollapseExpandedClones.mockImplementation(() => ({ nodes: mockNodes, edges: mockEdges }))
  mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })
  mockFetchQuery.mockResolvedValue({ total: 100_000, tier: "pro" })
  mockEstimateRunCredits.mockReturnValue(0)
  mockEstimateRunCreditLines.mockReturnValue([])
  mockRule.mockReturnValue({ ok: true })
  mockNewerPatches.mockReturnValue({})
  mockUnchanged.mockResolvedValue(false)
  mockListExecutions.mockResolvedValue({ data: [] })
  mockGate.mockResolvedValue(true)
})

describe("Render final on a Speaker View that is not priced yet", () => {
  it.each(["final", "proxy"] as const)("%s: says why and stops before any check, save or run", async (kind) => {
    const save = vi.fn().mockResolvedValue({ success: true })
    await handleRenderFinal("view", kind, ctx() as never, "p1", save, vi.fn())
    expect(mockToastError).toHaveBeenCalledWith(translate("en", "speakerView.notPriced"))
    expect(mockRule).not.toHaveBeenCalled()
    expect(mockListExecutions).not.toHaveBeenCalled()
    expect(mockSetRenderCheck).not.toHaveBeenCalled()
    expect(mockMarkNodesStatus).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("Apply EDL beside it still renders its final", async () => {
    await handleRenderFinal("cut", "final", ctx() as never, "p1", vi.fn().mockResolvedValue({ success: true }), vi.fn())
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
  })
})
