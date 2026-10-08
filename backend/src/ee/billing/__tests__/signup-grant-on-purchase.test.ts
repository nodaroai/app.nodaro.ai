import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The free-credit abuse gate, exit by PURCHASE.
 *
 * A withheld account used to leave 'withheld' by saving a card at $0 — a
 * fingerprint the platform treated as "a person we have not seen". Virtual
 * cards made that fingerprint free to mint, so the exit is now a settled
 * purchase: any pack, any card, money moved. Two pieces, both pinned here:
 *
 *   - `activateSignupGrantOnPurchase` — the webhook's hook: 'withheld' →
 *     'granted' through the existing RPC; every other state is left alone and
 *     NOTHING here may throw into a purchase.
 *   - `countPurchases` / `evaluateSignupGrant` — the claim side: an account
 *     that bought BEFORE its claim was decided is granted whatever the device
 *     and network rules say. The purchase is the evidence.
 */

const { mockFrom, mockRpc, mockLogTransaction, mockInvalidate, mockGetUserById, tableResponses } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockLogTransaction: vi.fn().mockResolvedValue(true),
  mockInvalidate: vi.fn(),
  mockGetUserById: vi.fn(),
  tableResponses: new Map<string, unknown>(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { admin: { getUserById: (...args: unknown[]) => mockGetUserById(...args) } },
  },
}))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: mockLogTransaction } }))
// The real module drags in the whole billing surface; the grant only needs the invalidator.
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: mockInvalidate }))

import { activateSignupGrantOnPurchase } from "../signup-grant.js"
import { countPurchases, evaluateSignupGrant } from "../signup-grant-policy.js"
import { TIER_CREDITS } from "../stripe-config.js"

const USER = "00000000-0000-4000-8000-000000000001"
const LOG = { warn: vi.fn(), info: vi.fn() } as never

/**
 * A chainable query: every builder method returns the chain, and awaiting the
 * chain (or its `.single()`) resolves to the table's queued response. One
 * table, one response — the shape every read in these two modules uses.
 */
function chain(table: string) {
  const c: Record<string, unknown> = {}
  const self = () => c
  for (const m of ["select", "eq", "neq", "gte", "ilike", "limit", "is", "update", "upsert", "insert", "single", "maybeSingle"]) {
    c[m] = vi.fn(self)
  }
  c.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    const r = tableResponses.get(table)
    if (r instanceof Error) return reject?.(r)
    return resolve(r ?? { data: null, error: null, count: 0 })
  }
  return c
}

function profileState(state: string | null) {
  tableResponses.set("profiles", { data: state ? { free_grant_state: state, created_at: "2026-10-01T00:00:00Z" } : null, error: state ? null : { message: "boom" } })
}

beforeEach(() => {
  vi.clearAllMocks()
  tableResponses.clear()
  mockFrom.mockImplementation((table: string) => chain(table))
  mockLogTransaction.mockResolvedValue(true)
})

describe("activateSignupGrantOnPurchase — the webhook's hook", () => {
  it("a WITHHELD account is activated through the RPC, with a ledger line and a balance invalidation", async () => {
    profileState("withheld")
    mockRpc.mockResolvedValue({
      data: [{ did_activate: true, old_credits: 0, new_credits: TIER_CREDITS.free, state: "granted" }],
      error: null,
    })

    const result = await activateSignupGrantOnPurchase(USER)

    expect(result).toEqual({ activated: true, state: "granted" })
    expect(mockRpc).toHaveBeenCalledWith("activate_signup_grant", { p_user_id: USER, p_grant_amount: TIER_CREDITS.free })
    expect(mockLogTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, amount: TIER_CREDITS.free, source: "signup_grant", description: expect.stringMatching(/purchase/i) }),
    )
    expect(mockInvalidate).toHaveBeenCalledWith(USER)
  })

  it.each(["granted", "unclaimed", "revoked"])("a %s account is left exactly as it is — no RPC, no ledger", async (state) => {
    profileState(state)

    const result = await activateSignupGrantOnPurchase(USER)

    expect(result).toEqual({ activated: false, state })
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockLogTransaction).not.toHaveBeenCalled()
  })

  it("a state read that fails never throws into the purchase", async () => {
    profileState(null)

    await expect(activateSignupGrantOnPurchase(USER)).resolves.toEqual({ activated: false, state: null })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("an RPC failure never throws into the purchase either — the credits were paid for and must land", async () => {
    profileState("withheld")
    mockRpc.mockResolvedValue({ data: null, error: { message: "rpc down" } })

    await expect(activateSignupGrantOnPurchase(USER)).resolves.toEqual({ activated: false, state: "withheld" })
    expect(mockLogTransaction).not.toHaveBeenCalled()
  })
})

describe("countPurchases — reads the settled purchases, fails open", () => {
  it("counts the account's transactions rows", async () => {
    tableResponses.set("transactions", { count: 2, error: null })
    expect(await countPurchases(USER, LOG)).toBe(2)
    const c = mockFrom.mock.results[0]!.value as { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn> }
    expect(mockFrom).toHaveBeenCalledWith("transactions")
    expect(c.select).toHaveBeenCalledWith("user_id", { count: "exact", head: true })
    expect(c.eq).toHaveBeenCalledWith("user_id", USER)
  })

  it("a failed count is 0 — a read we could not make is never a reason to grant", async () => {
    tableResponses.set("transactions", { count: null, error: { message: "nope" } })
    expect(await countPurchases(USER, LOG)).toBe(0)
    tableResponses.set("transactions", new Error("network"))
    expect(await countPurchases(USER, LOG)).toBe(0)
  })
})

describe("evaluateSignupGrant — a purchase on record is the evidence", () => {
  function signalsFire() {
    mockGetUserById.mockResolvedValue({
      data: { user: { app_metadata: { providers: ["google"] }, email: "someone39@example.test" } },
      error: null,
    })
    // Every signal head-count says "one other account" — browser_match fires.
    tableResponses.set("signup_signals", { count: 1, error: null })
    tableResponses.set("profiles", { data: [], error: null })
  }

  it("withholds on the signals when the account has never paid (the rules are unchanged)", async () => {
    signalsFire()
    tableResponses.set("transactions", { count: 0, error: null })

    const decision = await evaluateSignupGrant({ userId: USER, browserKey: "a".repeat(64), deviceKey: null, ipHash: "h" }, LOG)

    expect(decision.decision).toBe("withheld")
    expect(decision.reasons).toContain("browser_match")
  })

  it("grants despite the same signals once a purchase is on record", async () => {
    signalsFire()
    tableResponses.set("transactions", { count: 1, error: null })

    const decision = await evaluateSignupGrant({ userId: USER, browserKey: "a".repeat(64), deviceKey: null, ipHash: "h" }, LOG)

    expect(decision).toEqual({ decision: "granted", reasons: [] })
  })
})
