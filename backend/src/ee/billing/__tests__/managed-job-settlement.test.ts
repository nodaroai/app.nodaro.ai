import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PluginJobSettlementCheckpoint } from "../../../lib/private-plugins/types.js"
const { read, rpc, update } = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn(), update: vi.fn() }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { rpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: read }) }), update }),
} }))
import { checkpointJobSettlement, trySettleManagedJob } from "../managed-job-settlement.js"
const id = "00000000-0000-4000-8000-000000000001"
beforeEach(() => { vi.resetAllMocks(); read.mockResolvedValue({ data: { metadata: { reservation_mode: "job-once" } }, error: null }) })
describe("managed credit ownership", () => {
  it("leaves ordinary reservations to their established lifecycle", async () => {
    read.mockResolvedValue({ data: { metadata: {} }, error: null })
    expect(await trySettleManagedJob(id)).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })
  it("preserves a held reservation and returns ownership to stop generic billing", async () => {
    rpc.mockResolvedValue({ data: { managed: true, deferred: true }, error: null })
    expect(await trySettleManagedJob(id)).toBe(true)
    expect(update).not.toHaveBeenCalled()
  })
  it("confirms completed atomic settlement from the matching receipt", async () => {
    rpc.mockResolvedValue({ data: { managed: true, deferred: false, settlement: {
      usageLogId: id, actualCredits: 40, releasedCredits: 60, receiptHash: "a".repeat(64), replayed: true,
    } }, error: null })
    expect(await trySettleManagedJob(id)).toBe(true)
  })
  it.each([{ managed: false }, { managed: true, deferred: false }, null])("refuses a lost or invalid ownership response %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(trySettleManagedJob(id)).rejects.toThrow(/invalid receipt/)
  })
  it("refuses uncertainty instead of letting generic settlement change money", async () => {
    read.mockResolvedValue({ data: null, error: { message: "network down", code: "503" } })
    await expect(trySettleManagedJob(id)).rejects.toThrow(/Cannot confirm/)
    expect(rpc).not.toHaveBeenCalled()
  })
})
describe("durable settlement checkpoint", () => {
  const input: PluginJobSettlementCheckpoint = { jobId: id, userId: id, usageLogId: id,
    sequence: 3, actualCredits: 40, ready: true, receiptHash: "a".repeat(64), providerCostUsd: 0.25 }
  const saved = { version: 1, sequence: 3, actualCredits: 40, ready: true, receiptHash: input.receiptHash, providerCostUsd: 0.25 }
  it("verifies the saved decision instead of accepting an empty acknowledgement", async () => {
    rpc.mockResolvedValue({ data: saved, error: null })
    await checkpointJobSettlement(input)
    expect(rpc).toHaveBeenCalledExactlyOnceWith("checkpoint_job_settlement", {
      p_job_id: id, p_user_id: id, p_usage_log_id: id, p_sequence: 3,
      p_actual_credits: 40, p_ready: true, p_receipt_hash: input.receiptHash, p_provider_cost_usd: 0.25,
    })
  })
  it.each([null, { ...saved, sequence: 2 }, { ...saved, actualCredits: 41 }, { ...saved, ready: false }])("rejects changed checkpoint %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(checkpointJobSettlement(input)).rejects.toThrow(/invalid receipt/)
    expect(update).not.toHaveBeenCalled()
  })
})
