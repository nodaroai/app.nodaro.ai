import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — purpose-built for the expireTopupCredits sweep:
//   topup_grants: .select().lte().limit()  → thenable list of due grants
//   profiles:     .select().eq().single()  → balance-after read
//   rpc:          expire_topup_credits     → per-user expired amount
// ---------------------------------------------------------------------------

const { mockRpc, state, mockLogTransaction, mockInvalidate } = vi.hoisted(() => {
  const state = {
    dueGrants: [] as Array<{ user_id: string; amount: number; expired_amount: number }>,
    profileTopup: new Map<string, number>(),
  }
  const mockRpc = vi.fn()
  const mockLogTransaction = vi.fn(async () => true)
  const mockInvalidate = vi.fn()
  return { mockRpc, state, mockLogTransaction, mockInvalidate }
})

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    rpc: mockRpc,
    from: (table: string) => {
      if (table === "topup_grants") {
        const chain = {
          select: () => chain,
          lte: () => chain,
          limit: () => Promise.resolve({ data: state.dueGrants, error: null }),
        }
        return chain
      }
      if (table === "profiles") {
        let userId = ""
        const chain = {
          select: () => chain,
          eq: (_col: string, val: string) => { userId = val; return chain },
          single: () => Promise.resolve({ data: { topup_credits: state.profileTopup.get(userId) ?? 0 }, error: null }),
        }
        return chain
      }
      throw new Error(`unexpected table ${table}`)
    },
  },
}))

vi.mock("../credits.js", () => ({
  CreditsService: { logTransaction: mockLogTransaction },
}))

vi.mock("../../routes/credits.js", () => ({
  invalidateBalanceCache: mockInvalidate,
}))
// The leaf the consumers read from forwards to the mock above.
vi.mock("../../billing/balance-cache.js", async () => ({ invalidateBalanceCache: (await import("../../routes/credits.js")).invalidateBalanceCache }))

import { expireTopupCredits } from "../cleanup-service.js"

beforeEach(() => {
  state.dueGrants = []
  state.profileTopup.clear()
  mockRpc.mockReset()
  mockLogTransaction.mockClear()
  mockInvalidate.mockClear()
})

describe("expireTopupCredits sweep", () => {
  it("no due grants → clean zero result, no RPC calls", async () => {
    const result = await expireTopupCredits()
    expect(result).toEqual({ usersSwept: 0, creditsExpired: 0, errors: 0 })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("skips grants whose remainder is already fully expired (client-side filter)", async () => {
    state.dueGrants = [{ user_id: "u1", amount: 300, expired_amount: 300 }]
    const result = await expireTopupCredits()
    expect(result.usersSwept).toBe(0)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("expires per user, logs a negative 'expiry' transaction, invalidates the balance cache", async () => {
    state.dueGrants = [
      { user_id: "u1", amount: 800, expired_amount: 0 },
      { user_id: "u1", amount: 200, expired_amount: 0 }, // same user deduped
      { user_id: "u2", amount: 400, expired_amount: 0 },
    ]
    state.profileTopup.set("u1", 100)
    mockRpc
      .mockResolvedValueOnce({ data: 500, error: null }) // u1 expires 500
      .mockResolvedValueOnce({ data: 0, error: null })   // u2 fully consumed

    const result = await expireTopupCredits()

    expect(mockRpc).toHaveBeenCalledTimes(2)
    expect(mockRpc).toHaveBeenCalledWith("expire_topup_credits", { p_user_id: "u1" })
    expect(result).toEqual({ usersSwept: 2, creditsExpired: 500, errors: 0 })

    expect(mockLogTransaction).toHaveBeenCalledTimes(1)
    expect(mockLogTransaction).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1",
      amount: -500,
      creditType: "topup",
      source: "expiry",
      balanceAfter: 100,
    }))
    expect(mockInvalidate).toHaveBeenCalledWith("u1")
    expect(mockInvalidate).not.toHaveBeenCalledWith("u2")
  })

  it("an RPC failure counts as an error and does not stop other users", async () => {
    state.dueGrants = [
      { user_id: "u1", amount: 100, expired_amount: 0 },
      { user_id: "u2", amount: 100, expired_amount: 0 },
    ]
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } })
      .mockResolvedValueOnce({ data: 100, error: null })

    const result = await expireTopupCredits()
    expect(result.errors).toBe(1)
    expect(result.usersSwept).toBe(1)
    expect(result.creditsExpired).toBe(100)
  })
})
