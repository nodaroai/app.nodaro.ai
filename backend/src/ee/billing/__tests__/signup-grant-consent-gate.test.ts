import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The welcome-credits opt-in, at the ONE funnel every claim goes through.
 *
 * What these pin:
 *  - Offer off (no options): the pre-426 three-argument RPC call, byte for
 *    byte — a dev deploy running ahead of the migration keeps working.
 *  - Consent required + not granted: NO decision, NO RPC. A keyed claim
 *    (the boot-time endpoint) still records its fingerprints — observe at
 *    boot, decide at consent; a keyless one (the balance poll) writes nothing.
 *  - Consent required + granted: the RPC is asked to re-check
 *    (`p_require_consent`), so the invariant lives in the database too.
 *  - The extension exception marks the consent as owed.
 */

const { mockFrom, mockRpc, mockUpsert, mockLogTransaction, mockInvalidate, mockEvaluate, mockHasConsent } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockUpsert: vi.fn(),
  mockLogTransaction: vi.fn().mockResolvedValue(true),
  mockInvalidate: vi.fn(),
  mockEvaluate: vi.fn(),
  mockHasConsent: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: mockLogTransaction } }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: mockInvalidate }))
// The leaf the consumers read from forwards to the mock above.
vi.mock("@/ee/billing/balance-cache.js", async () => ({ invalidateBalanceCache: (await import("@/ee/routes/credits.js")).invalidateBalanceCache }))
// Rule 6 (the sibling take-back) is doubled OFF here: these specs are about the claim itself.
vi.mock("@/ee/billing/signup-grant-policy.js", () => ({
  evaluateSignupGrant: mockEvaluate,
  siblingTakebackDue: () => false,
  countPurchases: async () => 0,
  SIBLING_TAKEBACK_WINDOW_MS: 24 * 60 * 60 * 1000,
  withheldForKeylessOnly: () => false,
}))
vi.mock("@/ee/lib/consent-record.js", () => ({ hasGrantedConsent: mockHasConsent }))

import { runSignupGrantClaim } from "../signup-grant.js"
import { TIER_CREDITS } from "../stripe-config.js"

const USER = "00000000-0000-4000-8000-000000000001"
const HEX64 = "a".repeat(64)
const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never

function grantedRow() {
  return { data: [{ did_claim: true, old_credits: 0, new_credits: TIER_CREDITS.free, state: "granted" }], error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEvaluate.mockResolvedValue({ decision: "granted", reasons: [] })
  mockRpc.mockResolvedValue(grantedRow())
  mockUpsert.mockResolvedValue({ error: null })
  mockFrom.mockImplementation((table: string) => {
    if (table === "signup_signals") {
      const update = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) })
      return { upsert: mockUpsert, update }
    }
    throw new Error(`unexpected table ${table}`)
  })
})

const keyed = { userId: USER, browserKey: HEX64, deviceKey: null, ipHash: "b".repeat(64) }
const keyless = { userId: USER, browserKey: null, deviceKey: null, ipHash: "b".repeat(64) }

describe("runSignupGrantClaim — welcome offer OFF (no options)", () => {
  it("calls the RPC with exactly the three pre-426 arguments", async () => {
    const outcome = await runSignupGrantClaim(keyed, log)
    expect(outcome.state).toBe("granted")
    expect(mockHasConsent).not.toHaveBeenCalled()
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc.mock.calls[0][1]).toEqual({ p_user_id: USER, p_grant_amount: TIER_CREDITS.free, p_withhold: false })
  })
})

describe("runSignupGrantClaim — consent required", () => {
  it("without consent: keyed claim records its fingerprints, decides nothing, stays unclaimed", async () => {
    mockHasConsent.mockResolvedValue(false)
    const outcome = await runSignupGrantClaim(keyed, log, { requireConsent: true })
    expect(outcome).toEqual({ state: "unclaimed", granted: false, decision: null, consentRequired: true })
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({ user_id: USER, browser_key: HEX64, source: "claim" })
    expect(mockEvaluate).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockLogTransaction).not.toHaveBeenCalled()
  })

  it("without consent: keyless claim (the balance poll) writes nothing at all", async () => {
    mockHasConsent.mockResolvedValue(false)
    const outcome = await runSignupGrantClaim(keyless, log, { requireConsent: true })
    expect(outcome.consentRequired).toBe(true)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("with consent: decides, and asks the RPC to re-check consent", async () => {
    mockHasConsent.mockResolvedValue(true)
    const outcome = await runSignupGrantClaim(keyed, log, { requireConsent: true })
    expect(outcome.state).toBe("granted")
    expect(outcome.granted).toBe(true)
    expect(mockEvaluate).toHaveBeenCalledTimes(1)
    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_user_id: USER,
      p_grant_amount: TIER_CREDITS.free,
      p_withhold: false,
      p_require_consent: true,
    })
    expect(mockLogTransaction).toHaveBeenCalledTimes(1)
  })

  it("with consent: the abuse gate still withholds", async () => {
    mockHasConsent.mockResolvedValue(true)
    mockEvaluate.mockResolvedValue({ decision: "withheld", reasons: ["device_cluster"] })
    mockRpc.mockResolvedValue({ data: [{ did_claim: false, old_credits: 0, new_credits: 0, state: "withheld" }], error: null })
    const outcome = await runSignupGrantClaim(keyed, log, { requireConsent: true })
    expect(outcome.state).toBe("withheld")
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_withhold: true, p_require_consent: true })
    expect(mockLogTransaction).not.toHaveBeenCalled()
  })
})

describe("runSignupGrantClaim — extension exception", () => {
  it("grants without consent and marks the consent as owed", async () => {
    const outcome = await runSignupGrantClaim(keyless, log, { markConsentPending: true })
    expect(outcome.state).toBe("granted")
    expect(mockHasConsent).not.toHaveBeenCalled()
    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_user_id: USER,
      p_grant_amount: TIER_CREDITS.free,
      p_withhold: false,
      p_mark_consent_pending: true,
    })
  })
})
