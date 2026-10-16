import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, mockRpc, rpcResponses, updates } = vi.hoisted(() => {
  const rpcResponses = new Map<string, { data: unknown; error: unknown }>()
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  function createChain(table: string) {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: vi.fn(self),
      eq: vi.fn(self),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push({ table, payload })
        return chain
      }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    })
    return chain
  }
  const mockFrom = vi.fn((table: string) => createChain(table))
  const mockRpc = vi.fn((fn: string) => Promise.resolve(rpcResponses.get(fn) ?? { data: null, error: null }))
  return { mockFrom, mockRpc, rpcResponses, updates }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mockFrom, rpc: mockRpc } }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))
// The leaf the consumers read from forwards to the mock above.
vi.mock("@/ee/billing/balance-cache.js", async () => ({ invalidateBalanceCache: (await import("@/ee/routes/credits.js")).invalidateBalanceCache }))

import { handleAutoRechargeSucceeded, handleAutoRechargeFailed } from "../provision-credits.js"

beforeEach(() => {
  rpcResponses.clear()
  updates.length = 0
  vi.clearAllMocks()
})

describe("handleAutoRechargeSucceeded", () => {
  it("grants via the idempotent RPC, sized from the settled amount", async () => {
    rpcResponses.set("grant_topup_credits_idempotent", { data: true, error: null })
    await handleAutoRechargeSucceeded({ piId: "pi_1", userId: "u1", amountReceivedCents: 5000 })
    expect(mockRpc).toHaveBeenCalledWith("grant_topup_credits_idempotent", {
      p_user_id: "u1",
      p_credits: 17500, // $50 anchor
      p_stripe_transaction_id: "pi_1",
      p_amount_usd: 50,
    })
    // success clears the failure streak
    expect(updates.find((u) => u.table === "profiles")?.payload.auto_recharge_failure_count).toBe(0)
  })

  it("duplicate delivery is a no-op after the claim", async () => {
    rpcResponses.set("grant_topup_credits_idempotent", { data: false, error: null })
    await handleAutoRechargeSucceeded({ piId: "pi_1", userId: "u1", amountReceivedCents: 5000 })
    expect(updates).toHaveLength(0)
  })

  it("rejects non-whole-dollar and out-of-bounds amounts without granting", async () => {
    await handleAutoRechargeSucceeded({ piId: "pi_2", userId: "u1", amountReceivedCents: 5050 })
    await handleAutoRechargeSucceeded({ piId: "pi_3", userId: "u1", amountReceivedCents: 200000 })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("missing userId metadata is rejected", async () => {
    await handleAutoRechargeSucceeded({ piId: "pi_4", userId: null, amountReceivedCents: 5000 })
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

describe("handleAutoRechargeFailed", () => {
  it("counts the failure through the auto-disabling RPC", async () => {
    rpcResponses.set("record_auto_recharge_failure", { data: 2, error: null })
    await handleAutoRechargeFailed({ userId: "u1" })
    expect(mockRpc).toHaveBeenCalledWith("record_auto_recharge_failure", { p_user_id: "u1" })
  })
})
