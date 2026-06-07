import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

// ---------------------------------------------------------------------------
// Mocks -- hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
})

const mockStripe = {
  billingPortal: {
    sessions: {
      create: vi.fn(),
    },
  },
  subscriptions: {
    retrieve: vi.fn(),
    update: vi.fn(),
  },
}

vi.mock("@/ee/billing/stripe-client.js", () => ({
  getStripe: () => mockStripe,
}))

vi.mock("@/ee/billing/stripe-config.js", () => ({
  PRICE_TO_PLAN: {
    "pri_basic": { plan: "basic", interval: "monthly" },
    "pri_standard": { plan: "standard", interval: "monthly" },
    "pri_pro": { plan: "pro", interval: "monthly" },
  } as Record<string, { plan: string; interval: string }>,
  TOP_UPS: {} as Record<string, number>,
  getTierFromPriceId: (priceId: string) => {
    const map: Record<string, string> = {
      "pri_basic": "basic",
      "pri_standard": "standard",
      "pri_pro": "pro",
    }
    return map[priceId] || "free"
  },
  TIER_CREDITS: {
    free: 150,
    basic: 475,
    standard: 1175,
    pro: 2650,
  } as Record<string, number>,
  TIER_STORAGE_LIMITS: {
    free: 1 * 1024 * 1024 * 1024,
    basic: 10 * 1024 * 1024 * 1024,
    standard: 25 * 1024 * 1024 * 1024,
    pro: 50 * 1024 * 1024 * 1024,
  } as Record<string, number>,
}))

vi.mock("@/ee/billing/provision-credits.js", () => ({
  ensureStripeCustomer: vi.fn(),
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 1,
    watermark: false,
  }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/ee/routes/credits.js", () => ({
  invalidateBalanceCache: vi.fn(),
  creditsRoutes: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { billingRoutes } from "../billing.js"
import { supabase } from "../../../lib/supabase.js"
import { getStripe } from "../../billing/stripe-client.js"

const stripe = getStripe()

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

function createSupabaseChain(overrides: Record<string, unknown> = {}) {
  const defaults = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  }
  const chain = { ...defaults, ...overrides }

  // Each method returns the chain for fluent API, unless overridden
  for (const [key, value] of Object.entries(chain)) {
    if (!overrides[key] && typeof value === "function") {
      (chain as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain)
    }
  }

  return chain
}

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth -- set userId from body or query for test routes
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    const query = req.query as Record<string, unknown> | undefined
    const userId = body?.userId ?? query?.userId
    if (userId && typeof userId === "string") {
      req.userId = userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await billingRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Tests: GET /v1/billing/subscription
// ---------------------------------------------------------------------------

describe("GET /v1/billing/subscription", () => {
  it("returns 401 when no userId is provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/subscription",
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: "Authentication required" })
  })

  it("returns { data: null } when no subscription is found", async () => {
    const chain = createSupabaseChain({
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
    })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/subscription?userId=user-123",
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: null })
  })

  it("returns subscription data when found", async () => {
    const subscription = {
      id: "sub-1",
      stripe_subscription_id: "stripe_sub_1",
      tier: "pro",
      status: "active",
      stripe_price_id: "pri_pro",
      current_period_start: "2026-01-01",
      current_period_end: "2026-02-01",
      canceled_at: null,
    }

    const chain = createSupabaseChain({
      single: vi.fn().mockResolvedValue({ data: subscription, error: null }),
    })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/subscription?userId=user-123",
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: subscription })
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /v1/billing/transactions
// ---------------------------------------------------------------------------

describe("GET /v1/billing/transactions", () => {
  it("returns 401 when no userId is provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/transactions",
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: "Authentication required" })
  })

  it("returns empty array when no transactions exist", async () => {
    const chain = createSupabaseChain()
    // The final call in the chain resolves the query
    chain.limit = vi.fn().mockResolvedValue({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/transactions?userId=user-123",
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [] })
  })

  it("returns transactions list", async () => {
    const transactions = [
      {
        id: "txn-1",
        stripe_transaction_id: "stripe_txn_1",
        type: "subscription",
        amount_usd: 29,
        credits_granted: 235,
        tier: "standard",
        created_at: "2026-01-15T12:00:00Z",
      },
      {
        id: "txn-2",
        stripe_transaction_id: "stripe_txn_2",
        type: "topup",
        amount_usd: 10,
        credits_granted: 150,
        tier: null,
        created_at: "2026-01-20T12:00:00Z",
      },
    ]

    const chain = createSupabaseChain()
    chain.limit = vi.fn().mockResolvedValue({ data: transactions, error: null })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/transactions?userId=user-123",
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: transactions })
  })
})

// ---------------------------------------------------------------------------
// Tests: POST /v1/billing/manage-subscription
// ---------------------------------------------------------------------------

describe("POST /v1/billing/manage-subscription", () => {
  it("returns 401 when no userId is provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/manage-subscription",
      payload: {},
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: "Authentication required" })
  })

  it("returns 404 when no Stripe customer is found", async () => {
    const chain = createSupabaseChain({
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
    })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/manage-subscription",
      payload: { userId: "user-123" },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: "No Stripe customer found for this user" })
  })

  it("returns portal URL on success", async () => {
    const chain = createSupabaseChain({
      single: vi.fn().mockResolvedValue({
        data: { stripe_customer_id: "cus_123" },
        error: null,
      }),
    })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    vi.mocked(stripe.billingPortal.sessions.create).mockResolvedValue({
      url: "https://billing.stripe.com/session/abc",
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/manage-subscription",
      payload: { userId: "user-123" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: { url: "https://billing.stripe.com/session/abc" },
    })

    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_123",
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Tests: POST /v1/billing/change-plan
// ---------------------------------------------------------------------------

describe("POST /v1/billing/change-plan", () => {
  it("returns 400 when newPriceId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/change-plan",
      payload: { userId: "user-123" },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: "Authentication and newPriceId are required",
    })
  })

  it("returns 400 when newPriceId is not a valid subscription price", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/change-plan",
      payload: { userId: "user-123", newPriceId: "pri_unknown_invalid" },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: "Invalid price ID" })
  })

  it("returns success with new tier on valid plan change", async () => {
    const mockFrom = vi.mocked(supabase.from)
    let callCount = 0

    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // subscriptions select (find active subscription)
        const chain = createSupabaseChain({
          single: vi.fn().mockResolvedValue({
            data: {
              stripe_subscription_id: "sub_existing",
              stripe_price_id: "pri_basic",
              status: "active",
            },
            error: null,
          }),
        })
        return chain as never
      }
      if (callCount === 2) {
        // subscriptions update
        const chain = createSupabaseChain({
          eq: vi.fn().mockResolvedValue({ error: null, count: 1 }),
        })
        return chain as never
      }
      // profiles update
      const chain = createSupabaseChain({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })
      return chain as never
    })

    // stripe.subscriptions.retrieve returns subscription with items
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
      id: "sub_existing",
      items: { data: [{ id: "si_item_1" }] },
    } as never)

    vi.mocked(stripe.subscriptions.update).mockResolvedValue({
      id: "sub_existing",
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/change-plan",
      payload: { userId: "user-123", newPriceId: "pri_pro" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: { subscriptionId: "sub_existing", tier: "pro" },
    })

    expect(stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_existing",
      {
        items: [{ id: "si_item_1", price: "pri_pro" }],
        proration_behavior: "create_prorations",
      },
    )
  })
})

// Billing is a first-party UI action — an OAuth app token must never change the
// owner's Stripe subscription (real money) regardless of granted scope.
describe("billing routes reject OAuth app tokens", () => {
  async function appWithOAuth(): Promise<FastifyInstance> {
    const a = Fastify({ logger: false })
    a.addHook("preHandler", async (req: FastifyRequest) => {
      req.userId = "victim-1"
      req.appAuthorization = { appId: "evil", authorizationId: "z", scopes: ["workflows:execute"] }
    })
    await a.register(async (i) => { await billingRoutes(i) })
    await a.ready()
    return a
  }

  it("POST /v1/billing/change-plan returns 403 for an OAuth app token", async () => {
    const a = await appWithOAuth()
    const res = await a.inject({ method: "POST", url: "/v1/billing/change-plan", payload: { newPriceId: "pri_pro" } })
    expect(res.statusCode).toBe(403)
    await a.close()
  })

  it("POST /v1/billing/manage-subscription + create-checkout-session return 403 for OAuth app tokens", async () => {
    const a = await appWithOAuth()
    expect((await a.inject({ method: "POST", url: "/v1/billing/manage-subscription", payload: {} })).statusCode).toBe(403)
    expect((await a.inject({ method: "POST", url: "/v1/billing/create-checkout-session", payload: { priceId: "pri_pro" } })).statusCode).toBe(403)
    await a.close()
  })
})
