import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { editPlanBasis } from "@nodaro/shared/edl"

/**
 * Render final on a use-case node (Tighten Episode, decided 2026-10-13): a
 * continuation of the node's own hidden run, sent as an override of this run
 * only, over the node and everything after it — never the render nodes'
 * quality override, which would re-run the whole node and pay its fee again.
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
const mockUgcEstimate = vi.fn()
const mockRejectAllManualEdits = vi.fn()
/** The query cache a UGC estimate lands in: what `fetchQuery` brought, by key. */
const mockCache = new Map<string, unknown>()
type TestNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
let mockNodes: TestNode[] = []
let mockEdges: unknown[] = []
let mockDirty = false
/** The workflow the store holds: another one once the editor switches in place. */
let mockWorkflowId = "wf-1"

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
      isDirty: mockDirty, workflowId: mockWorkflowId, isReadOnly: false,
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
  ugcEstimateApi: (...a: unknown[]) => mockUgcEstimate(...a),
}))
vi.mock("@/hooks/use-workflow-persistence", () => ({
  TERMINAL_RESTORABLE_STATUSES: "completed,failed",
  restoreEndedEditorRun: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }) }))
vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/lib/query-client", () => ({
  queryClient: {
    fetchQuery: (...a: unknown[]) => mockFetchQuery(...a),
    getQueryData: (key: unknown) => mockCache.get(JSON.stringify(key)),
    getQueryState: (key: unknown) => (mockCache.has(JSON.stringify(key)) ? { data: mockCache.get(JSON.stringify(key)), dataUpdatedAt: Date.now() } : undefined),
  },
}))
vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    credits: { balance: (id: string) => ["credits", "balance", id] },
    ugc: { runEstimate: (request: object) => ["ugc", "run-estimate", request] },
  },
}))
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
const mockFanOut = vi.fn()
vi.mock("../node-input-resolver", () => ({ getListInputForNode: () => null, getListFanOutForNode: (...a: unknown[]) => mockFanOut(...a) }))
vi.mock("../execute-node", () => ({ executeNode: vi.fn(), rejectAllManualEdits: (...a: unknown[]) => mockRejectAllManualEdits(...a) }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn(), expandLoopResults: vi.fn() }))
vi.mock("../sub-workflow-preflight", () => ({ nestedRunPreflight: vi.fn().mockResolvedValue(null) }))
vi.mock("../video-link-run-gate", () => ({ ensureVideoLinksBeforeRun: (...a: unknown[]) => mockGate(...a) }))
vi.mock("../render-final-checks", () => ({
  renderRuleVerdict: (...a: unknown[]) => mockRule(...a),
  newerRunPatches: (...a: unknown[]) => mockNewerPatches(...a),
  finalIsUnchanged: (...a: unknown[]) => mockUnchanged(...a),
}))


const { handleRenderFinal } = await import("../render-final-handler")
const { detachActiveWorkflowStream } = await import("../run-handlers")

afterEach(() => {
  detachActiveWorkflowStream()
  delete window.__NODARO_RUNTIME__
})

const n = (id: string, type: string, data: Record<string, unknown> = {}): TestNode => ({
  id, type, position: { x: 0, y: 0 }, data: { label: id, ...data },
})
const REC = n("rec", "upload-video", { url: "https://r2/ep.mp4" })
const EDIT = { v: 1, kind: "edl", basis: "b", edl: { segments: [], dropped: [] } }
const T1 = n("t1", "tighten-episode", {
  reviewBeforeRender: true, useCaseJobId: "00000000-0000-4000-8000-000000000001", editedEdl: EDIT,
  generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", jobId: "00000000-0000-4000-8000-000000000001" }],
})
const FMT = n("fmt", "social-media-format")
const POST = n("post", "webhook-output")
const EDGES = [
  { id: "a", source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
  { id: "b", source: "t1", target: "fmt", sourceHandle: "media" },
  { id: "c", source: "fmt", target: "post" },
]

function makeCtx(extra: Record<string, unknown> = {}) {
  return {
    userId: "u1", projectId: "p1",
    trackInterval: (i: unknown) => i, untrackInterval: vi.fn(),
    save: vi.fn(), setIsRunning: vi.fn(),
    isWorkflowStale: () => false, isStorageError: () => false,
    setShowStorageExceeded: vi.fn(), setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(), setInsufficientCreditsData: vi.fn(),
    ...extra,
  }
}

const run = (kind: "final" | "proxy", ctx = makeCtx(), save = vi.fn().mockResolvedValue({ success: true })) =>
  handleRenderFinal("t1", kind, ctx as never, "p1", save, vi.fn())

beforeEach(() => {
  vi.clearAllMocks()
  mockCache.clear()
  window.__NODARO_RUNTIME__ = { previewStopRule: true }
  mockDirty = false
  mockWorkflowId = "wf-1"
  mockNodes = [REC, T1, FMT, POST]
  mockEdges = EDGES
  mockFanOut.mockReturnValue(undefined)
  mockCollapseExpandedClones.mockImplementation(() => ({ nodes: mockNodes, edges: mockEdges }))
  mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })
  mockFetchQuery.mockResolvedValue({ total: 100_000, tier: "pro" })
  mockEstimateRunCredits.mockReturnValue(120)
  mockEstimateRunCreditLines.mockImplementation((exec: TestNode[]) =>
    exec.map((x) => ({ nodeId: x.id, label: x.data.label, quantity: { fanOut: 1, units: 1, unitKind: null }, credits: 40 })))
  mockRule.mockReturnValue({ ok: true })
  mockNewerPatches.mockReturnValue({})
  mockUnchanged.mockResolvedValue(false)
  mockListExecutions.mockResolvedValue({ data: [] })
  mockGate.mockResolvedValue(true)
})

describe("Render final on a Tighten Episode node", () => {
  it("continues the node's own run (render-final, its job) and runs every node after it", async () => {
    await run("final")
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    const [workflowId, ids, , opts] = mockRunWorkflow.mock.calls[0]!
    expect(workflowId).toBe("wf-1")
    expect([...(ids as string[])].sort()).toEqual(["fmt", "post", "t1"])
    expect(opts).toEqual({ inputOverrides: { t1: { useCaseContinue: { mode: "render-final", jobId: "00000000-0000-4000-8000-000000000001" } } } })
  })

  it("never sends the render nodes' quality override, and saves nothing on the node", async () => {
    await run("final")
    const opts = mockRunWorkflow.mock.calls[0]![3] as { inputOverrides: Record<string, Record<string, unknown>> }
    expect(Object.values(opts.inputOverrides).some((o) => "quality" in o)).toBe(false)
    // The continuation is this run's override only: never written to the node.
    expect(mockUpdateNodeData.mock.calls.some(([, patch]) => "useCaseContinue" in (patch as object))).toBe(false)
    // The rule and newer-run checks of a render are not asked of it.
    expect(mockRule).not.toHaveBeenCalled()
  })

  it("is priced and confirmed on the graph that carries the continuation (its estimate has no fee there)", async () => {
    const confirmRun = vi.fn().mockResolvedValue(true)
    await run("final", makeCtx({ confirmRun }))
    expect(confirmRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: "render-final" }))
    const [exec, graph] = mockEstimateRunCreditLines.mock.calls[0]! as [TestNode[], TestNode[]]
    expect(exec.map((x) => x.id).sort()).toEqual(["fmt", "post", "t1"])
    expect(graph.find((x) => x.id === "t1")!.data.useCaseContinue).toEqual({ mode: "render-final", jobId: "00000000-0000-4000-8000-000000000001" })
  })

  it("saves the review first (the server sends the node's saved edit), and stops when the save fails", async () => {
    mockDirty = true
    const save = vi.fn().mockResolvedValue({ success: true })
    await run("final", makeCtx(), save)
    expect(save).toHaveBeenCalledWith("p1")
    expect(save.mock.invocationCallOrder[0]!).toBeLessThan(mockRunWorkflow.mock.invocationCallOrder[0]!)

    detachActiveWorkflowStream()
    vi.clearAllMocks()
    mockGate.mockResolvedValue(true)
    mockCollapseExpandedClones.mockImplementation(() => ({ nodes: mockNodes, edges: mockEdges }))
    await run("final", makeCtx(), vi.fn().mockResolvedValue({ success: false }))
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalled()
  })

  it("has no Update preview", async () => {
    await run("proxy")
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("with no run to continue (a take that names none), nothing runs", async () => {
    mockNodes = [REC, { ...T1, data: { ...T1.data, generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy" }] } }, FMT, POST]
    await run("final")
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })

  it("a list-driven node (one run per item) has no Render final here", async () => {
    mockFanOut.mockReturnValue({ items: ["a", "b"] })
    await run("final")
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })
})

describe("Render final on a review-on Clip Pack node", () => {
  const WRAPPER = "00000000-0000-4000-8000-0000000000c1"
  const SETTINGS = { reviewBeforeRender: true, captions: true }
  const KEEP_ONE = { v: 1, kind: "clips", basis: "b", clips: [{ keep: true }, { keep: false }] }
  const CP = n("cp", "clip-pack", {
    ...SETTINGS, useCaseJobId: WRAPPER, editedEdl: KEEP_ONE,
    generatedResults: [0, 1].map((i) => ({ url: `https://r2/p${i}.mp4`, quality: "proxy", jobId: WRAPPER, useCaseSettings: SETTINGS })),
  })
  const CP_EDGES = [
    { id: "a", source: "rec", target: "cp", sourceHandle: "video", targetHandle: "media" },
    { id: "b", source: "cp", target: "post", sourceHandle: "media" },
  ]

  it("continues the node's own run with the Preview's settings; the reviewer's keeps travel as the node's saved edit, never an override", async () => {
    mockNodes = [REC, CP, POST]
    mockEdges = CP_EDGES
    mockDirty = true
    const save = vi.fn().mockResolvedValue({ success: true })
    await handleRenderFinal("cp", "final", makeCtx() as never, "p1", save, vi.fn())
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    const [, ids, , opts] = mockRunWorkflow.mock.calls[0]!
    expect([...(ids as string[])].sort()).toEqual(["cp", "post"])
    expect(opts).toEqual({ inputOverrides: { cp: { useCaseContinue: { mode: "render-final", jobId: WRAPPER, settings: SETTINGS } } } })
    expect(save).toHaveBeenCalledWith("p1")
    expect(save.mock.invocationCallOrder[0]!).toBeLessThan(mockRunWorkflow.mock.invocationCallOrder[0]!)
  })

  it("a review that keeps no clip: nothing starts, and it says to keep a clip (the server would refuse it)", async () => {
    const plan = [0, 1].map((i) => ({ version: 1, sources: [], segments: [{ id: `c${i}`, inMs: i * 60_000, outMs: i * 60_000 + 30_000, video: "cam" }] }))
    const dropAll = { v: 1, kind: "clips", basis: editPlanBasis(plan), clips: [{ keep: false }, { keep: false }] }
    mockNodes = [REC, { ...CP, data: { ...CP.data, generatedJson: plan, editedEdl: dropAll } }, POST]
    mockEdges = CP_EDGES
    const confirmRun = vi.fn().mockResolvedValue(true)
    await handleRenderFinal("cp", "final", makeCtx({ confirmRun }) as never, "p1", vi.fn(), vi.fn())
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(confirmRun).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith("Keep at least one clip to render.")
  })
})

// Fix round 2: a use-case Render final that starts nothing never wipes a
// connected List's rows — cleared only once nothing before the save can stop
// the run, put back by every way out that starts nothing.
describe("a use-case Render final that starts nothing never wipes a List's rows", () => {
  const ROWS = [["first"], ["second"]]
  const LIST = n("list", "list", { columns: [{ id: "c1", name: "Posts", connectedSourceId: "post" }], rows: ROWS })
  const rowsNow = () => {
    let rows: unknown = ROWS
    for (const [id, patch] of mockUpdateNodeData.mock.calls as [string, Record<string, unknown>][]) if (id === "list" && "rows" in patch) rows = patch.rows
    return rows
  }
  const rowsTouched = () => mockUpdateNodeData.mock.calls.some(([id]) => id === "list")
  beforeEach(() => {
    mockNodes = [REC, T1, FMT, POST, LIST]
  })

  it("a run that starts clears them", async () => {
    await run("final")
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    expect(rowsNow()).toEqual([[""]])
  })

  it("a refused save puts them back", async () => {
    mockDirty = true
    await run("final", makeCtx(), vi.fn().mockResolvedValue({ success: false }))
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(rowsTouched()).toBe(true)
    expect(rowsNow()).toEqual(ROWS)
  })

  it("a request that fails puts them back and unmarks the nodes", async () => {
    mockRunWorkflow.mockRejectedValue(new Error("network down"))
    await run("final")
    expect(mockToastError).toHaveBeenCalled()
    expect(rowsNow()).toEqual(ROWS)
    expect(mockMarkNodesStatus).toHaveBeenLastCalledWith(expect.any(Array), undefined)
  })

  it("a run already in progress puts them back", async () => {
    mockRunWorkflow.mockRejectedValue(new MockAlreadyRunning("busy"))
    await run("final")
    expect(mockToastInfo).toHaveBeenCalledWith(expect.stringMatching(/run is in progress/))
    expect(rowsNow()).toEqual(ROWS)
  })

  it("unsaved edits and no project: refused before the rows are touched", async () => {
    mockDirty = true
    await handleRenderFinal("t1", "final", makeCtx() as never, undefined, vi.fn(), vi.fn())
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(rowsTouched()).toBe(false)
  })
})

describe("Render final on a Speaker Layout node (a layout: no plan, no review)", () => {
  const JOB = "00000000-0000-4000-8000-0000000000a1"
  // A stray edit on the node (written as workflow JSON or by an agent): a layout has none to send.
  const SL = n("sl1", "speaker-layout", {
    reviewBeforeRender: true, useCaseJobId: JOB, editedEdl: EDIT,
    generatedJson: { version: 1, segments: [{ start: 0, end: 60 }], dropped: [] },
    generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", jobId: JOB }],
  })
  const CAP = n("cap", "add-captions")

  beforeEach(() => {
    mockNodes = [REC, SL, CAP]
    mockEdges = [
      { id: "a", source: "rec", target: "sl1", sourceHandle: "video", targetHandle: "media" },
      { id: "b", source: "sl1", target: "cap", sourceHandle: "media", targetHandle: "in" },
    ]
  })

  it("the bar's click continues the Preview's own run (render-final, its job) and runs every node after it — no edit in the override", async () => {
    await handleRenderFinal("sl1", "final", makeCtx() as never, "p1", vi.fn().mockResolvedValue({ success: true }), vi.fn())
    expect(mockRunWorkflow).toHaveBeenCalledTimes(1)
    const [, ids, , opts] = mockRunWorkflow.mock.calls[0]!
    expect([...(ids as string[])].sort()).toEqual(["cap", "sl1"])
    expect(opts).toEqual({ inputOverrides: { sl1: { useCaseContinue: { mode: "render-final", jobId: JOB } } } })
  })
})
