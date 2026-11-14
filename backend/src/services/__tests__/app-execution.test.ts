import { describe, it, expect, vi, beforeEach } from "vitest"

// Audit 2026-09-06 follow-up (D-2 / A-15 / B-3): the MCP layer forwards a
// client's `client_request_id` as the `idempotency-key` header, and
// `/v1/workflows/:id/run` dedups on it — but an app run (and a component
// run, which rides this same core) inserted its execution with a plain
// INSERT, so a retried `run_app` started and charged the work twice.
const mocks = vi.hoisted(() => ({
  insertWithIdempotencyKey: vi.fn(),
  queueAdd: vi.fn().mockResolvedValue({}),
  from: vi.fn(),
  failWaiting: vi.fn(),
  insertAppReport: vi.fn(),
}))
vi.mock("../../lib/idempotent-insert.js", () => ({ insertWithIdempotencyKey: mocks.insertWithIdempotencyKey }))
vi.mock("../../lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: mocks.queueAdd } }))
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: mocks.from } }))
// The run's own failure path (a CAS from `pending`): what a refused run is settled through.
vi.mock("../../lib/concurrency-lanes/run-failure.js", () => ({ failWaitingExecutionDetailed: mocks.failWaiting }))
vi.mock("../../lib/app-reports.js", () => ({ insertAppReport: mocks.insertAppReport }))

const { executeAppRun } = await import("../app-execution.js")
const { UnqueuedRunError, UNQUEUED_EXECUTION_MESSAGE } = await import("../../lib/enqueue-execution.js")

/** Make the failure write answer as `outcome` would: failed by this call, moved on, or unknown (the write throws). */
function settleAs(outcome: "failed" | "moved-on" | "unsettled"): void {
  if (outcome === "unsettled") mocks.failWaiting.mockRejectedValueOnce(new Error("write failed"))
  else mocks.failWaiting.mockResolvedValueOnce({ failed: outcome === "failed", attempts: 1 })
}
const { appRunStampOf } = await import("../../lib/app-run-stamp.js")

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ["insert", "select", "eq", "single", "maybeSingle", "order", "limit"]) c[m] = vi.fn().mockReturnValue(c)
  ;(c.single as ReturnType<typeof vi.fn>).mockResolvedValue(result)
  ;(c.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue(result)
  return c
}

describe("executeAppRun — idempotency key", () => {
  beforeEach(() => vi.clearAllMocks())

  it("creates the execution through the idempotent insert with the key, then the run, then enqueues", async () => {
    mocks.insertWithIdempotencyKey.mockResolvedValue({ row: { id: "exec-1" }, created: true })
    mocks.from.mockReturnValue(chain({ data: { id: "run-1" }, error: null }))
    const result = await executeAppRun({ appVersionId: "app-v", workflowId: "wf-1", userId: "u1", appId: "app-1", idempotencyKey: "mcp:retry-1234" })
    expect(mocks.insertWithIdempotencyKey).toHaveBeenCalledWith(
      "workflow_executions",
      expect.objectContaining({ workflow_id: "wf-1", user_id: "u1", status: "pending", trigger_type: "app_run" }),
      "mcp:retry-1234",
      "id",
    )
    expect(result).toEqual({ executionId: "exec-1", appRunId: "run-1", deduped: false })
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1)
  })

  it("on a dedup hit returns the existing run and enqueues nothing", async () => {
    mocks.insertWithIdempotencyKey.mockResolvedValue({ row: { id: "exec-1" }, created: false })
    mocks.from.mockReturnValue(chain({ data: { id: "run-existing" }, error: null }))
    const result = await executeAppRun({ appVersionId: "app-v", workflowId: "wf-1", userId: "u1", appId: "app-1", idempotencyKey: "mcp:retry-1234" })
    expect(result).toEqual({ executionId: "exec-1", appRunId: "run-existing", deduped: true })
    expect(mocks.queueAdd).not.toHaveBeenCalled()
    expect(mocks.from).toHaveBeenCalledWith("app_runs")
  })

  it("without a key the insert is plain (key undefined) and behaves as before", async () => {
    mocks.insertWithIdempotencyKey.mockResolvedValue({ row: { id: "exec-2" }, created: true })
    mocks.from.mockReturnValue(chain({ data: { id: "run-2" }, error: null }))
    const result = await executeAppRun({ appVersionId: "app-v", workflowId: "wf-1", userId: "u1", appId: "app-1" })
    expect(mocks.insertWithIdempotencyKey.mock.calls[0]?.[2]).toBeUndefined()
    expect(result.deduped).toBe(false)
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1)
  })
})

// The preview stop rule's answer for a component's inner run is the PARENT's
// (decided 2026-10-05): the inner run is a new job, so the answer rides it.
describe("executeAppRun — previewStopRule", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([[true], [false]])("stamps previewStopRule %s on the job when given", async (rule) => {
    mocks.insertWithIdempotencyKey.mockResolvedValue({ row: { id: "exec-3" }, created: true })
    mocks.from.mockReturnValue(chain({ data: { id: "run-3" }, error: null }))
    await executeAppRun({
      appVersionId: "app-v", workflowId: "wf-1", userId: "u1", appId: "app-1",
      isComponentExecution: true, previewStopRule: rule,
    })
    expect(mocks.queueAdd.mock.calls[0]?.[1]).toMatchObject({ reviewerPresent: false, previewStopRule: rule })
  })

  it("leaves the field off when not given (the rule's default applies)", async () => {
    mocks.insertWithIdempotencyKey.mockResolvedValue({ row: { id: "exec-4" }, created: true })
    mocks.from.mockReturnValue(chain({ data: { id: "run-4" }, error: null }))
    await executeAppRun({ appVersionId: "app-v", workflowId: "wf-1", userId: "u1", appId: "app-1" })
    expect("previewStopRule" in (mocks.queueAdd.mock.calls[0]?.[1] as object)).toBe(false)
  })
})

// Every execution of an app run is stamped with the run, so the admin expunge
// finds it after a re-run moves `app_runs.execution_id` on (decided 2026-10-06).
describe("executeAppRun — the run stamp", () => {
  beforeEach(() => vi.clearAllMocks())

  it("stamps the execution with the run's id, picked before either row is written", async () => {
    mocks.insertWithIdempotencyKey.mockResolvedValue({ row: { id: "exec-5" }, created: true })
    const runChain = chain({ data: { id: "run-5" }, error: null })
    mocks.from.mockReturnValue(runChain)
    await executeAppRun({ appVersionId: "app-v", workflowId: "wf-1", userId: "u1", appId: "app-1" })

    const execRow = mocks.insertWithIdempotencyKey.mock.calls[0]?.[1] as { trigger_data?: unknown }
    const runRow = (runChain.insert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { id?: unknown }
    expect(typeof runRow.id).toBe("string")
    expect(appRunStampOf(execRow.trigger_data)).toBe(runRow.id)
  })
})

describe("executeAppRun — a run the queue refuses", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.insertWithIdempotencyKey.mockResolvedValue({ row: { id: "exec-1" }, created: true })
    mocks.from.mockReturnValue(chain({ data: { id: "run-1" }, error: null }))
  })

  it.each([["failed"], ["unsettled"]] as const)(
    "is settled from pending with its key released and, when %s, the caller gets an UnqueuedRunError saying so, the queue's error as its cause and the run's app run on it",
    async (outcome) => {
      const refused = new Error("Connection is closed.")
      mocks.queueAdd.mockRejectedValueOnce(refused)
      settleAs(outcome)
      const err = await executeAppRun({ appVersionId: "app-v", workflowId: "wf-1", userId: "u1", appId: "app-1", idempotencyKey: "mcp:retry-1234" }).then(
        () => null,
        (e: unknown) => e,
      )
      expect(err).toBeInstanceOf(UnqueuedRunError)
      // The run's app run rides along, so a caller that follows an unsettled run can report it.
      expect(err).toMatchObject({ outcome, executionId: "exec-1", appRunId: "run-1" })
      expect((err as Error).cause).toBe(refused)
      expect(mocks.failWaiting).toHaveBeenCalledWith("exec-1", UNQUEUED_EXECUTION_MESSAGE, { idempotency_key: null })
    },
  )

  it("the app run row the refused run left `running` is marked failed, scoped to its runner; an unsettled or moved-on one is left alone", async () => {
    const run = chain({ data: { id: "run-1" }, error: null })
    const update = vi.fn().mockReturnValue(run)
    run.update = update
    mocks.from.mockReturnValue(run)
    mocks.queueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
    settleAs("failed")
    await executeAppRun({ appVersionId: "app-v", workflowId: "wf-1", userId: "u1", appId: "app-1" }).catch(() => undefined)
    expect(update).toHaveBeenCalledWith({ status: "failed" })
    expect(run.eq).toHaveBeenCalledWith("id", expect.any(String))
    expect(run.eq).toHaveBeenCalledWith("runner_id", "u1")

    for (const outcome of ["unsettled", "moved-on"] as const) {
      update.mockClear()
      mocks.queueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
      settleAs(outcome)
      await executeAppRun({ appVersionId: "app-v", workflowId: "wf-1", userId: "u1", appId: "app-1" }).catch(() => undefined)
      expect(update).not.toHaveBeenCalled()
    }
  })

  it("a write of the app run row that fails never replaces the caller's error", async () => {
    const run = chain({ data: { id: "run-1" }, error: null })
    run.update = vi.fn().mockReturnValue({ eq: () => ({ eq: () => Promise.reject(new Error("socket hang up")) }) })
    mocks.from.mockReturnValue(run)
    mocks.queueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
    settleAs("failed")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const err = await executeAppRun({ appVersionId: "app-v", workflowId: "wf-1", userId: "u1", appId: "app-1" }).then(() => null, (e: unknown) => e)
    warn.mockRestore()
    expect(err).toBeInstanceOf(UnqueuedRunError)
    expect(err).toMatchObject({ outcome: "failed" })
  })

  it("a row that cannot be created throws a plain error: nothing was queued, nothing settled", async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: { message: "insert failed" } }))
    const err = await executeAppRun({ appVersionId: "app-v", workflowId: "wf-1", userId: "u1", appId: "app-1" }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(UnqueuedRunError)
    expect(mocks.queueAdd).not.toHaveBeenCalled()
    expect(mocks.failWaiting).not.toHaveBeenCalled()
  })

  it("one that moved on meanwhile (a worker claimed it) is answered as started", async () => {
    mocks.queueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
    settleAs("moved-on")
    const result = await executeAppRun({ appVersionId: "app-v", workflowId: "wf-1", userId: "u1", appId: "app-1" })
    expect(result).toEqual({ executionId: "exec-1", appRunId: "run-1", deduped: false })
  })
})
