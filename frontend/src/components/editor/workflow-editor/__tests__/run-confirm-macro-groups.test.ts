import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * R8 (decided 2026-10-12): the Reframe group's summed row is in EVERY run
 * confirm — Run, Run selected, Run from here, Run up to here, a single ▶ — not
 * only Render final / Update preview. The confirm carries `groups` (id, label,
 * sum) next to the unchanged total; each sum is a fold of the run's own lines,
 * so it can never disagree with the total it sits inside.
 */
const credits = vi.hoisted(() => ({ on: true }))
type TestNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown>; parentId?: string }
let mockNodes: TestNode[] = []
let mockEdges: unknown[] = []

// The confirm is asked of a priced graph: Speaker Frames' own price gate (a refusal
// BEFORE any confirm) has its own tests.
vi.mock("../speaker-frames-price-preflight", () => ({ speakerFramesPricePreflight: () => null }))
const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ nodes: mockNodes, edges: mockEdges, updateNodeData: vi.fn(), markNodesStatus: vi.fn(), isDirty: false, workflowId: "wf-1" }) },
}))
vi.mock("@/lib/api", () => ({
  getJobStatusLean: vi.fn(), getUserCredits: vi.fn(), runWorkflow: vi.fn(), getWorkflowExecution: vi.fn(),
  withDedupRaceRetry: <T,>(fn: () => Promise<T>) => fn(), WorkflowAlreadyRunningError: class extends Error {},
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }) }))
vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => credits.on }))
vi.mock("@/lib/query-client", () => ({ queryClient: { fetchQuery: vi.fn(), getQueryData: () => undefined } }))
vi.mock("@/lib/query-keys", () => ({ queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } } }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))
// A distinct price per node, so a mis-fold shows. The id-keyed table is the
// stand-in for the estimator; the production path under test is the fold.
const PRICE: Record<string, number> = { t: 30, f: 70, v: 110, img: 50 }
vi.mock("../estimate-run-credits", () => ({
  estimateRunCredits: (exec: TestNode[]) => exec.reduce((s, x) => s + (PRICE[x.id] ?? 0), 0),
  estimateRunCreditLines: (exec: TestNode[]) =>
    exec.map((x) => ({ nodeId: x.id, label: String(x.data.label), quantity: { fanOut: 1, units: 1, unitKind: null }, credits: PRICE[x.id] ?? 0 })),
  sumRunCreditLines: (lines: readonly { credits: number }[]) => lines.reduce((s, l) => s + l.credits, 0),
  runNodeLabel: (x: { type?: string; data?: { label?: unknown } }) => (typeof x.data?.label === "string" ? x.data.label : x.type ?? ""),
}))
vi.mock("../types", async (orig) => ({
  ...(await orig<typeof import("../types")>()),
  isExecutableNode: (x: { type?: string }) => x.type !== "group" && x.type !== "upload-video",
}))
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: vi.fn(() => []), getEffectivelySkippedIds: vi.fn(() => new Set()), collapseExpandedClones: vi.fn(),
}))
vi.mock("../node-input-resolver", () => ({ getListInputForNode: () => null, getListFanOutForNode: () => undefined }))
vi.mock("../execute-node", () => ({ executeNode: vi.fn(), rejectAllManualEdits: vi.fn() }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn(), expandLoopResults: vi.fn() }))
vi.mock("../sub-workflow-preflight", () => ({ nestedRunPreflight: vi.fn().mockResolvedValue(null) }))

const { confirmRunOrAbort, RUN_CONFIRM_CREDITS } = await import("../run-handlers")

afterEach(() => { credits.on = true; delete window.__NODARO_RUNTIME__ })

const n = (id: string, type: string, data: Record<string, unknown> = {}, extra: Partial<TestNode> = {}): TestNode => ({
  id, type, position: { x: 0, y: 0 }, data: { label: id, ...data }, ...extra,
})
const GROUP = n("g", "group", { label: "Reframe", macro: "reframe" })
const KIDS = [n("t", "transcribe", {}, { parentId: "g" }), n("f", "speaker-frames", {}, { parentId: "g" }), n("v", "speaker-view", {}, { parentId: "g" })]
const IMG = n("img", "generate-image")
const PLAIN_GROUP = n("pg", "group", { label: "Mine" })
const TRIGGERS = ["all", "selected", "from-here", "up-to-here", "single"] as const

const ask = async (executable: TestNode[], all: TestNode[], trigger: (typeof TRIGGERS)[number], alwaysConfirm = true) => {
  const confirmRun = vi.fn().mockResolvedValue(true)
  const ok = await confirmRunOrAbort({ confirmRun } as never, executable as never, all as never, [] as never, trigger, alwaysConfirm)
  if (!ok && !confirmRun.mock.calls.length) throw new Error(`run refused: ${JSON.stringify(toastError.mock.calls)}`)
  return { ok, confirmRun, info: confirmRun.mock.calls[0]?.[0] }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockNodes = [GROUP, ...KIDS, IMG]
  mockEdges = []
})

describe("the group's summed row is in every run confirm", () => {
  it.each(TRIGGERS)("%s: the confirm carries the group's sum beside the unchanged total", async (trigger) => {
    const { info } = await ask([...KIDS, IMG], mockNodes, trigger)
    expect(info.groups).toEqual([{ id: "g", label: "Reframe", credits: 30 + 70 + 110 }])
    // The total is the run's own figure, still counting every node once.
    expect(info.estimatedCredits).toBe(30 + 70 + 110 + 50)
    // The itemised table stays Render final / Update preview's.
    expect(info.lines).toBeUndefined()
  })

  it("sums only the group's nodes that run: a single ▶ on one child is that child's own price", async () => {
    const { info } = await ask([KIDS[1]], mockNodes, "single")
    expect(info.groups).toEqual([{ id: "g", label: "Reframe", credits: 70 }])
  })

  it("carries nothing for a run that touches no macro group, or a plain group", async () => {
    const one = await ask([IMG], [...mockNodes, PLAIN_GROUP], "all")
    expect(one.info.groups).toBeUndefined()
    const plain = await ask([n("p1", "generate-image", {}, { parentId: "pg" })], [PLAIN_GROUP, n("p1", "generate-image", {}, { parentId: "pg" })], "all")
    expect(plain.info.groups).toBeUndefined()
  })

  it("lists no numbers on an edition without credits (M16)", async () => {
    credits.on = false
    const { info } = await ask([...KIDS, IMG], mockNodes, "all")
    expect(info.estimatedCredits).toBeNull()
    expect(info.groups).toBeUndefined()
  })

  it("does not force a confirm open: a cheap run under the threshold still goes straight through", async () => {
    PRICE.t = 1; PRICE.f = 1; PRICE.v = 1
    try {
      const { ok, confirmRun } = await ask(KIDS, mockNodes, "from-here", false)
      expect(ok).toBe(true)
      expect(confirmRun).not.toHaveBeenCalled()
      expect(RUN_CONFIRM_CREDITS).toBeGreaterThan(3)
    } finally {
      PRICE.t = 30; PRICE.f = 70; PRICE.v = 110
    }
  })
})
