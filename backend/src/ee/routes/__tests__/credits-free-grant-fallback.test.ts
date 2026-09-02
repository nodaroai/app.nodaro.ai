import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The free-grant fallback on GET /v1/user/credits, at the route level.
 *
 * The production bug this pins: a thin client (recast/studio/person/voice)
 * calls this API CROSS-ORIGIN and never sends the keyed boot-time claim, so
 * waiting out FALLBACK_CLAIM_GRACE_MS strands the account at zero credits.
 * Any origin but our own page therefore claims immediately; our own page (and
 * a request with no Origin at all) keeps the grace for the keyed claim.
 */

const { mockGetBalance, mockReadFreeGrant, mockRunSignupGrantClaim } = vi.hoisted(() => ({
  mockGetBalance: vi.fn(),
  mockReadFreeGrant: vi.fn(),
  mockRunSignupGrantClaim: vi.fn(),
}))

// Only the two transition functions are doubled — `fallbackClaimDue` and
// `isForeignOrigin` are the REAL implementations, which is the point.
vi.mock("@/ee/billing/signup-grant.js", async () => {
  const actual = await vi.importActual<typeof import("@/ee/billing/signup-grant.js")>(
    "@/ee/billing/signup-grant.js",
  )
  return {
    ...actual,
    readFreeGrant: mockReadFreeGrant,
    runSignupGrantClaim: mockRunSignupGrantClaim,
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

const BALANCE = { subscriptionCredits: 0, topupCredits: 0, dailySpent: 0, tier: "free" }
/** A distinct user per test — the balance cache is 15 s and keyed by userId. */
let seq = 0
function nextUserId(): string {
  seq += 1
  return `00000000-0000-4000-8000-0000000009${String(seq).padStart(2, "0")}`
}

let app: FastifyInstance
const usedUserIds: string[] = []

beforeEach(async () => {
  vi.clearAllMocks()
  mockGetBalance.mockResolvedValue(BALANCE)
  mockRunSignupGrantClaim.mockResolvedValue({ state: "granted", granted: true, decision: null })

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

function getCredits(userId: string, headers: Record<string, string> = {}) {
  usedUserIds.push(userId)
  return app.inject({
    method: "GET",
    url: "/v1/user/credits",
    headers: { "x-test-user-id": userId, ...headers },
  })
}

/** An 'unclaimed' account created `ageMs` ago. */
function unclaimedAge(ageMs: number) {
  mockReadFreeGrant.mockResolvedValue({ state: "unclaimed", createdAt: new Date(Date.now() - ageMs) })
}

describe("GET /v1/user/credits — free-grant fallback vs. the caller's origin", () => {
  it("claims immediately for a cross-origin thin client, inside the grace", async () => {
    const userId = nextUserId()
    unclaimedAge(10_000)

    const res = await getCredits(userId, { origin: "https://recast.nodaro.ai" })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.freeGrantState).toBe("granted")
    expect(mockRunSignupGrantClaim).toHaveBeenCalledTimes(1)
    expect(mockRunSignupGrantClaim.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ userId, browserKey: null, deviceKey: null }),
    )
  })

  it("keeps the grace when there is no Origin header — the SPA's keyed claim is coming", async () => {
    const userId = nextUserId()
    unclaimedAge(10_000)

    const res = await getCredits(userId)

    expect(res.statusCode).toBe(200)
    expect(res.json().data.freeGrantState).toBe("unclaimed")
    expect(mockRunSignupGrantClaim).not.toHaveBeenCalled()
  })

  it("keeps the grace when the Origin IS our own page", async () => {
    // The one regression that would defeat the grace entirely.
    const userId = nextUserId()
    unclaimedAge(10_000)

    const res = await getCredits(userId, { origin: "https://app.nodaro.ai" })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.freeGrantState).toBe("unclaimed")
    expect(mockRunSignupGrantClaim).not.toHaveBeenCalled()
  })

  it("claims immediately for an origin we never published — no allowlist to forget a surface in", async () => {
    // A forged Origin on a curl skips the grace; that buys nothing a caller
    // did not already have by not running the SPA (see isForeignOrigin).
    const userId = nextUserId()
    unclaimedAge(10_000)

    const res = await getCredits(userId, { origin: "https://x.invalid" })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.freeGrantState).toBe("granted")
    expect(mockRunSignupGrantClaim).toHaveBeenCalledTimes(1)
  })

  it("keeps the grace on an opaque Origin — decides nothing on garbage", async () => {
    const userId = nextUserId()
    unclaimedAge(10_000)

    const res = await getCredits(userId, { origin: "null" })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.freeGrantState).toBe("unclaimed")
    expect(mockRunSignupGrantClaim).not.toHaveBeenCalled()
  })

  it("still claims same-origin once the grace has elapsed", async () => {
    const userId = nextUserId()
    unclaimedAge(3 * 60 * 1000)

    const res = await getCredits(userId)

    expect(res.statusCode).toBe(200)
    expect(res.json().data.freeGrantState).toBe("granted")
    expect(mockRunSignupGrantClaim).toHaveBeenCalledTimes(1)
  })
})
