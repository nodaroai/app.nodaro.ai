/**
 * Track A — GET /v1/user/credits on a deployment-payer instance (D12).
 *
 * Two riders, both easy to get subtly wrong:
 *
 *  1. **`allowance` is ABSENT on mainline, not null.** Every client already
 *     handles this body; a new always-present key changes the wire shape for
 *     deployments that have no such concept. Under a payer the key IS present
 *     and `null` is a real answer (the payer's own read, D13; or the figure
 *     was unavailable) which the client must render as an em dash.
 *
 *  2. **The free-grant settlement is skipped under a payer.** That machinery
 *     claims, withholds and activates a signup grant on the REQUESTER's own
 *     profile row — a row nothing debits on this instance. Running it here
 *     spends two reads and a write per balance poll to move a number no
 *     surface shows, and can mark an account "withheld" for a grant that was
 *     never going to matter.
 *
 * `total` is deliberately NOT overloaded (D12): `getBalance` has five
 * non-test callers and three of them mean something else by it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { mockGetBalance, mockReadFreeGrant, mockRunSignupGrantClaim, mockAllowanceFor, state } = vi.hoisted(() => ({
  mockGetBalance: vi.fn(),
  mockReadFreeGrant: vi.fn(),
  mockRunSignupGrantClaim: vi.fn(),
  mockAllowanceFor: vi.fn(),
  state: { payerActive: false, enforce: false, payerId: null as string | null },
}))

vi.mock("@/ee/billing/signup-grant.js", async () => {
  const actual = await vi.importActual<typeof import("@/ee/billing/signup-grant.js")>("@/ee/billing/signup-grant.js")
  return { ...actual, readFreeGrant: mockReadFreeGrant, runSignupGrantClaim: mockRunSignupGrantClaim }
})
vi.mock("@/ee/billing/deployment-allowance-service.js", () => ({ allowanceFor: mockAllowanceFor }))
vi.mock("@/lib/deployment-payer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/deployment-payer.js")>()
  return {
    ...actual,
    deploymentPayerActive: () => state.payerActive,
    allowanceEnforcementActive: () => state.payerActive && state.enforce,
    deploymentPayerId: () => state.payerId,
  }
})
vi.mock("@/ee/services/credits.js", () => ({
  CreditsService: {
    getBalance: mockGetBalance,
    checkCredits: vi.fn(),
    getModelCreditCost: vi.fn(),
    reserveCredits: vi.fn(),
    commitCredits: vi.fn(),
    refundCredits: vi.fn(),
    estimateWorkflowCredits: vi.fn(),
  },
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn(), admin: { getUserById: vi.fn() } } },
}))
vi.mock("@/middleware/credit-guard.js", () => ({ creditGuard: () => async () => {}, reserveCreditsForJob: vi.fn() }))
vi.mock("@/lib/private-plugins/load.js", () => ({ getPluginServices: () => ({ billing: undefined }) }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PUBLIC_URL: "https://app.nodaro.ai", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => true,
}))

import { creditsRoutes, invalidateBalanceCache } from "../credits.js"

const BALANCE = { total: 1500, subscription: 1500, topup: 0, dailySpent: 0, dailyLimit: null, monthlyAllocation: 0, tier: "free", effectiveTier: "free", features: {}, periodEnd: null, appCreditsAllowance: 0 }

let seq = 0
/** The balance cache is 15 s and keyed by userId — one user per case. */
const nextUserId = () => `00000000-0000-4000-8000-0000000008${String(++seq).padStart(2, "0")}`

let app: FastifyInstance
const usedUserIds: string[] = []

beforeEach(async () => {
  vi.clearAllMocks()
  state.payerActive = false
  state.enforce = false
  state.payerId = null
  mockGetBalance.mockResolvedValue(BALANCE)
  mockReadFreeGrant.mockResolvedValue(undefined)
  mockAllowanceFor.mockResolvedValue(null)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-test-user-id"]
    if (header && typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => { await creditsRoutes(instance) })
  await app.ready()
})
afterEach(async () => {
  for (const id of usedUserIds.splice(0)) invalidateBalanceCache(id)
  await app.close()
})

function getCredits(userId: string) {
  usedUserIds.push(userId)
  return app.inject({ method: "GET", url: "/v1/user/credits", headers: { "x-test-user-id": userId } })
}

describe("GET /v1/user/credits — the allowance rider", () => {
  it("mainline: no `allowance` key at all, and the free-grant settlement still runs", async () => {
    const res = await getCredits(nextUserId())
    expect(res.statusCode).toBe(200)
    const data = res.json().data as Record<string, unknown>
    expect(Object.hasOwn(data, "allowance")).toBe(false)
    expect(mockReadFreeGrant).toHaveBeenCalledTimes(1)
    expect(mockAllowanceFor).not.toHaveBeenCalled()
  })

  it("under a payer: `allowance` carries granted + remaining, in RAW credits", async () => {
    state.payerActive = true
    mockAllowanceFor.mockResolvedValue({ granted: 400_000, remaining: 399_900 })
    const res = await getCredits(nextUserId())
    const data = res.json().data as { allowance: unknown; total: number }
    expect(data.allowance).toEqual({ granted: 400_000, remaining: 399_900, enforced: false })
    // `total` still means what it always meant — it is NOT overloaded.
    expect(data.total).toBe(1500)
  })

  it("under a payer: exactly three keys travel, whatever the service grows", async () => {
    // The service's UserAllowance also carries `spent` for the admin list.
    // The wire shape here is fixed at three fields, so a spread would leak a
    // fourth the moment one lands.
    state.payerActive = true
    mockAllowanceFor.mockResolvedValue({ granted: 400_000, remaining: 399_900, spent: 100 })
    const res = await getCredits(nextUserId())
    const allowance = (res.json().data as { allowance: Record<string, unknown> }).allowance
    expect(Object.keys(allowance).sort()).toEqual(["enforced", "granted", "remaining"])
  })

  it("carries `enforced: false` while the allowance is VISIBLE but not enforced", async () => {
    // The pre-flip window (rollout step 5-7): an allowance exists and is shown
    // everywhere, and `reserve_credits` refuses over nothing. A browser that
    // gates a run on `remaining` here refuses runs the payer's pool would have
    // paid for — and `billing.allowances` is stripped from /config.js, so this
    // flag is the browser's only way to know.
    state.payerActive = true
    state.enforce = false
    mockAllowanceFor.mockResolvedValue({ granted: 1000, remaining: 0 })
    const res = await getCredits(nextUserId())
    const allowance = (res.json().data as { allowance: { enforced: boolean; remaining: number } }).allowance
    expect(allowance.enforced).toBe(false)
    // ...and the FIGURES are unchanged: an exhausted allowance still reports 0,
    // because the display surfaces render it whether or not it bites.
    expect(allowance.remaining).toBe(0)
  })

  it("carries `enforced: true` after the billing.allowances flip", async () => {
    state.payerActive = true
    state.enforce = true
    mockAllowanceFor.mockResolvedValue({ granted: 1000, remaining: 400 })
    const res = await getCredits(nextUserId())
    const allowance = (res.json().data as { allowance: { enforced: boolean } }).allowance
    expect(allowance.enforced).toBe(true)
  })

  it("under a payer: an unavailable allowance is null — present, and not 0", async () => {
    state.payerActive = true
    mockAllowanceFor.mockResolvedValue(null)
    const res = await getCredits(nextUserId())
    const data = res.json().data as Record<string, unknown>
    expect(Object.hasOwn(data, "allowance")).toBe(true)
    expect(data.allowance).toBeNull()
  })

  it("under a payer: an unavailable allowance is LOGGED, and still sent as null", async () => {
    // `null` is two answers on one wire: the payer's own exemption (D13) and
    // "the figure could not be read". The client can no longer misread the
    // second — it refuses on nothing but a PRESENT, ENFORCED allowance — so the
    // wire shape does not grow a field. But the fault must not be silent: a
    // deployment whose allowance reads are failing shows every user `total`
    // (the frozen signup grant) with no refusal and no error, which is exactly
    // the state nobody would think to look for. The route knows which null it
    // is — the payer's id is right here — so it says so once per read.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    state.payerActive = true
    state.payerId = "00000000-0000-4000-8000-0000000000ff"
    mockAllowanceFor.mockResolvedValue(null)
    const userId = nextUserId()
    const res = await getCredits(userId)
    expect(res.json().data.allowance).toBeNull()
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("allowance unavailable"), userId)
    spy.mockRestore()
  })

  it("under a payer: the PAYER's own null is NOT a fault and is not logged (D13)", async () => {
    // The payer holds the real credits rather than an allocation, so null is
    // the correct answer for it — logging that on every balance poll would
    // train the operator to ignore the line that matters.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    state.payerActive = true
    const payerId = nextUserId()
    state.payerId = payerId
    mockAllowanceFor.mockResolvedValue(null)
    const res = await getCredits(payerId)
    expect(res.json().data.allowance).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it("mainline: a null allowance is not a fault either — there is no such concept", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await getCredits(nextUserId())
    expect(Object.hasOwn(res.json().data as object, "allowance")).toBe(false)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it("under a payer: the free-grant settlement is SKIPPED", async () => {
    state.payerActive = true
    const res = await getCredits(nextUserId())
    expect(res.statusCode).toBe(200)
    expect(mockReadFreeGrant).not.toHaveBeenCalled()
    expect(mockRunSignupGrantClaim).not.toHaveBeenCalled()
    expect(Object.hasOwn(res.json().data as object, "freeGrantState")).toBe(false)
  })
})
