import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PluginJobSettlement } from "../../../lib/private-plugins/types.js"
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { rpc, from } }))
import { settleReservedJob } from "../job-reservation-settlement.js"
const input: PluginJobSettlement = { jobId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002", usageLogId: "00000000-0000-4000-8000-000000000003",
  expectedStatus: "completed", actualCredits: 40, receiptHash: "a".repeat(64), providerCostUsd: 0.25 }
const receipt = { jobId: input.jobId, usageLogId: input.usageLogId, actualCredits: 40,
  releasedCredits: 60, receiptHash: input.receiptHash, replayed: false }
beforeEach(() => { vi.resetAllMocks(); rpc.mockResolvedValue({ data: receipt, error: null }) })
describe("atomic reservation settlement adapter", () => {
  it("forwards the admitted decision and returns the verified atomic receipt", async () => {
    expect(await settleReservedJob(input)).toEqual(receipt)
    expect(rpc).toHaveBeenCalledExactlyOnceWith("settle_job_reservation", {
      p_job_id: input.jobId, p_user_id: input.userId, p_usage_log_id: input.usageLogId,
      p_expected_status: "completed", p_actual_credits: 40, p_receipt_hash: input.receiptHash, p_provider_cost_usd: 0.25,
    })
    expect(from).not.toHaveBeenCalled()
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
