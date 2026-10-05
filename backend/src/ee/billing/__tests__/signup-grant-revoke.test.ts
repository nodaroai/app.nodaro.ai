import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Taking the free signup grant back, and restoring it (migration 458).
 *
 * What these pin:
 *  - The RPC arguments: the take-back sends the free-grant amount and the
 *    acting admin; the restore sends the account alone (it puts back exactly
 *    what `free_grant_revocations` recorded).
 *  - The ledger row carries the amount ACTUALLY moved — negative on a
 *    take-back, positive on a restore — as an `admin_adjustment` on the
 *    subscription pool, with the acting admin. NO row when nothing moved (a
 *    withheld account never had the credits).
 *  - Every RPC refusal is passed through by name, moving nothing, writing
 *    nothing, invalidating nothing; anything unrecognised reads as not_found.
 *  - The balance cache is invalidated after every change.
 *  - The claim records `signup_signals.ip_scheme`, and keeps the observation
 *    WITHOUT it on a database that does not have the column yet (PGRST204 /
 *    42703) instead of losing the whole row.
 */

const { mockFrom, mockRpc, mockUpsert, mockLogTransaction, mockInvalidate, mockEvaluate, mockHasConsent } = vi.hoisted(
  () => ({
    mockFrom: vi.fn(),
    mockRpc: vi.fn(),
    mockUpsert: vi.fn(),
    mockLogTransaction: vi.fn().mockResolvedValue(true),
    mockInvalidate: vi.fn(),
    mockEvaluate: vi.fn(),
    mockHasConsent: vi.fn(),
  }),
)

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: mockLogTransaction } }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: mockInvalidate }))
vi.mock("@/ee/billing/signup-grant-policy.js", () => ({ evaluateSignupGrant: mockEvaluate }))
vi.mock("@/ee/lib/consent-record.js", () => ({ hasGrantedConsent: mockHasConsent }))

import { reinstateSignupGrant, revokeSignupGrant, runSignupGrantClaim } from "../signup-grant.js"
import { TIER_CREDITS } from "../stripe-config.js"

const USER = "00000000-0000-4000-8000-000000000001"
const ADMIN = "00000000-0000-4000-8000-000000000002"
const GRANT = TIER_CREDITS.free

function rpcRow(row: Record<string, unknown>) {
  return { data: [row], error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLogTransaction.mockResolvedValue(true)
})

// ---------------------------------------------------------------------------
// revokeSignupGrant
// ---------------------------------------------------------------------------

describe("revokeSignupGrant", () => {
  it("sends the account, the free-grant amount and the acting admin to revoke_signup_grant", async () => {
    mockRpc.mockResolvedValue(rpcRow({ did_revoke: true, old_credits: GRANT, new_credits: 0, state: "revoked", refusal: null }))

    await revokeSignupGrant(USER, ADMIN)

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith("revoke_signup_grant", {
      p_user_id: USER,
      p_grant_amount: GRANT,
      p_admin_id: ADMIN,
    })
  })

  it("a granted account: one NEGATIVE ledger row of what was removed, cache invalidated", async () => {
    mockRpc.mockResolvedValue(rpcRow({ did_revoke: true, old_credits: GRANT, new_credits: 0, state: "revoked", refusal: null }))

    const out = await revokeSignupGrant(USER, ADMIN)

    expect(out).toEqual({ changed: true, state: "revoked", credits: GRANT, refusal: null })
    expect(mockLogTransaction).toHaveBeenCalledTimes(1)
    expect(mockLogTransaction).toHaveBeenCalledWith({
      userId: USER,
      amount: -GRANT,
      creditType: "subscription",
      source: "admin_adjustment",
      description: "Free credits removed",
      adminUserId: ADMIN,
      balanceAfter: 0,
    })
    expect(mockInvalidate).toHaveBeenCalledWith(USER)
  })

  it("only what is left of the grant: the row carries the amount the RPC actually moved", async () => {
    // 200 of the grant already spent, a 700-credit purchase on top (never touched).
    mockRpc.mockResolvedValue(rpcRow({ did_revoke: true, old_credits: 2000, new_credits: 700, state: "revoked", refusal: null }))

    const out = await revokeSignupGrant(USER, ADMIN)

    expect(out.credits).toBe(1300)
    expect(mockLogTransaction).toHaveBeenCalledWith(expect.objectContaining({ amount: -1300, balanceAfter: 700 }))
  })

  it("a withheld account (nothing to remove): changed, but NO ledger row — the cache is still invalidated", async () => {
    mockRpc.mockResolvedValue(rpcRow({ did_revoke: true, old_credits: 0, new_credits: 0, state: "revoked", refusal: null }))

    const out = await revokeSignupGrant(USER, ADMIN)

    expect(out).toEqual({ changed: true, state: "revoked", credits: 0, refusal: null })
    expect(mockLogTransaction).not.toHaveBeenCalled()
    expect(mockInvalidate).toHaveBeenCalledWith(USER)
  })

  it("reads a single-object answer as well as a one-row array", async () => {
    mockRpc.mockResolvedValue({
      data: { did_revoke: true, old_credits: 900, new_credits: 0, state: "revoked", refusal: null },
      error: null,
    })

    await expect(revokeSignupGrant(USER, ADMIN)).resolves.toEqual({ changed: true, state: "revoked", credits: 900, refusal: null })
  })

  it.each([
    ["not_found", null, null],
    ["not_revocable", "unclaimed", "unclaimed"],
    ["not_revocable", "revoked", "revoked"],
    ["paid_account", "granted", "granted"],
    ["reservations_open", "withheld", "withheld"],
  ])("refusal %s (account %s): passed through by name, nothing moved, written or invalidated", async (refusal, rowState, state) => {
    mockRpc.mockResolvedValue(
      rpcRow({ did_revoke: false, old_credits: rowState ? 1500 : null, new_credits: rowState ? 1500 : null, state: rowState, refusal }),
    )

    const out = await revokeSignupGrant(USER, ADMIN)

    expect(out).toEqual({ changed: false, state, credits: 0, refusal })
    expect(mockLogTransaction).not.toHaveBeenCalled()
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it("an unrecognised refusal, or no row at all, reads as not_found — never as a success", async () => {
    mockRpc.mockResolvedValueOnce(rpcRow({ did_revoke: false, state: "granted", refusal: "something_new" }))
    await expect(revokeSignupGrant(USER, ADMIN)).resolves.toMatchObject({ changed: false, refusal: "not_found" })

    mockRpc.mockResolvedValueOnce({ data: [], error: null })
    await expect(revokeSignupGrant(USER, ADMIN)).resolves.toEqual({ changed: false, state: null, credits: 0, refusal: "not_found" })

    expect(mockLogTransaction).not.toHaveBeenCalled()
  })

  it("an RPC error is thrown as it is (the route maps a missing function to 503)", async () => {
    const error = { code: "PGRST202", message: "Could not find the function public.revoke_signup_grant" }
    mockRpc.mockResolvedValue({ data: null, error })

    await expect(revokeSignupGrant(USER, ADMIN)).rejects.toBe(error)
    expect(mockLogTransaction).not.toHaveBeenCalled()
    expect(mockInvalidate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// reinstateSignupGrant
// ---------------------------------------------------------------------------

describe("reinstateSignupGrant", () => {
  it("sends only the account to reinstate_signup_grant (the amount is what the take-back recorded)", async () => {
    mockRpc.mockResolvedValue(rpcRow({ did_reinstate: true, old_credits: 0, new_credits: GRANT, state: "granted", refusal: null }))

    await reinstateSignupGrant(USER, ADMIN)

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith("reinstate_signup_grant", { p_user_id: USER })
  })

  it("restores: one POSITIVE ledger row of exactly what came back, in the state it was taken from", async () => {
    mockRpc.mockResolvedValue(rpcRow({ did_reinstate: true, old_credits: 200, new_credits: 1700, state: "granted", refusal: null }))

    const out = await reinstateSignupGrant(USER, ADMIN)

    expect(out).toEqual({ changed: true, state: "granted", credits: 1500, refusal: null })
    expect(mockLogTransaction).toHaveBeenCalledTimes(1)
    expect(mockLogTransaction).toHaveBeenCalledWith({
      userId: USER,
      amount: 1500,
      creditType: "subscription",
      source: "admin_adjustment",
      description: "Free credits restored",
      adminUserId: ADMIN,
      balanceAfter: 1700,
    })
    expect(mockInvalidate).toHaveBeenCalledWith(USER)
  })

  it("back to withheld (nothing was taken): no ledger row, the state is withheld, the cache is invalidated", async () => {
    mockRpc.mockResolvedValue(rpcRow({ did_reinstate: true, old_credits: 0, new_credits: 0, state: "withheld", refusal: null }))

    const out = await reinstateSignupGrant(USER, ADMIN)

    expect(out).toEqual({ changed: true, state: "withheld", credits: 0, refusal: null })
    expect(mockLogTransaction).not.toHaveBeenCalled()
    expect(mockInvalidate).toHaveBeenCalledWith(USER)
  })

  it.each([
    ["not_revoked", "granted", "granted"],
    ["paid_account", "revoked", "revoked"],
    ["not_found", null, null],
  ])("refusal %s (account %s): passed through, nothing moved or written", async (refusal, rowState, state) => {
    mockRpc.mockResolvedValue(rpcRow({ did_reinstate: false, old_credits: 0, new_credits: 0, state: rowState, refusal }))

    const out = await reinstateSignupGrant(USER, ADMIN)

    expect(out).toEqual({ changed: false, state, credits: 0, refusal })
    expect(mockLogTransaction).not.toHaveBeenCalled()
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it("an RPC error is thrown as it is", async () => {
    const error = { code: "XX000", message: "boom" }
    mockRpc.mockResolvedValue({ data: null, error })

    await expect(reinstateSignupGrant(USER, ADMIN)).rejects.toBe(error)
    expect(mockLogTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// runSignupGrantClaim — signup_signals.ip_scheme
// ---------------------------------------------------------------------------

describe("runSignupGrantClaim — the ip_scheme marker", () => {
  const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
  const keyed = { userId: USER, browserKey: "a".repeat(64), deviceKey: null, ipHash: "b".repeat(64) }
  const keyless = { userId: USER, browserKey: null, deviceKey: null, ipHash: "b".repeat(64) }
  const BASE_ROW = { user_id: USER, browser_key: "a".repeat(64), device_key: null, ip_hash: "b".repeat(64), source: "claim" }

  beforeEach(() => {
    mockEvaluate.mockResolvedValue({ decision: "granted", reasons: [] })
    mockRpc.mockResolvedValue(rpcRow({ did_claim: true, old_credits: 0, new_credits: GRANT, state: "granted" }))
    mockUpsert.mockResolvedValue({ error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table !== "signup_signals") throw new Error(`unexpected table ${table}`)
      const update = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) })
      return { upsert: mockUpsert, update }
    })
  })

  const insertFailedWarnings = () => log.warn.mock.calls.filter((c) => c[1] === "signup signal insert failed")

  it("a real client address is recorded as 'client'", async () => {
    await runSignupGrantClaim({ ...keyed, ipScheme: "client" }, log as never)

    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledWith({ ...BASE_ROW, ip_scheme: "client" }, { onConflict: "user_id,source", ignoreDuplicates: false })
  })

  it("an unknown address is recorded as null — never blockable", async () => {
    await runSignupGrantClaim(keyed, log as never)
    expect(mockUpsert.mock.calls[0]![0]).toEqual({ ...BASE_ROW, ip_scheme: null })
  })

  it.each(["PGRST204", "42703"])(
    "on a database without the column (%s) the row is written again WITHOUT it — the observation is kept, no warning",
    async (code) => {
      mockUpsert
        .mockResolvedValueOnce({ error: { code, message: "Could not find the 'ip_scheme' column of 'signup_signals'" } })
        .mockResolvedValueOnce({ error: null })

      const outcome = await runSignupGrantClaim({ ...keyed, ipScheme: "client" }, log as never)

      expect(mockUpsert).toHaveBeenCalledTimes(2)
      const retried = mockUpsert.mock.calls[1]![0] as Record<string, unknown>
      expect(retried).toEqual(BASE_ROW)
      expect(retried).not.toHaveProperty("ip_scheme")
      expect(mockUpsert.mock.calls[1]![1]).toEqual(mockUpsert.mock.calls[0]![1])
      expect(insertFailedWarnings()).toHaveLength(0)
      // The claim itself goes on.
      expect(mockRpc).toHaveBeenCalledWith("claim_signup_grant", expect.objectContaining({ p_user_id: USER }))
      expect(outcome.state).toBe("granted")
    },
  )

  it("a keyless claim keeps ignoreDuplicates on the retry (it never overwrites a keyed row)", async () => {
    mockUpsert.mockResolvedValueOnce({ error: { code: "PGRST204", message: "no column" } }).mockResolvedValueOnce({ error: null })

    await runSignupGrantClaim(keyless, log as never)

    expect(mockUpsert.mock.calls.map((c) => c[1])).toEqual([
      { onConflict: "user_id,source", ignoreDuplicates: true },
      { onConflict: "user_id,source", ignoreDuplicates: true },
    ])
  })

  it("any OTHER error is not retried: one warning, and the claim still goes on", async () => {
    const error = { code: "23505", message: "duplicate key" }
    mockUpsert.mockResolvedValueOnce({ error })

    const outcome = await runSignupGrantClaim({ ...keyed, ipScheme: "client" }, log as never)

    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(insertFailedWarnings()).toEqual([[{ err: error, userId: USER }, "signup signal insert failed"]])
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(outcome.state).toBe("granted")
  })

  it("a retry that fails too is warned about once — with the retry's error", async () => {
    const second = { code: "XX000", message: "still broken" }
    mockUpsert.mockResolvedValueOnce({ error: { code: "PGRST204", message: "no column" } }).mockResolvedValueOnce({ error: second })

    await runSignupGrantClaim({ ...keyed, ipScheme: "client" }, log as never)

    expect(mockUpsert).toHaveBeenCalledTimes(2)
    expect(insertFailedWarnings()).toEqual([[{ err: second, userId: USER }, "signup signal insert failed"]])
    expect(mockRpc).toHaveBeenCalledTimes(1)
  })

  it("the consent-gated observation (no decision yet) records the marker and falls back the same way", async () => {
    mockHasConsent.mockResolvedValue(false)
    mockUpsert.mockResolvedValueOnce({ error: { code: "42703", message: "no column" } }).mockResolvedValueOnce({ error: null })

    const outcome = await runSignupGrantClaim({ ...keyed, ipScheme: "client" }, log as never, { requireConsent: true })

    expect(outcome.consentRequired).toBe(true)
    expect(mockUpsert.mock.calls[0]![0]).toEqual({ ...BASE_ROW, ip_scheme: "client" })
    expect(mockUpsert.mock.calls[1]![0]).toEqual(BASE_ROW)
    expect(mockRpc).not.toHaveBeenCalled()
  })
})
