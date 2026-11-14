import { describe, it, expect, vi, beforeEach } from "vitest"

// An app run's Render final (services/app-render-final.ts) queues its own
// execution for the route. When the queue refuses it, the execution is never
// left `pending` with nothing queued, holding its Idempotency-Key: it is failed
// from `pending` with its key released (enqueueRunOrThrow) and an
// UnqueuedRunError reaches the route, which answers it. One that moved on
// meanwhile (a worker claimed it) is answered as started.
const mocks = vi.hoisted(() => ({
  insertWithIdempotencyKey: vi.fn(),
  queueAdd: vi.fn(),
  linkAppRunFinal: vi.fn(),
  failWaiting: vi.fn(),
  insertAppReport: vi.fn(),
}))
vi.mock("../../lib/idempotent-insert.js", () => ({ insertWithIdempotencyKey: mocks.insertWithIdempotencyKey }))
vi.mock("../../lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: mocks.queueAdd } }))
// The run's own failure path (a CAS from `pending`): what a refused run is settled through.
vi.mock("../../lib/concurrency-lanes/run-failure.js", () => ({ failWaitingExecutionDetailed: mocks.failWaiting }))
vi.mock("../../lib/app-reports.js", () => ({ insertAppReport: mocks.insertAppReport }))
vi.mock("../../lib/app-run-final-column.js", async (importOriginal) => ({
  // The stamp stays real; only the link to the run is a stand-in.
  ...(await importOriginal<typeof import("../../lib/app-run-final-column.js")>()),
  linkAppRunFinal: mocks.linkAppRunFinal,
}))
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

const { executeAppRenderFinal } = await import("../app-render-final.js")
const { UnqueuedRunError, UNQUEUED_EXECUTION_MESSAGE } = await import("../../lib/enqueue-execution.js")

/** Make the failure write answer as `outcome` would: failed by this call, moved on, or unknown (the write throws). */
function settleAs(outcome: "failed" | "moved-on" | "unsettled"): void {
  if (outcome === "unsettled") mocks.failWaiting.mockRejectedValueOnce(new Error("write failed"))
  else mocks.failWaiting.mockResolvedValueOnce({ failed: outcome === "failed", attempts: 1 })
}

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
    expect(mocks.failWaiting).not.toHaveBeenCalled()
  })

  it("a dedup hit queues nothing and settles nothing", async () => {
    mocks.insertWithIdempotencyKey.mockResolvedValue({ row: { id: "exec-final" }, created: false })
    const result = await executeAppRenderFinal(PARAMS)
    expect(result).toEqual({ executionId: "exec-final", linked: true, deduped: true })
    expect(mocks.queueAdd).not.toHaveBeenCalled()
    expect(mocks.failWaiting).not.toHaveBeenCalled()
  })
})

describe("executeAppRenderFinal — a final the queue refuses", () => {
  it.each([["failed"], ["unsettled"]] as const)("settled (%s) as the runner's, and an UnqueuedRunError carrying the queue's error reaches the route", async (outcome) => {
    const refused = new Error("Connection is closed.")
    mocks.queueAdd.mockRejectedValueOnce(refused)
    settleAs(outcome)
    const err = await executeAppRenderFinal(PARAMS).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(UnqueuedRunError)
    expect(err).toMatchObject({ executionId: "exec-final", outcome })
    expect((err as Error).cause).toBe(refused)
    expect(mocks.failWaiting).toHaveBeenCalledTimes(1)
    expect(mocks.failWaiting).toHaveBeenCalledWith("exec-final", UNQUEUED_EXECUTION_MESSAGE, { idempotency_key: null })
  })

  it("one that moved on meanwhile (a worker claimed it) returns normally, as started", async () => {
    mocks.queueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
    settleAs("moved-on")
    const result = await executeAppRenderFinal(PARAMS)
    expect(result).toEqual({ executionId: "exec-final", linked: true, deduped: false })
    expect(mocks.failWaiting).toHaveBeenCalledWith("exec-final", UNQUEUED_EXECUTION_MESSAGE, { idempotency_key: null })
  })
})
