import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * "Pick a creator first.": while a UGC Creator holds options waiting for the
 * person's pick, every run whose executable nodes include it is refused in
 * confirmRunOrAbort, above the skip-confirm shortcut and before anything
 * changes — the toolbar Run, Run up to here below it, Run from here on it, Run
 * selected including it, a ▶ on it. Only the creator's own re-draw gets
 * through. Run from here on a node below it is not refused: the creator is
 * outside that run.
 *
 * The creator also holds an OLDER image: Run up to here's "has it run?" reads
 * UGC outputs only, so it never mistakes a waiting creator for a run one.
 */

const mockToastError = vi.fn()
const mockExecuteNode = vi.fn()
const mockRunWorkflow = vi.fn()
const mockFetchQuery = vi.fn()
const mockMarkNodesStatus = vi.fn()
type TestNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown>; selected?: boolean }
let mockNodes: TestNode[] = []
let mockEdges: unknown[] = []

vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("@/lib/i18n", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/i18n")>()), tx: (k: string) => k }))
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
vi.mock("@/lib/query-client", () => ({ queryClient: { fetchQuery: (...a: unknown[]) => mockFetchQuery(...a), getQueryData: () => undefined, getQueryState: () => undefined } }))
vi.mock("@/lib/query-keys", () => ({
  queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] }, ugc: { runEstimate: (request: object) => ["ugc", "run-estimate", request] } },
}))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))
// The video's price is not to be had here (the estimate answers nothing): the editor's own figure, 10.
vi.mock("../estimate-run-credits", () => ({
  estimateRunCredits: () => 10,
  estimateRunCreditLines: (executable: Array<{ id: string }>) =>
    executable.map((x, i) => ({ nodeId: x.id, label: x.id, quantity: { fanOut: 1, units: 1 }, credits: i === 0 ? 10 : 0 })),
  sumRunCreditLines: (lines: Array<{ credits: number }>) => lines.reduce((sum, l) => sum + l.credits, 0),
}))
vi.mock("../types", () => ({
  WorkflowStaleError: class extends Error {},
  MAX_CONSECUTIVE_POLL_FAILURES: 5,
  updateAwaitingReviewIfChanged: () => {},
  NODE_CREDIT_COSTS: {} as Record<string, number>,
  isExecutableNode: (n: { type?: string }) => n.type !== "text-prompt",
  SERVER_RUN_ONLY_TYPES: new Set<string>(),
  getFanOutMultiplier: () => 1,
}))
// The real output reader: Run up to here asks it whether the creator has run.
vi.mock("../execution-graph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../execution-graph")>()),
  buildExecutionLevels: () => [],
  getEffectivelySkippedIds: () => new Set(),
  collapseExpandedClones: () => ({ nodes: mockNodes, edges: mockEdges }),
}))
vi.mock("../node-input-resolver", () => ({ getListInputForNode: () => null, getListFanOutForNode: () => undefined }))
vi.mock("../execute-node", () => ({ executeNode: (...a: unknown[]) => mockExecuteNode(...a), rejectAllManualEdits: vi.fn() }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn(), expandLoopResults: vi.fn() }))
vi.mock("../sub-workflow-preflight", () => ({ nestedRunPreflight: async () => null }))

const { handleRun, handleRunFromHere, handleRunSelected, handleRunSingleNode, handleRunUpToHere, detachActiveWorkflowStream } = await import("../run-handlers")

const n = (id: string, type: string, data: Record<string, unknown> = {}): TestNode => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
const OPTION = (u: string) => ({ imageUrl: u, record: { v: 1, identityImages: [u] } })
const edge = (source: string, target: string, sourceHandle: string, targetHandle: string) => ({ id: `${source}-${target}`, source, target, sourceHandle, targetHandle })

const ctx = {
  userId: "u1", projectId: "p1",
  trackInterval: (i: unknown) => i, untrackInterval: vi.fn(),
  save: vi.fn(), setIsRunning: vi.fn(),
  isWorkflowStale: () => false, isStorageError: () => false,
  setShowStorageExceeded: vi.fn(), setStorageExceededData: vi.fn(),
  setShowInsufficientCredits: vi.fn(), setInsufficientCreditsData: vi.fn(),
} as never
const save = vi.fn()
const setIsRunning = vi.fn()
const pollIntervalsRef = { current: new Set() } as never
const selectNodes = (ids: string[]) => { mockNodes = mockNodes.map((node) => ({ ...node, selected: ids.includes(node.id) })) }

beforeEach(() => {
  vi.clearAllMocks()
  mockNodes = [
    n("site", "text-prompt", { text: "Acme" }),
    n("script", "ugc-script", { targetDurationSec: 15, keepResult: false }),
    n("creator", "ugc-creator", {
      source: "sampled", gender: "woman", keepResult: false,
      candidates: [OPTION("https://cdn.example/a.png"), OPTION("https://cdn.example/b.png")],
      generatedImageUrl: "https://cdn.example/old.png",
    }),
    n("clips", "ugc-clips"),
  ]
  mockEdges = [edge("site", "script", "prompt", "site"), edge("script", "creator", "category", "category"), edge("script", "clips", "plan", "plan"), edge("creator", "clips", "creator", "creator")]
  mockExecuteNode.mockResolvedValue("")
  mockRunWorkflow.mockResolvedValue({ executionId: "exec-1" })
  mockFetchQuery.mockResolvedValue({ total: 100_000, tier: "pro" })
})
afterEach(() => detachActiveWorkflowStream())

describe("Pick a creator first", () => {
  it.each([
    ["the toolbar Run", () => handleRun(ctx, "p1", "wf-1", save, setIsRunning)],
    ["Run up to here below the creator", () => handleRunUpToHere("clips", ctx, "p1", save, setIsRunning)],
    ["Run from here on the creator", () => handleRunFromHere("creator", ctx, "p1", save, setIsRunning)],
    ["Run selected with the creator", () => { selectNodes(["creator", "clips"]); return handleRunSelected(ctx, "p1", save, setIsRunning) }],
    ["a ▶ on the creator", () => handleRunSingleNode("creator", ctx, "p1", save, setIsRunning, pollIntervalsRef)],
    ["a ▶ on the creator, even with the confirm skipped", () => handleRunSingleNode("creator", ctx, "p1", save, setIsRunning, pollIntervalsRef, { skipConfirm: true })],
  ] as const)("%s is refused before anything changes", async (_name, run) => {
    await run()
    expect(mockToastError).toHaveBeenCalledWith("run.ugcPickFirst")
    expect(mockRunWorkflow).not.toHaveBeenCalled()
    expect(mockExecuteNode).not.toHaveBeenCalled()
    expect(mockMarkNodesStatus).not.toHaveBeenCalled()
  })
  it("the node's re-draw runs", async () => {
    await handleRunSingleNode("creator", ctx, "p1", save, setIsRunning, pollIntervalsRef, { ugcRedraw: true })
    expect(mockToastError).not.toHaveBeenCalledWith("run.ugcPickFirst")
    expect(mockExecuteNode).toHaveBeenCalled()
  })
  it("Run from here below the creator is not refused (the creator is outside it)", async () => {
    await handleRunFromHere("clips", ctx, "p1", save, setIsRunning)
    expect(mockToastError).not.toHaveBeenCalledWith("run.ugcPickFirst")
  })
  it("Run selected over two waiting creators is refused", async () => {
    mockNodes = [...mockNodes, n("creator-2", "ugc-creator", { source: "sampled", gender: "man", keepResult: false, candidates: [OPTION("https://cdn.example/c.png"), OPTION("https://cdn.example/d.png")] })]
    selectNodes(["creator", "creator-2"])
    await handleRunSelected(ctx, "p1", save, setIsRunning)
    expect(mockToastError).toHaveBeenCalledWith("run.ugcPickFirst")
    expect(mockRunWorkflow).not.toHaveBeenCalled()
  })
  it("once picked (no options waiting), the toolbar Run starts", async () => {
    mockNodes = mockNodes.map((node) => (node.id === "creator" ? { ...node, data: { ...node.data, candidates: undefined, keepResult: true } } : node))
    await handleRun(ctx, "p1", "wf-1", save, setIsRunning)
    expect(mockToastError).not.toHaveBeenCalledWith("run.ugcPickFirst")
    expect(mockRunWorkflow).toHaveBeenCalled()
  })
})
