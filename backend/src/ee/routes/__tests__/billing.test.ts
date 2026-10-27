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
  checkout: {
    sessions: {
      create: vi.fn(),
    },
  },
  customers: {
    retrieve: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  paymentMethods: {
    list: vi.fn(),
  },
  invoices: {
    list: vi.fn(),
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
  // Mirrors the real TIER_CREDITS post-re-denomination. Kept in step on
  // purpose: a mock frozen at the old x0.1 values still passes every
  // assertion here, which is how a real drift stays invisible.
  TIER_CREDITS: {
    free: 1500,
    basic: 4500,
    standard: 11000,
    pro: 23000,
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

// The self-serve gate of the two Checkout routes: this deployment sells to its users.
vi.mock("@/lib/surface-profile.js", () => ({
  runtimeSurfaceProfile: () => ({ billing: { selfServe: true } }),
}))
vi.mock("@/lib/deployment-payer.js", () => ({
  deploymentPayerId: () => null,
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
// The leaf the consumers read from forwards to the mock above.
vi.mock("@/ee/billing/balance-cache.js", async () => ({ invalidateBalanceCache: (await import("@/ee/routes/credits.js")).invalidateBalanceCache }))

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
    is: vi.fn(),
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
    expect(res.json()).toEqual({ data: null, effectiveTier: "free" })
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
    // The route now also reports the derived entitlement tier — the shared
    // table mock feeds the profiles lookup the same pro row, and a stored
    // paid tier passes through the derivation untouched.
    expect(res.json()).toEqual({ data: subscription, effectiveTier: "pro" })
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

  it("GET /v1/billing/payment-method + invoices return 403 for OAuth app tokens — settings-grade data", async () => {
    const a = await appWithOAuth()
    expect((await a.inject({ method: "GET", url: "/v1/billing/payment-method" })).statusCode).toBe(403)
    expect((await a.inject({ method: "GET", url: "/v1/billing/invoices" })).statusCode).toBe(403)
    await a.close()
  })
})

// ---------------------------------------------------------------------------
// Tests: returnPath — where Stripe sends the person back
// ---------------------------------------------------------------------------

describe("returnPath on the Stripe hand-offs", () => {
  it("manage-subscription returns the portal to the calling origin's own path", async () => {
    const chain = createSupabaseChain({
      single: vi.fn().mockResolvedValue({ data: { stripe_customer_id: "cus_123" }, error: null }),
    })
    vi.mocked(supabase.from).mockReturnValue(chain as never)
    vi.mocked(stripe.billingPortal.sessions.create).mockResolvedValue({ url: "https://billing.stripe.com/session/abc" } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/manage-subscription",
      headers: { origin: "https://tools.example.com" },
      payload: { userId: "user-123", returnPath: "/settings/credits" },
    })

    expect(res.statusCode).toBe(200)
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ return_url: "https://tools.example.com/settings/credits" }),
    )
  })

  it("create-checkout-session refuses a returnPath that is not a plain path on this origin, before Stripe is touched", async () => {
    for (const returnPath of ["https://evil.example.com/x", "//evil.example.com/x", "/\\evil.example.com", "/\t/evil.example.com", "/billing#plans", "billing", "/a b"]) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/billing/create-checkout-session",
        payload: { userId: "user-123", priceId: "pri_pro", returnPath },
      })
      expect(res.statusCode, returnPath).toBe(400)
      expect(res.json().error, returnPath).toMatch(/returnPath/)
    }
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it("checkout and load send Stripe back to returnPath with the outcome in its query, keeping the query it had, over embedded", async () => {
    const chain = createSupabaseChain({
      single: vi.fn().mockResolvedValue({ data: { stripe_customer_id: "cus_123" }, error: null }),
    })
    vi.mocked(supabase.from).mockReturnValue(chain as never)
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({ url: "https://checkout.stripe.com/c/1" } as never)

    const checkout = await app.inject({
      method: "POST",
      url: "/v1/billing/create-checkout-session",
      headers: { origin: "https://tools.example.com" },
      payload: { userId: "user-123", priceId: "pri_pro", embedded: true, returnPath: "/settings/credits?tab=history" },
    })
    expect(checkout.statusCode).toBe(200)
    expect(checkout.json()).toEqual({ data: { url: "https://checkout.stripe.com/c/1" } })
    expect(stripe.checkout.sessions.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        success_url: "https://tools.example.com/settings/credits?tab=history&checkout=success",
        cancel_url: "https://tools.example.com/settings/credits?tab=history&checkout=cancelled",
      }),
    )

    const load = await app.inject({
      method: "POST",
      url: "/v1/billing/create-load-session",
      headers: { origin: "https://tools.example.com" },
      payload: { userId: "user-123", amountUsd: 20, returnPath: "/billing" },
    })
    expect(load.statusCode).toBe(200)
    expect(stripe.checkout.sessions.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        success_url: "https://tools.example.com/billing?checkout=success",
        cancel_url: "https://tools.example.com/billing?checkout=cancelled",
      }),
    )
  })

  it("the portal refuses a bad returnPath instead of ignoring it", async () => {
    const chain = createSupabaseChain({
      single: vi.fn().mockResolvedValue({ data: { stripe_customer_id: "cus_123" }, error: null }),
    })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/manage-subscription",
      payload: { userId: "user-123", returnPath: "https://evil.example.com" },
    })
    expect(res.statusCode).toBe(400)
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /v1/billing/payment-method
// ---------------------------------------------------------------------------

describe("GET /v1/billing/payment-method", () => {
  it("returns 401 when no userId is provided", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/billing/payment-method" })
    expect(res.statusCode).toBe(401)
  })

  it("answers both nulls for an account Stripe does not know yet, without calling Stripe", async () => {
    const chain = createSupabaseChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    const res = await app.inject({ method: "GET", url: "/v1/billing/payment-method?userId=user-123" })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { card: null, billingDetails: null } })
    expect(stripe.customers.retrieve).not.toHaveBeenCalled()
  })

  it("reads the default card and its billing details from the Stripe customer", async () => {
    const chain = createSupabaseChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: { stripe_customer_id: "cus_123" }, error: null }),
    })
    vi.mocked(supabase.from).mockReturnValue(chain as never)
    vi.mocked(stripe.customers.retrieve).mockResolvedValue({
      id: "cus_123",
      deleted: undefined,
      name: "Asaf",
      email: "asaf@example.com",
      address: { country: "IL" },
      invoice_settings: {
        default_payment_method: {
          id: "pm_1",
          card: { brand: "visa", last4: "1810", exp_month: 12, exp_year: 2030 },
          billing_details: { name: null, email: null, address: null },
        },
      },
    } as never)

    const res = await app.inject({ method: "GET", url: "/v1/billing/payment-method?userId=user-123" })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: {
        card: { brand: "visa", last4: "1810", expMonth: 12, expYear: 2030 },
        billingDetails: { name: "Asaf", email: "asaf@example.com", country: "IL" },
      },
    })
    expect(stripe.paymentMethods.list).not.toHaveBeenCalled()
  })

  it("falls back to the first saved card when the customer has no default", async () => {
    const chain = createSupabaseChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: { stripe_customer_id: "cus_123" }, error: null }),
    })
    vi.mocked(supabase.from).mockReturnValue(chain as never)
    vi.mocked(stripe.customers.retrieve).mockResolvedValue({ id: "cus_123", invoice_settings: { default_payment_method: null } } as never)
    vi.mocked(stripe.paymentMethods.list).mockResolvedValue({
      data: [{ id: "pm_2", card: { brand: "mastercard", last4: "4444", exp_month: 1, exp_year: 2031 }, billing_details: { name: "A", email: "a@b.c", address: { country: "US" } } }],
    } as never)

    const res = await app.inject({ method: "GET", url: "/v1/billing/payment-method?userId=user-123" })

    expect(res.json()).toEqual({
      data: { card: { brand: "mastercard", last4: "4444", expMonth: 1, expYear: 2031 }, billingDetails: { name: "A", email: "a@b.c", country: "US" } },
    })
    expect(stripe.paymentMethods.list).toHaveBeenCalledWith({ customer: "cus_123", type: "card", limit: 1 })
  })

  it("falls back to a saved card when the default payment method is not a card", async () => {
    const chain = createSupabaseChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: { stripe_customer_id: "cus_123" }, error: null }),
    })
    vi.mocked(supabase.from).mockReturnValue(chain as never)
    vi.mocked(stripe.customers.retrieve).mockResolvedValue({ id: "cus_123", invoice_settings: { default_payment_method: { id: "pm_link", type: "link", link: {} } } } as never)
    vi.mocked(stripe.paymentMethods.list).mockResolvedValue({ data: [{ id: "pm_2", card: { brand: "visa", last4: "0001", exp_month: 2, exp_year: 2032 }, billing_details: {} }] } as never)

    const res = await app.inject({ method: "GET", url: "/v1/billing/payment-method?userId=user-123" })
    expect(res.json().data.card).toEqual({ brand: "visa", last4: "0001", expMonth: 2, expYear: 2032 })
  })

  it("answers 500, not 'nothing on file', when the customer lookup or Stripe fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const broken = createSupabaseChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "down" } }),
    })
    vi.mocked(supabase.from).mockReturnValue(broken as never)
    expect((await app.inject({ method: "GET", url: "/v1/billing/payment-method?userId=user-123" })).statusCode).toBe(500)

    const known = createSupabaseChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: { stripe_customer_id: "cus_123" }, error: null }),
    })
    vi.mocked(supabase.from).mockReturnValue(known as never)
    vi.mocked(stripe.customers.retrieve).mockRejectedValue(new Error("stripe down"))
    expect((await app.inject({ method: "GET", url: "/v1/billing/payment-method?userId=user-123" })).statusCode).toBe(500)
    error.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /v1/billing/invoices
// ---------------------------------------------------------------------------

describe("GET /v1/billing/invoices", () => {
  const purchase = { id: "tx_1", type: "topup", amount_usd: "35.00", credits_granted: 3000, status: "completed", created_at: "2026-10-25T22:02:00.000Z", receipt_url: "https://pay.stripe.com/receipts/r1" }
  const refund = { id: "tx_r", type: "refund", amount_usd: "35.00", credits_granted: -3000, status: "completed", created_at: "2026-10-26T09:00:00.000Z", receipt_url: null }

  it("returns 401 when no userId is provided", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/billing/invoices" })
    expect(res.statusCode).toBe(401)
  })

  it("merges Stripe invoices, credit-purchase receipts and refunds, newest first, skipping drafts", async () => {
    const purchases = createSupabaseChain({
      limit: vi.fn().mockResolvedValue({ data: [refund, purchase], error: null }),
    })
    const customer = createSupabaseChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: { stripe_customer_id: "cus_123" }, error: null }),
    })
    vi.mocked(supabase.from).mockImplementation(((table: string) => (table === "transactions" ? purchases : customer)) as never)
    vi.mocked(stripe.invoices.list).mockResolvedValue({
      data: [
        { id: "in_new", number: "A-0002", created: 1_767_312_000, total: 1200, currency: "usd", status: "paid", description: null, invoice_pdf: "https://x/in_new.pdf", hosted_invoice_url: "https://x/in_new", lines: { data: [{ description: "Pro (monthly)" }] } },
        { id: "in_draft", number: null, created: 1_800_000_000, total: 0, currency: "usd", status: "draft", lines: { data: [] } },
      ],
    } as never)

    const res = await app.inject({ method: "GET", url: "/v1/billing/invoices?userId=user-123" })

    expect(res.statusCode).toBe(200)
    const docs = res.json().data as Array<{ id: string; kind: string; status: string; credits: number | null; amount: { amount: number }; pdfUrl: string | null; url: string | null }>
    expect(docs.map((d) => d.id)).toEqual(["tx_r", "tx_1", "in_new"])
    expect(docs[0]).toMatchObject({ kind: "receipt", status: "refunded", credits: -3000, amount: { amount: -35 }, url: null })
    expect(docs[1]).toMatchObject({ kind: "receipt", status: "paid", credits: 3000, pdfUrl: null, url: "https://pay.stripe.com/receipts/r1" })
    expect(docs[2]).toMatchObject({ kind: "invoice", status: "paid", credits: null, pdfUrl: "https://x/in_new.pdf", url: "https://x/in_new" })
    // The person's own purchases and refunds, never an organization's.
    expect(purchases.eq).toHaveBeenCalledWith("user_id", "user-123")
    expect(purchases.in).toHaveBeenCalledWith("type", ["topup", "refund"])
    expect(purchases.is).toHaveBeenCalledWith("org_id", null)
    expect(stripe.invoices.list).toHaveBeenCalledWith({ customer: "cus_123", limit: 100 })
  })

  it("answers 500 when Stripe fails, never a list missing the invoices", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const purchases = createSupabaseChain({ limit: vi.fn().mockResolvedValue({ data: [purchase], error: null }) })
    const customer = createSupabaseChain({ maybeSingle: vi.fn().mockResolvedValue({ data: { stripe_customer_id: "cus_123" }, error: null }) })
    vi.mocked(supabase.from).mockImplementation(((table: string) => (table === "transactions" ? purchases : customer)) as never)
    vi.mocked(stripe.invoices.list).mockRejectedValue(new Error("stripe down"))

    const res = await app.inject({ method: "GET", url: "/v1/billing/invoices?userId=user-123" })
    expect(res.statusCode).toBe(500)
    error.mockRestore()
  })

  it("lists the receipts alone for an account Stripe does not know yet", async () => {
    const purchases = createSupabaseChain({
      limit: vi.fn().mockResolvedValue({ data: [purchase], error: null }),
    })
    const customer = createSupabaseChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    vi.mocked(supabase.from).mockImplementation(((table: string) => (table === "transactions" ? purchases : customer)) as never)

    const res = await app.inject({ method: "GET", url: "/v1/billing/invoices?userId=user-123" })

    expect(res.statusCode).toBe(200)
    expect((res.json().data as Array<{ id: string }>).map((d) => d.id)).toEqual(["tx_1"])
    expect(stripe.invoices.list).not.toHaveBeenCalled()
  })
})
