import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The editor's enforcement of the preview stop rule (decided 2026-10-04).
 *
 * A single-node ▶ inside a Preview render's closure would consume the
 * preview: it is refused in confirmRunOrAbort's refusal block, ABOVE the
 * skip-confirm shortcut. Run / Run from here / Run selected are never refused
 * — the server skips the closure — but the closure is never flipped to
 * pending. The render's own ▶ stays allowed.
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
const mockMarkNodesStatus = vi.fn()
type TestNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
let mockNodes: TestNode[] = []
let mockEdges: unknown[] = []

vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn(), info: vi.fn() } }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: mockNodes, edges: mockEdges,
      updateNodeData: vi.fn(), markNodesStatus: (...a: unknown[]) => mockMarkNodesStatus(...a),
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
  isExecutableNode: (n: { type?: string }) => n.type !== "upload-video",
  SERVER_RUN_ONLY_TYPES: new Set<string>(),
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
  nestedRunPreflight: (...a: unknown[]) => mockNestedPreflight(...a),
}))

const { handleRun, handleRunSingleNode, detachActiveWorkflowStream } = await import("../run-handlers")

// A Run started by a test leaves the module's stream slot taken; the next test
// would meet a run "already followed" and its Run would refuse without testing anything.
afterEach(() => {
  detachActiveWorkflowStream()
  delete window.__NODARO_RUNTIME__
})

const n = (id: string, type: string, data: Record<string, unknown> = {}): TestNode => ({
  id, type, position: { x: 0, y: 0 }, data: { label: id, ...data },
})
const PLAN = n("plan", "edit-plan")
const CUT = n("cut", "apply-edl", { quality: "proxy" })
const CAP = n("cap", "add-captions")
const EDGES = [
  { id: "a", source: "plan", target: "cut" },
  { id: "b", source: "cut", target: "cap" },
]

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
  // PREVIEW_STOP_RULE_ENABLED on, as /config.js hands it to the editor.
  window.__NODARO_RUNTIME__ = { previewStopRule: true }
  mockNodes = [PLAN, CUT, CAP]
  mockEdges = EDGES
  mockCollapseExpandedClones.mockReturnValue({ nodes: [PLAN, CUT, CAP], edges: EDGES })
  mockBuildExecutionLevels.mockReturnValue([[PLAN], [CUT], [CAP]])
  mockGetEffectivelySkippedIds.mockReturnValue(new Set())
  mockExecuteNode.mockResolvedValue(undefined)
  mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })
  mockFetchQuery.mockResolvedValue({ total: 100_000, tier: "pro" })
  mockEstimateRunCredits.mockReturnValue(10)
  mockNestedPreflight.mockResolvedValue(null)
})

describe("a single-node ▶ inside a Preview render's closure", () => {
  it("is refused with the TA12 copy, even when the confirm is skipped", async () => {
    const ctx = makeCtx()
    await handleRunSingleNode("cap", ctx as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never, { skipConfirm: true })
    expect(mockToastError).toHaveBeenCalledWith("Render final first — this node runs after the final")
    expect(mockExecuteNode).not.toHaveBeenCalled()
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("the render's own ▶ stays allowed", async () => {
    await handleRunSingleNode("cut", makeCtx() as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never)
    expect(mockToastError).not.toHaveBeenCalledWith("Render final first — this node runs after the final")
  })

  it("is allowed once the render is Final", async () => {
    mockNodes = [PLAN, n("cut", "apply-edl", { quality: "final" }), CAP]
    await handleRunSingleNode("cap", makeCtx() as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never)
    expect(mockToastError).not.toHaveBeenCalledWith("Render final first — this node runs after the final")
  })
})

describe("Run never refuses, and never flips the closure to pending", () => {
  it("starts the server run and marks only what it executes", async () => {
    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(mockRunWorkflow).toHaveBeenCalled()
    const pending = mockMarkNodesStatus.mock.calls.find(([, status]) => status === "pending")
    expect(pending?.[0]).toEqual(["plan", "cut"])
  })
})

describe("the run preflights see only what the run executes", () => {
  // cut(proxy) → transcribe(whisper, no word timings) → captions, plus a
  // sub-workflow, all in the gated tail. The server skips the tail, so neither
  // the word-timings check nor the nested walk may refuse the run over it.
  const TR = n("tr", "transcribe", { provider: "whisper" })
  const CAPS = n("caps", "add-captions")
  const SUB = n("sub", "sub-workflow", { workflowId: "wf-child" })
  const TAIL_EDGES = [
    { id: "a", source: "plan", target: "cut" },
    { id: "b", source: "cut", target: "tr" },
    { id: "c", source: "tr", sourceHandle: "json", target: "caps", targetHandle: "transcript" },
    { id: "d", source: "cut", target: "sub" },
  ]

  beforeEach(() => {
    mockNodes = [PLAN, CUT, TR, CAPS, SUB]
    mockEdges = TAIL_EDGES
    mockCollapseExpandedClones.mockReturnValue({ nodes: mockNodes, edges: TAIL_EDGES })
    mockBuildExecutionLevels.mockReturnValue([[PLAN], [CUT], [TR, SUB], [CAPS]])
  })

  it("Run is not refused over a word-incapable transcribe → captions chain in the gated tail", async () => {
    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(JSON.stringify(mockToastError.mock.calls)).not.toMatch(/whisper/)
    expect(mockRunWorkflow).toHaveBeenCalled()
  })

  it("the nested walk is handed only the nodes that run, never a gated sub-workflow", async () => {
    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())
    const walked = (mockNestedPreflight.mock.calls[0]?.[0] ?? []) as Array<{ id: string }>
    expect(walked.map((x) => x.id).sort()).toEqual(["cut", "plan"])
  })

  it("the same chain with the render Final is still refused (nothing gates it)", async () => {
    mockNodes = [PLAN, n("cut", "apply-edl", { quality: "final" }), TR, CAPS, SUB]
    mockCollapseExpandedClones.mockReturnValue({ nodes: mockNodes, edges: TAIL_EDGES })
    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(JSON.stringify(mockToastError.mock.calls)).toMatch(/whisper/)
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })
})

describe("the confirm dialog counts only the nodes the run executes (decided 2026-10-05)", () => {
  it("Run's \"N nodes\" leaves out the gated tail, as the \"N nodes to run\" toast does", async () => {
    const confirmRun = vi.fn().mockResolvedValue(true)
    await handleRun({ ...makeCtx(), confirmRun } as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: "all", nodeCount: 2 }))
  })
})

describe("PREVIEW_STOP_RULE_ENABLED off (production until Render final): the editor as before the rule", () => {
  beforeEach(() => {
    delete window.__NODARO_RUNTIME__
  })

  it("a single-node ▶ past a Preview render is not refused", async () => {
    await handleRunSingleNode("cap", makeCtx() as never, "p1", vi.fn(), vi.fn(), { current: new Set() } as never, { skipConfirm: true })
    expect(mockToastError).not.toHaveBeenCalledWith("Render final first — this node runs after the final")
  })

  it("Run flips every executable node to pending", async () => {
    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())
    const pending = mockMarkNodesStatus.mock.calls.find(([, status]) => status === "pending")
    expect(pending?.[0]).toEqual(["plan", "cut", "cap"])
  })

  it("the confirm dialog counts every executable node", async () => {
    const confirmRun = vi.fn().mockResolvedValue(true)
    await handleRun({ ...makeCtx(), confirmRun } as never, "p1", "wf-1", vi.fn(), vi.fn())
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: "all", nodeCount: 3 }))
  })

  it("the run preflights see the whole set, as before", async () => {
    await handleRun(makeCtx() as never, "p1", "wf-1", vi.fn(), vi.fn())
    const walked = (mockNestedPreflight.mock.calls[0]?.[0] ?? []) as Array<{ id: string }>
    expect(walked.map((x) => x.id).sort()).toEqual(["cap", "cut", "plan"])
  })
})
