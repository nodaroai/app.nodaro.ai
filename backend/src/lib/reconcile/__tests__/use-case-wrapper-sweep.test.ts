import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  scanError: null as { message: string } | null,
  filters: [] as string[],
  finalize: vi.fn(async (_id: string, _expected?: string) => "failed" as string),
  failed: vi.fn(async (_id: string, _input: Record<string, unknown>) => true),
  refund: vi.fn(async (_id: string) => 1),
  find: vi.fn(async (_wrapperId: string, _owner: string) => null as string | null),
}))
vi.mock("../../supabase.js", () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => { m.filters.push(`${col}=${String(v)}`); return chain },
        lt: (col: string) => { m.filters.push(`${col}<`); return chain },
        limit: async () => ({ data: m.scanError ? null : m.rows, error: m.scanError }),
      }
      return chain
    },
  },
}))
vi.mock("../../execution-inline-graph.js", () => ({ findExecutionIdForWrapper: m.find }))
vi.mock("../../use-case/finalize-wrapper.js", () => ({ finalizeUseCaseWrapper: m.finalize }))
vi.mock("../../job-failure.js", () => ({ markJobFailed: m.failed }))
vi.mock("../../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: m.refund }))
import { sweepUseCaseWrappers } from "../use-case-wrapper-sweep.js"

const old = new Date(Date.now() - 60 * 60_000).toISOString()
beforeEach(() => {
  m.rows = []
  m.scanError = null
  m.filters.length = 0
  for (const f of [m.finalize, m.failed, m.refund, m.find]) f.mockReset()
  m.finalize.mockResolvedValue("failed")
  m.failed.mockResolvedValue(true)
  m.refund.mockResolvedValue(1)
  m.find.mockResolvedValue(null)
})

describe("sweepUseCaseWrappers", () => {
  it("scans only processing use-case wrappers past the grace", async () => {
    await sweepUseCaseWrappers()
    expect(m.filters).toEqual(["provider=use-case", "status=processing", "started_at<"])
  })
  it("finalises a wrapper whose inner run is over", async () => {
    m.rows = [{ id: "job-w", user_id: "u1", started_at: old, input_data: { _executionId: "exec-1" } }]
    const r = await sweepUseCaseWrappers()
    expect(m.finalize).toHaveBeenCalledWith("exec-1", "job-w")
    expect(r).toMatchObject({ scanned: 1, swept: 1, errors: 0 })
    expect(m.failed).not.toHaveBeenCalled()
  })
  it("leaves a wrapper whose run is still going", async () => {
    m.finalize.mockResolvedValue("not_terminal")
    m.rows = [{ id: "job-w", user_id: "u1", started_at: old, input_data: { _executionId: "exec-1" } }]
    expect(await sweepUseCaseWrappers()).toMatchObject({ swept: 0, notStale: 1 })
    expect(m.failed).not.toHaveBeenCalled()
  })
  it("a wrapper finalised by someone else in the meantime moves nothing", async () => {
    m.finalize.mockResolvedValue("already_final")
    m.rows = [{ id: "job-w", user_id: "u1", started_at: old, input_data: { _executionId: "exec-1" } }]
    expect(await sweepUseCaseWrappers()).toMatchObject({ swept: 0 })
    expect(m.failed).not.toHaveBeenCalled()
    expect(m.refund).not.toHaveBeenCalled()
  })
  it("an unstamped wrapper whose run exists (the route died before stamping) is finalised through the run, not failed", async () => {
    m.find.mockResolvedValue("exec-9")
    m.rows = [{ id: "job-w", user_id: "u1", started_at: old, input_data: {} }]
    await sweepUseCaseWrappers()
    expect(m.find).toHaveBeenCalledWith("job-w", "u1")
    expect(m.finalize).toHaveBeenCalledWith("exec-9", "job-w")
    expect(m.failed).not.toHaveBeenCalled()
  })
  it("fails and refunds a wrapper whose run never started (the route died after the insert)", async () => {
    m.rows = [{ id: "job-w", user_id: "u1", started_at: old, input_data: {} }]
    expect(await sweepUseCaseWrappers()).toMatchObject({ swept: 1 })
    expect(m.failed).toHaveBeenCalledWith("job-w", expect.objectContaining({ from: ["processing"] }))
    expect(m.refund).toHaveBeenCalledWith("job-w")
  })
  it("a stamp naming a run that reports to another wrapper settles neither through this one: the scanned wrapper is failed as an orphan", async () => {
    // The finaliser answers not_use_case when the run's wrapper is not the one expected.
    m.finalize.mockImplementation(async (_id: string, expected?: string) => (expected === "job-other" ? "failed" : "not_use_case"))
    m.rows = [{ id: "job-w", user_id: "u1", started_at: old, input_data: { _executionId: "exec-of-other" } }]
    await sweepUseCaseWrappers()
    expect(m.finalize).toHaveBeenCalledWith("exec-of-other", "job-w")
    expect(m.failed).toHaveBeenCalledWith("job-w", expect.objectContaining({ from: ["processing"] }))
    expect(m.refund).toHaveBeenCalledWith("job-w")
  })
  it("fails and refunds a wrapper whose run no longer exists", async () => {
    m.finalize.mockResolvedValue("not_use_case")
    m.rows = [{ id: "job-w", user_id: "u1", started_at: old, input_data: { _executionId: "gone" } }]
    await sweepUseCaseWrappers()
    expect(m.failed).toHaveBeenCalledTimes(1)
    expect(m.refund).toHaveBeenCalledTimes(1)
  })
  it("an orphan another writer settled first is not refunded again", async () => {
    m.failed.mockResolvedValue(false)
    m.rows = [{ id: "job-w", user_id: "u1", started_at: old, input_data: {} }]
    expect(await sweepUseCaseWrappers()).toMatchObject({ swept: 0 })
    expect(m.refund).not.toHaveBeenCalled()
  })
  it("a read error is never taken for a missing run: nothing failed, nothing refunded, counted as an error", async () => {
    m.find.mockRejectedValue(new Error("statement timeout"))
    m.rows = [{ id: "job-w", user_id: "u1", started_at: old, input_data: {} }]
    expect(await sweepUseCaseWrappers()).toMatchObject({ scanned: 1, swept: 0, errors: 1 })
    expect(m.failed).not.toHaveBeenCalled()
    expect(m.refund).not.toHaveBeenCalled()
  })
  it("a finaliser that throws is counted, and the next wrapper is still looked at", async () => {
    m.finalize.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce("completed")
    m.rows = [
      { id: "job-a", user_id: "u1", started_at: old, input_data: { _executionId: "exec-a" } },
      { id: "job-b", user_id: "u1", started_at: old, input_data: { _executionId: "exec-b" } },
    ]
    expect(await sweepUseCaseWrappers()).toMatchObject({ scanned: 2, swept: 1, errors: 1 })
    expect(m.failed).not.toHaveBeenCalled()
  })
  it("a failed scan is one error and touches nothing", async () => {
    m.scanError = { message: "db down" }
    expect(await sweepUseCaseWrappers()).toMatchObject({ scanned: 0, errors: 1 })
    expect(m.finalize).not.toHaveBeenCalled()
  })
})
