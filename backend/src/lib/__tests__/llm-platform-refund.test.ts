// @test-units-by-name names no node type: it reverses usage logs through a service-role RPC
/**
 * R61: the platform's deliberate refund of a job's SETTLED metered charges
 * (a result-policy block, a reviewer's reject, a withdraw): every committed
 * METERED log of the job is reversed through `refund_settled_metered_charge`
 * (554), tier/fixed logs never; a refusal is reported, never silent; the side
 * holds go with it (R57). Keyed off the charges, never the pricing switch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  credits: true,
  logs: [] as Array<{ id: string; action: string }>,
  logsError: null as { message: string } | null,
  rpc: vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: "refunded" as unknown, error: null as { message: string } | null })),
  chain: [] as unknown[][],
  reports: [] as Array<Record<string, unknown>>,
  sideRefund: vi.fn(async (_id: string) => 0),
}))

vi.mock("../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.js")>()),
  hasCredits: () => h.credits,
  // The rollback switch: never read by this path (R15).
  llmMeteredPricing: () => false,
}))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      for (const m of ["select", "eq"]) b[m] = (...a: unknown[]) => (h.chain.push([table, m, ...a]), b)
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(h.logsError ? { data: null, error: h.logsError } : { data: h.logs, error: null }).then(res, rej)
      return b
    },
    rpc: h.rpc,
  },
}))
vi.mock("../app-reports.js", () => ({ insertAppReport: vi.fn(async (r: Record<string, unknown>) => (h.reports.push(r), true)) }))
vi.mock("../llm-side-hold.js", () => ({ refundSettledSideHolds: h.sideRefund }))

import { refundSettledLlmCharges } from "../llm-platform-refund.js"
import { setLlmMeteredSchemaReadyForTesting } from "../llm-metered-schema-gate.js"

const JOB = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  vi.clearAllMocks()
  h.credits = true
  h.logs = []
  h.logsError = null
  h.chain = []
  h.reports = []
  h.rpc.mockResolvedValue({ data: "refunded", error: null })
  h.sideRefund.mockResolvedValue(0)
  setLlmMeteredSchemaReadyForTesting(true)
})

describe("refundSettledLlmCharges (R61)", () => {
  it("reverses every COMMITTED metered log of the job through refund_settled_metered_charge — a tier or fixed log never", async () => {
    h.logs = [
      { id: "log-metered", action: "llm-chat:claude-sonnet-5.5" },
      { id: "log-tier", action: "llm-chat:premium" },
      { id: "log-fixed", action: "meta-ads-scrape:100" },
    ]
    h.sideRefund.mockResolvedValueOnce(1)
    // How many logs went back — the job's own charge and a side hold — for the caller's "credits came back" check.
    expect(await refundSettledLlmCharges(JOB)).toBe(2)
    expect(h.chain).toContainEqual(["usage_logs", "eq", "job_id", JOB])
    expect(h.chain).toContainEqual(["usage_logs", "eq", "status", "committed"])
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith("refund_settled_metered_charge", { p_usage_log_id: "log-metered", p_job_id: JOB })
    expect(h.reports).toEqual([])
    // …and the job's settled side holds go with it (R57).
    expect(h.sideRefund).toHaveBeenCalledWith(JOB)
  })

  it("under the ROLLBACK a charge settled before the flip is reversed all the same (keyed off the charge, R15)", async () => {
    h.logs = [{ id: "log-metered", action: "generate-script:claude-sonnet-5.5" }]
    await refundSettledLlmCharges(JOB)
    expect(h.rpc).toHaveBeenCalledWith("refund_settled_metered_charge", { p_usage_log_id: "log-metered", p_job_id: JOB })
  })

  it("an external-wallet row, a refusal or a failed RPC is reported — never silent", async () => {
    h.logs = [
      { id: "log-wallet", action: "llm-chat:claude-sonnet-5.5" },
      { id: "log-live", action: "llm-chat:claude-sonnet-5.5" },
      { id: "log-err", action: "llm-chat:claude-sonnet-5.5" },
      { id: "log-done", action: "llm-chat:claude-sonnet-5.5" },
    ]
    h.rpc
      .mockResolvedValueOnce({ data: "unsupported", error: null })
      .mockResolvedValueOnce({ data: "job-live", error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "deadlock" } })
      .mockResolvedValueOnce({ data: "not-committed", error: null })
    await refundSettledLlmCharges(JOB)
    expect(h.reports.map((r) => (r.payload as { usageLogId: string }).usageLogId)).toEqual(["log-wallet", "log-live", "log-err"])
    for (const r of h.reports) expect(r).toMatchObject({ kind: "metered-charge-platform-refund-not-applied", severity: "error", jobId: JOB })
  })

  it("the schema is asked of the database now: a process whose cached gate says not-ready still refunds once the probe confirms it", async () => {
    const probe = vi.fn(async () => true)
    setLlmMeteredSchemaReadyForTesting(false, probe)
    h.logs = [{ id: "log-metered", action: "llm-chat:claude-sonnet-5.5" }]
    await refundSettledLlmCharges(JOB)
    expect(probe).toHaveBeenCalled()
    expect(h.rpc).toHaveBeenCalledTimes(1)
  })

  it("without the metered schema (no metered charge can exist) or without credits: no read, no RPC", async () => {
    setLlmMeteredSchemaReadyForTesting(false, async () => false)
    await refundSettledLlmCharges(JOB)
    h.credits = false
    setLlmMeteredSchemaReadyForTesting(true)
    await refundSettledLlmCharges(JOB)
    expect(h.chain).toEqual([])
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it("never throws: a failed read is logged, and the side holds are still refunded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.logsError = { message: "timeout" }
    h.sideRefund.mockResolvedValueOnce(1)
    await expect(refundSettledLlmCharges(JOB)).resolves.toBe(1)
    expect(h.sideRefund).toHaveBeenCalledWith(JOB)
  })

  it("never throws, even when the side-hold refund itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.logs = [{ id: "log-metered", action: "llm-chat:claude-sonnet-5.5" }]
    h.sideRefund.mockRejectedValueOnce(new Error("import failed"))
    await expect(refundSettledLlmCharges(JOB)).resolves.toBe(1)
  })
})
