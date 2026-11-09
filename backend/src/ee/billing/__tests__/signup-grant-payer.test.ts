import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Personal free credits on a deployment with a single payer, at the SERVICE
 * layer.
 *
 * Every run there is billed to the deployment's billing account, so a signup
 * grant on a person's own balance is a balance nothing spends. The routes
 * refuse first (claim-signup-grant, welcome-offer and admin-free-grants tests);
 * these pin the transitions themselves, so a caller that does not ask — the
 * Stripe webhook's purchase exit, or any route added later — still moves
 * nothing: no RPC, no signal row, no decision, no ledger line, no cache
 * invalidation.
 *
 * The last block pins the other direction: with no payer the same calls take
 * exactly their previous path.
 */

const { mockFrom, mockRpc, mockLogTransaction, mockInvalidate, mockEvaluate, mockHasConsent, tableResponses } =
  vi.hoisted(() => ({
    mockFrom: vi.fn(),
    mockRpc: vi.fn(),
    mockLogTransaction: vi.fn().mockResolvedValue(true),
    mockInvalidate: vi.fn(),
    mockEvaluate: vi.fn(),
    mockHasConsent: vi.fn(),
    tableResponses: new Map<string, unknown>(),
  }))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: mockLogTransaction } }))
vi.mock("@/ee/billing/balance-cache.js", () => ({ invalidateBalanceCache: mockInvalidate }))
vi.mock("@/ee/billing/signup-grant-policy.js", () => ({
  evaluateSignupGrant: mockEvaluate,
  siblingTakebackDue: () => false,
  countPurchases: async () => 0,
  SIBLING_TAKEBACK_WINDOW_MS: 24 * 60 * 60 * 1000,
  withheldForKeylessOnly: () => true,
}))
vi.mock("@/ee/lib/consent-record.js", () => ({ hasGrantedConsent: mockHasConsent }))

import {
  activateSignupGrant,
  activateSignupGrantOnPurchase,
  reinstateSignupGrant,
  retryKeylessWithhold,
  runSignupGrantClaim,
} from "../signup-grant.js"
import { TIER_CREDITS } from "../stripe-config.js"
import { __resetDeploymentPayerForTests, __setDeploymentPayerForTests } from "../../../lib/deployment-payer.js"

const USER = "00000000-0000-4000-8000-000000000001"
const ADMIN = "00000000-0000-4000-8000-000000000002"
const PAYER = "00000000-0000-4000-8000-0000000000c3"
const HEX64 = "a".repeat(64)
const LOG = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as never

/** A chainable query answering the table's queued response — the one shape every read here uses. */
function chain(table: string) {
  const c: Record<string, unknown> = {}
  const self = () => c
  for (const m of ["select", "eq", "neq", "gte", "is", "or", "update", "upsert", "insert", "single", "maybeSingle"]) {
    c[m] = vi.fn(self)
  }
  c.then = (resolve: (v: unknown) => void) => resolve(tableResponses.get(table) ?? { data: null, error: null })
  return c
}

/** The account's grant state, for the one read a refused transition may make: what it reports it left. */
function accountState(state: string) {
  tableResponses.set("profiles", { data: { free_grant_state: state, created_at: "2026-10-01T00:00:00Z" }, error: null })
}

/** Every table a transition touched, by name. */
function tablesTouched(): string[] {
  return mockFrom.mock.calls.map((call) => call[0] as string)
}

beforeEach(() => {
  vi.clearAllMocks()
  tableResponses.clear()
  mockFrom.mockImplementation((table: string) => chain(table))
  mockLogTransaction.mockResolvedValue(true)
  mockHasConsent.mockResolvedValue(true)
  mockEvaluate.mockResolvedValue({ decision: "granted", reasons: [] })
})

afterEach(() => {
  __resetDeploymentPayerForTests()
})

describe("on a deployment with a single payer, no transition moves a free credit", () => {
  beforeEach(() => __setDeploymentPayerForTests(PAYER))

  it("runSignupGrantClaim: nothing is recorded, decided or claimed — the account stays unclaimed", async () => {
    const out = await runSignupGrantClaim({ userId: USER, browserKey: HEX64, deviceKey: HEX64, ipHash: "h" }, LOG)

    expect(out).toEqual({ state: "unclaimed", granted: false, decision: null })
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockEvaluate).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockLogTransaction).not.toHaveBeenCalled()
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it("runSignupGrantClaim: the welcome offer's options change nothing (consent first, or the extension's grant-now)", async () => {
    for (const options of [{ requireConsent: true }, { markConsentPending: true }]) {
      const out = await runSignupGrantClaim({ userId: USER, browserKey: HEX64, deviceKey: null, ipHash: "h" }, LOG, options)
      expect(out).toEqual({ state: "unclaimed", granted: false, decision: null })
    }
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockHasConsent).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("retryKeylessWithhold: a withheld account is not judged again", async () => {
    const out = await retryKeylessWithhold({ userId: USER, browserKey: HEX64, deviceKey: null, ipHash: "h" }, LOG)

    expect(out).toEqual({ retried: false, state: "withheld", activated: false, decision: null })
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockEvaluate).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("activateSignupGrant: nothing is activated, and the state the account was left in is reported", async () => {
    accountState("withheld")

    const out = await activateSignupGrant(USER, "Free signup grant (restored by admin)")

    expect(out).toEqual({ activated: false, state: "withheld" })
    expect(tablesTouched()).toEqual(["profiles"])
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockLogTransaction).not.toHaveBeenCalled()
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it("activateSignupGrantOnPurchase (the Stripe webhook's exit): a settled purchase activates nothing", async () => {
    accountState("withheld")

    const out = await activateSignupGrantOnPurchase(USER)

    expect(out).toEqual({ activated: false, state: null })
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockLogTransaction).not.toHaveBeenCalled()
  })

  it("reinstateSignupGrant: nothing is put back — refused as not_applicable", async () => {
    accountState("revoked")

    const out = await reinstateSignupGrant(USER, ADMIN)

    expect(out).toEqual({ changed: false, state: "revoked", credits: 0, refusal: "not_applicable" })
    expect(tablesTouched()).toEqual(["profiles"])
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockLogTransaction).not.toHaveBeenCalled()
    expect(mockInvalidate).not.toHaveBeenCalled()
  })
})

describe("with no payer, the same calls take their previous path", () => {
  it("runSignupGrantClaim still claims through claim_signup_grant", async () => {
    mockRpc.mockResolvedValue({ data: [{ did_claim: true, old_credits: 0, new_credits: TIER_CREDITS.free, state: "granted" }], error: null })

    const out = await runSignupGrantClaim({ userId: USER, browserKey: HEX64, deviceKey: null, ipHash: "h" }, LOG)

    expect(out.granted).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith("claim_signup_grant", expect.objectContaining({ p_user_id: USER }))
  })

  it("activateSignupGrant still activates through activate_signup_grant", async () => {
    mockRpc.mockResolvedValue({ data: [{ did_activate: true, old_credits: 0, new_credits: TIER_CREDITS.free, state: "granted" }], error: null })

    const out = await activateSignupGrant(USER, "Free signup grant")

    expect(out).toEqual({ activated: true, state: "granted" })
    expect(mockRpc).toHaveBeenCalledWith("activate_signup_grant", { p_user_id: USER, p_grant_amount: TIER_CREDITS.free })
  })

  it("reinstateSignupGrant still reinstates through reinstate_signup_grant", async () => {
    mockRpc.mockResolvedValue({ data: [{ did_reinstate: true, old_credits: 0, new_credits: TIER_CREDITS.free, state: "granted" }], error: null })

    const out = await reinstateSignupGrant(USER, ADMIN)

    expect(out.changed).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith("reinstate_signup_grant", { p_user_id: USER })
  })
})
