import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `welcomeOffer` on GET /v1/user/credits — the one field every app reads to
 * decide popup / banner / block. Three rules pinned:
 *  - offer OFF: the key is ABSENT (a client renders absent as "nothing").
 *  - offer ON: the two flags and the claim's credit amount ride beside
 *    `freeGrantState`.
 *  - offer ON but the columns cannot be read (dev ahead of migration 426, or
 *    a read error): the key is absent and the balance still answers 200 —
 *    the pre-migration fail-open the whole feature relies on.
 */

const { mockGetBalance, mockReadFreeGrant, mockRunSignupGrantClaim, mockReadWelcomeOfferState, mockConfig } = vi.hoisted(() => ({
  mockGetBalance: vi.fn(),
  mockReadFreeGrant: vi.fn(),
  mockRunSignupGrantClaim: vi.fn(),
  mockReadWelcomeOfferState: vi.fn(),
  mockConfig: vi.fn(),
}))

vi.mock("@/ee/billing/signup-grant.js", async () => {
  const actual = await vi.importActual<typeof import("@/ee/billing/signup-grant.js")>("@/ee/billing/signup-grant.js")
  return {
    ...actual,
    readFreeGrant: mockReadFreeGrant,
    runSignupGrantClaim: mockRunSignupGrantClaim,
    readWelcomeOfferState: mockReadWelcomeOfferState,
  }
})
vi.mock("@/ee/lib/welcome-offer-config.js", () => ({ getWelcomeOfferConfig: mockConfig }))
vi.mock("@/ee/billing/welcome-offer-claim-options.js", () => ({ welcomeClaimOptions: vi.fn().mockResolvedValue({}) }))

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
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn(), admin: { getUserById: vi.fn() } },
  },
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn(),
}))

vi.mock("@/lib/private-plugins/load.js", () => ({
  getPluginServices: () => ({ billing: undefined }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    PUBLIC_URL: "https://app.nodaro.ai",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => true,
}))

import { creditsRoutes, invalidateBalanceCache } from "../credits.js"
import { TIER_CREDITS } from "../../billing/stripe-config.js"

const BALANCE = { subscriptionCredits: 0, topupCredits: 0, dailySpent: 0, tier: "free" }
let seq = 0
function nextUserId(): string {
  seq += 1
  return `00000000-0000-4000-8000-0000000007${String(seq).padStart(2, "0")}`
}

let app: FastifyInstance
const usedUserIds: string[] = []

beforeEach(async () => {
  vi.clearAllMocks()
  mockGetBalance.mockResolvedValue(BALANCE)
  mockReadFreeGrant.mockResolvedValue({ state: "granted", createdAt: new Date(Date.now() - 86_400_000) })
  mockConfig.mockResolvedValue({ enabled: false })

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-test-user-id"]
    if (header && typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await creditsRoutes(instance)
  })
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

describe("GET /v1/user/credits — welcomeOffer", () => {
  it("offer OFF: the key is absent and the columns are never read", async () => {
    const res = await getCredits(nextUserId())
    expect(res.statusCode).toBe(200)
    expect(res.json().data).not.toHaveProperty("welcomeOffer")
    expect(res.json().data.freeGrantState).toBe("granted")
    expect(mockReadWelcomeOfferState).not.toHaveBeenCalled()
  })

  it("offer ON: the two flags ride beside freeGrantState", async () => {
    mockConfig.mockResolvedValue({ enabled: true })
    mockReadWelcomeOfferState.mockResolvedValue({ popupSeen: true, consentPending: true })
    const res = await getCredits(nextUserId())
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({
      freeGrantState: "granted",
      welcomeOffer: { popupSeen: true, consentPending: true },
    })
  })

  it("offer ON: carries the amount the claim grants, from the claim's own source", async () => {
    mockConfig.mockResolvedValue({ enabled: true })
    mockReadWelcomeOfferState.mockResolvedValue({ popupSeen: false, consentPending: false })
    const res = await getCredits(nextUserId())
    expect(res.statusCode).toBe(200)
    expect(res.json().data.welcomeOffer).toEqual({
      popupSeen: false,
      consentPending: false,
      credits: TIER_CREDITS.free,
    })
    expect(TIER_CREDITS.free).toBeGreaterThan(0)
  })

  it("offer ON but the columns cannot be read (pre-migration): absent, and the balance still answers", async () => {
    mockConfig.mockResolvedValue({ enabled: true })
    mockReadWelcomeOfferState.mockResolvedValue(null)
    const res = await getCredits(nextUserId())
    expect(res.statusCode).toBe(200)
    expect(res.json().data).not.toHaveProperty("welcomeOffer")
    expect(res.json().data.freeGrantState).toBe("granted")
  })

  it("offer ON and the read throws: still 200, key absent", async () => {
    mockConfig.mockResolvedValue({ enabled: true })
    mockReadWelcomeOfferState.mockRejectedValue(new Error("column does not exist"))
    const res = await getCredits(nextUserId())
    expect(res.statusCode).toBe(200)
    expect(res.json().data).not.toHaveProperty("welcomeOffer")
  })
})
