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
}))
vi.mock("../../lib/idempotent-insert.js", () => ({ insertWithIdempotencyKey: mocks.insertWithIdempotencyKey }))
vi.mock("../../lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: mocks.queueAdd } }))
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: mocks.from } }))

const { executeAppRun } = await import("../app-execution.js")

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
