import { describe, it, expect, vi, beforeEach } from "vitest"

// An app run's Render final (services/app-render-final.ts) queues its own
// execution for the route. When the queue refuses it, the execution is never
// left `pending` with nothing queued, holding its Idempotency-Key: it is failed
// from `pending` with its key released (settleUnqueuedRun) and the error
// reaches the route, which answers it. One that moved on meanwhile (a worker
// claimed it) is answered as started.
const mocks = vi.hoisted(() => ({
  insertWithIdempotencyKey: vi.fn(),
  queueAdd: vi.fn(),
  linkAppRunFinal: vi.fn(),
  settleUnqueuedRun: vi.fn(),
}))
vi.mock("../../lib/idempotent-insert.js", () => ({ insertWithIdempotencyKey: mocks.insertWithIdempotencyKey }))
vi.mock("../../lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: mocks.queueAdd } }))
vi.mock("../../lib/enqueue-execution.js", () => ({ settleUnqueuedRun: mocks.settleUnqueuedRun }))
vi.mock("../../lib/app-run-final-column.js", async (importOriginal) => ({
  // The stamp stays real; only the link to the run is a stand-in.
  ...(await importOriginal<typeof import("../../lib/app-run-final-column.js")>()),
  linkAppRunFinal: mocks.linkAppRunFinal,
}))
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

const { executeAppRenderFinal } = await import("../app-render-final.js")

const PARAMS = {
  runId: "run-1",
  userId: "u1",
  appVersionId: "app-v",
  workflowId: "wf-1",
  continueFromExecutionId: "exec-0",
  nodeIds: ["render-1"],
  inputOverrides: { "render-1": { quality: "final" } },
  reviewerPresent: true,
  idempotencyKey: "mcp:final-retry-1234",
} as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.insertWithIdempotencyKey.mockResolvedValue({ row: { id: "exec-final" }, created: true })
  mocks.queueAdd.mockResolvedValue({})
  mocks.linkAppRunFinal.mockResolvedValue(true)
})

describe("executeAppRenderFinal — queueing its execution", () => {
  it("a final the queue takes: queued under the execution's id, nothing settled", async () => {
    const result = await executeAppRenderFinal(PARAMS)
    expect(result).toEqual({ executionId: "exec-final", linked: true, deduped: false })
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "workflow-execution",
      expect.objectContaining({ executionId: "exec-final", continueFromExecutionId: "exec-0", nodeIds: ["render-1"] }),
      { jobId: "exec-final" },
    )
    expect(mocks.settleUnqueuedRun).not.toHaveBeenCalled()
  })

  it("a dedup hit queues nothing and settles nothing", async () => {
    mocks.insertWithIdempotencyKey.mockResolvedValue({ row: { id: "exec-final" }, created: false })
    const result = await executeAppRenderFinal(PARAMS)
    expect(result).toEqual({ executionId: "exec-final", linked: true, deduped: true })
    expect(mocks.queueAdd).not.toHaveBeenCalled()
    expect(mocks.settleUnqueuedRun).not.toHaveBeenCalled()
  })
})

describe("executeAppRenderFinal — a final the queue refuses", () => {
  it.each([["failed"], ["unsettled"]])("settled (%s) as the runner's, and the queue's error reaches the route", async (outcome) => {
    const refused = new Error("Connection is closed.")
    mocks.queueAdd.mockRejectedValueOnce(refused)
    mocks.settleUnqueuedRun.mockResolvedValueOnce(outcome)
    await expect(executeAppRenderFinal(PARAMS)).rejects.toBe(refused)
    expect(mocks.settleUnqueuedRun).toHaveBeenCalledTimes(1)
    expect(mocks.settleUnqueuedRun).toHaveBeenCalledWith("exec-final", "u1")
  })

  it("one that moved on meanwhile (a worker claimed it) returns normally, as started", async () => {
    mocks.queueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
    mocks.settleUnqueuedRun.mockResolvedValueOnce("moved-on")
    const result = await executeAppRenderFinal(PARAMS)
    expect(result).toEqual({ executionId: "exec-final", linked: true, deduped: false })
    expect(mocks.settleUnqueuedRun).toHaveBeenCalledWith("exec-final", "u1")
  })
})
