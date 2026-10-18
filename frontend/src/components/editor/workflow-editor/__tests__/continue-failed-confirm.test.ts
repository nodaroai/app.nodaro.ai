import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * "Continue from failed" and "Finish review" are ALWAYS confirmed, whatever
 * their figure: the confirm names every node that runs with its price (a node
 * the failed run did not complete runs and is charged again, one run by hand
 * with ▶ since included), and lists what the run completed as kept.
 */
const credits = vi.hoisted(() => ({ on: true }))
type TestNode = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
let mockNodes: TestNode[] = []

const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ nodes: mockNodes, edges: [], updateNodeData: vi.fn(), markNodesStatus: vi.fn(), isDirty: false, workflowId: "wf-1" }) },
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
// Far below the usual run-confirm threshold: a continuation asks anyway.
const PRICE: Record<string, number> = { vid: 3, cut: 2, img: 5 }
vi.mock("../estimate-run-credits", () => ({
  estimateRunCredits: (exec: TestNode[]) => exec.reduce((s, x) => s + (PRICE[x.id] ?? 0), 0),
  estimateRunCreditLines: (exec: TestNode[]) =>
    exec.map((x) => ({ nodeId: x.id, label: String(x.data.label), quantity: { fanOut: 1, units: 1, unitKind: null }, credits: PRICE[x.id] ?? 0 })),
  sumRunCreditLines: (lines: readonly { credits: number }[]) => lines.reduce((s, l) => s + l.credits, 0),
  runNodeLabel: (x: { type?: string; data?: { label?: unknown } }) => (typeof x.data?.label === "string" ? x.data.label : x.type ?? ""),
}))
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: vi.fn(() => []), getEffectivelySkippedIds: vi.fn(() => new Set()), collapseExpandedClones: vi.fn(),
}))
vi.mock("../node-input-resolver", () => ({ getListInputForNode: () => null, getListFanOutForNode: () => undefined }))
vi.mock("../execute-node", () => ({ executeNode: vi.fn(), rejectAllManualEdits: vi.fn() }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn(), expandLoopResults: vi.fn() }))
vi.mock("../sub-workflow-preflight", () => ({ nestedRunPreflight: vi.fn().mockResolvedValue(null) }))

const { confirmRunOrAbort, RUN_CONFIRM_CREDITS } = await import("../run-handlers")

const n = (id: string, type: string, label = id): TestNode => ({ id, type, position: { x: 0, y: 0 }, data: { label } })
const IMG = n("img", "generate-image", "Generate Image")
const VID = n("vid", "image-to-video", "Image to Video")
const CUT = n("cut", "add-captions", "Add Captions")

afterEach(() => { credits.on = true })
beforeEach(() => {
  vi.clearAllMocks()
  mockNodes = [IMG, VID, CUT]
})

const ask = async (trigger: "continue-failed" | "finish-review") => {
  const confirmRun = vi.fn().mockResolvedValue(true)
  const ok = await confirmRunOrAbort({ confirmRun } as never, [VID, CUT] as never, mockNodes as never, [] as never, trigger, true, undefined, undefined, { keptIds: ["img"] })
  return { ok, confirmRun, info: confirmRun.mock.calls[0]?.[0] }
}

describe("a continuation's confirm", () => {
  it.each(["continue-failed", "finish-review"] as const)("%s: asked even far below the usual threshold, every node that runs named with its price", async (trigger) => {
    expect(PRICE.vid! + PRICE.cut!).toBeLessThan(RUN_CONFIRM_CREDITS)
    const { ok, confirmRun, info } = await ask(trigger)
    expect(ok).toBe(true)
    expect(confirmRun).toHaveBeenCalledTimes(1)
    expect(info.trigger).toBe(trigger)
    expect(info.alwaysConfirm).toBe(true)
    expect(info.lines.map((l: { nodeId: string; credits: number }) => [l.nodeId, l.credits])).toEqual([["vid", 3], ["cut", 2]])
    expect(info.estimatedCredits).toBe(5)
    expect(info.kept).toEqual(["Generate Image"])
  })

  it("a non-credit edition still names every node that runs, with no figure", async () => {
    credits.on = false
    const { info } = await ask("continue-failed")
    expect(info.estimatedCredits).toBeNull()
    expect(info.lines.map((l: { label: string }) => l.label)).toEqual(["Image to Video", "Add Captions"])
  })

  it("asked even when the editor expects nothing to run: the server decides the set", async () => {
    const confirmRun = vi.fn().mockResolvedValue(true)
    expect(await confirmRunOrAbort({ confirmRun } as never, [] as never, mockNodes as never, [] as never, "continue-failed", true, undefined, undefined, { keptIds: ["img", "vid"] })).toBe(true)
    expect(confirmRun).toHaveBeenCalledTimes(1)
    expect(confirmRun.mock.calls[0]![0].kept).toEqual(["Generate Image", "Image to Video"])
  })

  it("declined: nothing proceeds", async () => {
    const confirmRun = vi.fn().mockResolvedValue(false)
    expect(await confirmRunOrAbort({ confirmRun } as never, [VID] as never, mockNodes as never, [] as never, "continue-failed", true)).toBe(false)
  })
})
