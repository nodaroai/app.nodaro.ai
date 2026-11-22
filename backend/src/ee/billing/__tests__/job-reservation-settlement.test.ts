import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PluginJobSettlement } from "../../../lib/private-plugins/types.js"
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { rpc, from } }))
// The display figure is derived from the settled cost at a made-up markup (lib/job-cost-columns.ts).
vi.mock("@/lib/app-settings.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getAppSettings: async () => ({ cost_markup_percent: 20 }),
}))
const { update, eq } = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn() }))
import { settleReservedJob } from "../job-reservation-settlement.js"
const input: PluginJobSettlement = { jobId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002", usageLogId: "00000000-0000-4000-8000-000000000003",
  expectedStatus: "completed", actualCredits: 40, receiptHash: "a".repeat(64), providerCostUsd: 0.25 }
const receipt = { jobId: input.jobId, usageLogId: input.usageLogId, actualCredits: 40,
  releasedCredits: 60, receiptHash: input.receiptHash, replayed: false }
beforeEach(() => {
  vi.resetAllMocks()
  rpc.mockResolvedValue({ data: receipt, error: null })
  eq.mockResolvedValue({ error: null })
  update.mockReturnValue({ eq })
  from.mockReturnValue({ update })
})
describe("atomic reservation settlement adapter", () => {
  it("forwards the admitted decision and returns the verified atomic receipt", async () => {
    expect(await settleReservedJob(input)).toEqual(receipt)
    expect(rpc).toHaveBeenCalledExactlyOnceWith("settle_job_reservation", {
      p_job_id: input.jobId, p_user_id: input.userId, p_usage_log_id: input.usageLogId,
      p_expected_status: "completed", p_actual_credits: 40, p_receipt_hash: input.receiptHash, p_provider_cost_usd: 0.25,
    })
  })
  it("pairs the settled provider cost with its display cost on the row, after the confirmed receipt", async () => {
    await settleReservedJob(input)
    expect(from).toHaveBeenCalledExactlyOnceWith("jobs")
    expect(update).toHaveBeenCalledExactlyOnceWith({ provider_cost: 0.25, display_cost: 0.25 * (1 + 20 / 100) })
    expect(eq).toHaveBeenCalledWith("id", input.jobId)
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(from.mock.invocationCallOrder[0]!)
  })
  it("writes nothing beside a settlement that passed no cost (the RPC keeps the row's)", async () => {
    await settleReservedJob({ ...input, providerCostUsd: undefined })
    expect(from).not.toHaveBeenCalled()
  })
  it("a display write that fails does not fail the confirmed settlement", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    eq.mockResolvedValue({ error: { message: "timeout" } })
    expect(await settleReservedJob(input)).toEqual(receipt)
  })
  it("accepts an exact replay without issuing a second operation", async () => {
    rpc.mockResolvedValue({ data: { ...receipt, replayed: true }, error: null })
    expect((await settleReservedJob(input)).replayed).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it("propagates an uncertain RPC failure with no manual or legacy fallback", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "connection interrupted" } })
    await expect(settleReservedJob(input)).rejects.toThrow(/could not be confirmed/)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(from).not.toHaveBeenCalled()
  })
  it.each([{ jobId: input.userId }, { usageLogId: input.jobId }, { actualCredits: 41 },
    { receiptHash: "b".repeat(64) }, { releasedCredits: -1 }, { replayed: undefined }])("refuses mismatched or malformed receipt %j", async (change) => {
    rpc.mockResolvedValue({ data: { ...receipt, ...change }, error: null })
    await expect(settleReservedJob(input)).rejects.toThrow(/mismatched receipt/)
    expect(from).not.toHaveBeenCalled()
  })
})
