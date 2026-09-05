/**
 * Deployment payer (item 9) at the storage seam — what these pin: with
 * the payer active, quota ENFORCEMENT is off (the deployment's bucket, their
 * space) while TRACKING stays on (the per-user counter keeps meaning
 * something for the deployment's own limits); inactive, both functions are
 * byte-equivalent to pre-payer behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  mockFrom: vi.fn(),
}))

vi.mock("../../lib/supabase.js", () => ({
  supabase: { rpc: mockRpc, from: mockFrom, auth: { admin: { listUsers: vi.fn() } } },
}))
vi.mock("../../lib/config.js", () => ({ hasCredits: () => true }))

import { checkStorageQuota, reserveStorageIfWithinLimit } from "../file-validation.js"
import { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } from "../../lib/deployment-payer.js"

beforeEach(() => {
  mockRpc.mockClear()
  mockFrom.mockClear()
})
afterEach(() => __resetDeploymentPayerForTests())

describe("storage under a deployment payer", () => {
  it("checkStorageQuota: allowed unconditionally, ZERO reads", async () => {
    __setDeploymentPayerForTests("payer-acct")
    expect(await checkStorageQuota("u-1", 10_000_000_000)).toEqual({ allowed: true })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("reserveStorageIfWithinLimit: TRACKS (increment) without ENFORCING (no limit RPC)", async () => {
    __setDeploymentPayerForTests("payer-acct")
    mockRpc.mockResolvedValueOnce({ data: null, error: null }) // increment_storage
    expect(await reserveStorageIfWithinLimit("u-1", 1234)).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith("increment_storage", { p_user_id: "u-1", p_bytes: 1234 })
    expect(mockRpc).not.toHaveBeenCalledWith("reserve_storage_if_within_limit", expect.anything())
  })

  it("inactive: byte-equivalent — the limit RPC gates as before", async () => {
    mockRpc.mockResolvedValueOnce({ data: false, error: null })
    expect(await reserveStorageIfWithinLimit("u-1", 1234)).toBe(false)
    expect(mockRpc).toHaveBeenCalledWith("reserve_storage_if_within_limit", { p_user_id: "u-1", p_bytes: 1234 })
  })
})
