import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Rule 6: a withhold for the same browser, device or address takes the gift
 * back from the EARLIER accounts that share it — granted within the day,
 * never paid. The RPC is the admin take-back; this pins WHO it is called
 * for and what is written beside it.
 */

const h = vi.hoisted(() => ({
  siblings: [] as Array<{ user_id: string }>,
  readError: null as unknown,
  purchases: new Map<string, number>(),
  rpc: vi.fn(),
  inserted: [] as Array<Record<string, unknown>>,
  ledger: vi.fn(),
  invalidate: vi.fn(),
  filters: [] as string[],
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    rpc: (...args: unknown[]) => h.rpc(...args),
    from: (table: string) => {
      if (table === "signup_signals") {
        const chain = {
          select: () => chain,
          eq: (c: string, v: unknown) => (h.filters.push(`eq:${c}=${String(v)}`), chain),
          neq: (c: string, v: unknown) => (h.filters.push(`neq:${c}=${String(v)}`), chain),
          gte: (c: string) => (h.filters.push(`gte:${c}`), chain),
          or: async (f: string) => {
            h.filters.push(`or:${f}`)
            return h.readError ? { data: null, error: h.readError } : { data: h.siblings, error: null }
          },
        }
        return chain
      }
      if (table === "transactions") {
        return {
          select: () => ({
            eq: async (_c: string, id: string) => ({ count: h.purchases.get(id) ?? 0, error: null }),
          }),
        }
      }
      if (table === "admin_actions") {
        return { insert: async (values: Record<string, unknown>) => (h.inserted.push(values), { data: null, error: null }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  },
}))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: h.ledger } }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: h.invalidate }))
// The leaf the consumers read from forwards to the mock above.
vi.mock("@/ee/billing/balance-cache.js", async () => ({ invalidateBalanceCache: (await import("@/ee/routes/credits.js")).invalidateBalanceCache }))
vi.mock("@/ee/lib/consent-record.js", () => ({ hasGrantedConsent: async () => true }))

import { SIBLING_TAKEBACK_REASON, takeBackFromSiblings } from "../signup-grant.js"

const LATER = "11111111-1111-4111-8111-111111111111"
const FIRST = "22222222-2222-4222-8222-222222222222"
const PAID = "33333333-3333-4333-8333-333333333333"
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
const keys = { userId: LATER, browserKey: "b".repeat(64), deviceKey: "d".repeat(64), ipHash: "i".repeat(64) }

beforeEach(() => {
  h.siblings = []
  h.readError = null
  h.purchases = new Map()
  h.inserted = []
  h.filters = []
  h.rpc.mockReset()
  h.ledger.mockReset()
  h.invalidate.mockReset()
  log.warn.mockReset()
})

describe("takeBackFromSiblings", () => {
  it("does nothing for a withhold that is not an exact link", async () => {
    await expect(takeBackFromSiblings({ ...keys, reasons: ["domain_reuse", "net_velocity"] }, log as never)).resolves.toEqual([])
    expect(h.filters).toEqual([])
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it("takes the gift back from the earlier account on the same device/browser/address, with a ledger line and an audit entry under no admin", async () => {
    h.siblings = [{ user_id: FIRST }]
    h.rpc.mockResolvedValue({ data: [{ did_revoke: true, old_credits: 708, new_credits: 0, state: "revoked", refusal: null }], error: null })

    await expect(takeBackFromSiblings({ ...keys, reasons: ["device_ip_match", "ip_velocity"] }, log as never)).resolves.toEqual([FIRST])

    // Granted within the day, by someone else, on any of the three exact keys.
    expect(h.filters).toEqual([
      "eq:source=claim",
      "eq:decision=granted",
      `neq:user_id=${LATER}`,
      "gte:decided_at",
      `or:browser_key.eq.${keys.browserKey},device_key.eq.${keys.deviceKey},ip_hash.eq.${keys.ipHash}`,
    ])
    expect(h.rpc).toHaveBeenCalledWith("revoke_signup_grant", expect.objectContaining({ p_user_id: FIRST, p_admin_id: null }))
    expect(h.ledger).toHaveBeenCalledWith(expect.objectContaining({ userId: FIRST, amount: -708, description: SIBLING_TAKEBACK_REASON, adminUserId: undefined }))
    expect(h.inserted).toEqual([
      expect.objectContaining({ admin_user_id: null, action: "free_grant_revoke", target_type: "user", target_id: FIRST, reason: SIBLING_TAKEBACK_REASON }),
    ])
    expect(h.inserted[0]!.payload).toEqual({ by: "rule-6", laterAccount: LATER, reasons: ["device_ip_match", "ip_velocity"], credits: 708 })
    expect(h.invalidate).toHaveBeenCalledWith(FIRST)
  })

  it("leaves an account that has ever paid alone, and one the RPC refuses", async () => {
    h.siblings = [{ user_id: PAID }, { user_id: FIRST }]
    h.purchases.set(PAID, 1)
    h.rpc.mockResolvedValue({ data: [{ did_revoke: false, old_credits: 1500, new_credits: 1500, state: "granted", refusal: "paid_account" }], error: null })

    await expect(takeBackFromSiblings({ ...keys, reasons: ["browser_match"] }, log as never)).resolves.toEqual([])
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith("revoke_signup_grant", expect.objectContaining({ p_user_id: FIRST }))
    expect(h.inserted).toEqual([])
  })

  it("a claim with only an address sends only the address; a failed read is a warning, never a throw", async () => {
    h.siblings = []
    await takeBackFromSiblings({ ...keys, browserKey: null, deviceKey: null, reasons: ["ip_velocity"] }, log as never)
    expect(h.filters.at(-1)).toBe(`or:ip_hash.eq.${keys.ipHash}`)

    h.readError = { code: "XX000", message: "boom" }
    await expect(takeBackFromSiblings({ ...keys, reasons: ["ip_velocity"] }, log as never)).resolves.toEqual([])
    expect(log.warn).toHaveBeenCalledTimes(1)
  })
})
