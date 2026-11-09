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
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
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
    retrieve: vi.fn(),
    listLineItems: vi.fn(),
  },
}

vi.mock("@/ee/billing/stripe-client.js", () => ({
  getStripe: () => mockStripe,
}))

vi.mock("@/ee/billing/stripe-config.js", () => ({
  ON_SALE_PRICE_TO_PLAN: {
    "pri_basic": { plan: "basic", interval: "monthly" },
    "pri_standard": { plan: "standard", interval: "monthly" },
    "pri_pro": { plan: "pro", interval: "monthly" },
  } as Record<string, { plan: string; interval: string }>,
  PRICE_TO_PLAN: {
    "pri_basic": { plan: "basic", interval: "monthly" },
    "pri_standard": { plan: "standard", interval: "monthly" },
    "pri_pro": { plan: "pro", interval: "monthly" },
  } as Record<string, { plan: string; interval: string }>,
  TOP_UPS: { "pri_pack": 8500 } as Record<string, number>,
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
const payerState = vi.hoisted(() => ({ coverage: null as null | { payerId: string; tier: string; storedTier: string } }))
vi.mock("@/lib/deployment-payer.js", () => ({
  deploymentPayerId: () => null,
  payerCoverage: () => payerState.coverage,
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

import { billingRoutes, CHANGE_PLAN_DAILY_LIMIT, CHANGE_PLAN_RATE_LIMIT } from "../billing.js"
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

/**
 * Per-table chains: `single()` answers `single`, awaiting the chain answers
 * `list` (or a successful write), and every update payload is recorded.
 */
function mockTables(spec: Record<string, { single?: unknown; list?: unknown[] }>) {
  const recorded: Array<{ table: string; payload: Record<string, unknown> }> = []
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const conf = spec[table] ?? {}
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const m of ["select", "eq", "is", "in", "order", "limit", "insert", "upsert"]) chain[m] = vi.fn(self)
    chain.update = vi.fn((payload: Record<string, unknown>) => {
      recorded.push({ table, payload })
      return chain
    })
    chain.single = vi.fn(() => Promise.resolve(conf.single === undefined ? { data: null, error: { message: "Not found" } } : { data: conf.single, error: null }))
    chain.maybeSingle = chain.single
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: conf.list ?? null, error: null }).then(resolve)
    return chain
  }) as never)
  return { updates: (table: string) => recorded.filter((r) => r.table === table).map((r) => r.payload) }
}

const activeBasic = { stripe_subscription_id: "sub_existing", stripe_price_id: "pri_basic", status: "active" }

function liveSub(overrides: Record<string, unknown> = {}) {
  return { id: "sub_existing", status: "active", pending_update: null, items: { data: [{ id: "si_item_1" }] }, ...overrides }
}

const paidUpgradeInvoice = {
  id: "in_up_1",
  status: "paid",
  billing_reason: "subscription_update",
  amount_paid: 1850,
  lines: {
    has_more: false,
    data: [
      { amount: -650, pricing: { price_details: { price: "pri_basic" } } },
      { amount: 2500, pricing: { price_details: { price: "pri_pro" } } },
    ],
  },
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

  it("under a deployment payer, effectiveTier is the payer account's grade, with no read of the user's row (decided 2026-11-08)", async () => {
    payerState.coverage = { payerId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", tier: "business", storedTier: "business" }
    try {
      const chain = createSupabaseChain({
        single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
      })
      vi.mocked(supabase.from).mockReturnValue(chain as never)

      const res = await app.inject({ method: "GET", url: "/v1/billing/subscription?userId=user-123" })

      expect(res.json()).toEqual({ data: null, effectiveTier: "business" })
      expect(vi.mocked(supabase.from).mock.calls.map((c) => c[0])).toEqual(["subscriptions"])
    } finally {
      payerState.coverage = null
    }
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

  it("an upgrade invoices the difference now and applies only once paid; credits come from the paid invoice, never a SET", async () => {
    const tables = mockTables({ subscriptions: { single: activeBasic } })
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(liveSub() as never)
    vi.mocked(stripe.subscriptions.update).mockResolvedValue({ id: "sub_existing", pending_update: null, latest_invoice: "in_up_1" } as never)
    vi.mocked(stripe.invoices.retrieve).mockResolvedValue(paidUpgradeInvoice as never)
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [{ claimed: true, granted_credits: 18500 }], error: null } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/change-plan",
      payload: { userId: "user-123", newPriceId: "pri_pro" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { subscriptionId: "sub_existing", tier: "pro" } })
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_existing", {
      items: [{ id: "si_item_1", price: "pri_pro" }],
      proration_behavior: "always_invoice",
      payment_behavior: "pending_if_incomplete",
    })
    // Credits are ADDED by the keyed grant on the paid invoice — the gap only.
    expect(supabase.rpc).toHaveBeenCalledWith("grant_plan_change_credits", {
      p_user_id: "user-123",
      p_invoice_id: "in_up_1",
      p_from_credits: 4500,
      p_to_credits: 23000,
      p_amount_usd: 18.5,
      p_tier: "pro",
    })
    expect(tables.updates("profiles").some((p) => "subscription_credits" in p)).toBe(false)
    expect(tables.updates("profiles")).toContainEqual(expect.objectContaining({ subscription_tier: "pro" }))
  })

  it("an upgrade whose payment did not complete changes nothing locally and answers 409 with the invoice to pay", async () => {
    const tables = mockTables({ subscriptions: { single: activeBasic } })
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(liveSub() as never)
    vi.mocked(stripe.subscriptions.update).mockResolvedValue({
      id: "sub_existing",
      pending_update: { expires_at: 1_900_000_000, subscription_items: [] },
      latest_invoice: "in_up_2",
    } as never)
    vi.mocked(stripe.invoices.retrieve).mockResolvedValue({ id: "in_up_2", status: "open", hosted_invoice_url: "https://invoice.stripe.com/i/2" } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/change-plan",
      payload: { userId: "user-123", newPriceId: "pri_pro" },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({
      code: "plan_change_payment_required",
      message: expect.any(String),
      invoiceUrl: "https://invoice.stripe.com/i/2",
    })
    expect(tables.updates("subscriptions")).toEqual([])
    expect(tables.updates("profiles")).toEqual([])
    expect(supabase.rpc).not.toHaveBeenCalledWith("grant_plan_change_credits", expect.anything())
  })

  it("refuses a subscription that is not active (past_due), before Stripe is touched", async () => {
    mockTables({ subscriptions: { single: { ...activeBasic, status: "past_due" } } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/change-plan",
      payload: { userId: "user-123", newPriceId: "pri_pro" },
    })

    expect(res.statusCode).toBe(409)
    expect(stripe.subscriptions.update).not.toHaveBeenCalled()
  })

  it("refuses while Stripe holds the subscription in another state, or a change awaits payment", async () => {
    mockTables({ subscriptions: { single: activeBasic } })
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(liveSub({ status: "past_due" }) as never)
    const notActive = await app.inject({ method: "POST", url: "/v1/billing/change-plan", payload: { userId: "user-123", newPriceId: "pri_pro" } })
    expect(notActive.statusCode).toBe(409)

    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(liveSub({ pending_update: { expires_at: 1 }, latest_invoice: "in_waiting" }) as never)
    vi.mocked(stripe.invoices.retrieve).mockResolvedValue({ id: "in_waiting", status: "open", hosted_invoice_url: "https://invoice.stripe.com/i/w" } as never)
    const pending = await app.inject({ method: "POST", url: "/v1/billing/change-plan", payload: { userId: "user-123", newPriceId: "pri_pro" } })
    expect(pending.statusCode).toBe(409)
    // The change already waiting: the same answer, pointing at its invoice.
    expect(pending.json().error).toMatchObject({ code: "plan_change_payment_required", invoiceUrl: "https://invoice.stripe.com/i/w" })
    expect(stripe.subscriptions.update).not.toHaveBeenCalled()
  })

  it("a downgrade keeps today's terms (credited at the next invoice, no clawback) and notes the plan held this period", async () => {
    const tables = mockTables({ subscriptions: { single: { ...activeBasic, stripe_price_id: "pri_pro" } } })
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(liveSub() as never)
    vi.mocked(stripe.subscriptions.update).mockResolvedValue({ id: "sub_existing", pending_update: null, latest_invoice: "in_cycle_0" } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/change-plan",
      payload: { userId: "user-123", newPriceId: "pri_basic" },
    })

    expect(res.statusCode).toBe(200)
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_existing", {
      items: [{ id: "si_item_1", price: "pri_basic" }],
      proration_behavior: "create_prorations",
    })
    expect(supabase.rpc).toHaveBeenCalledWith("note_plan_credit_peak", { p_user_id: "user-123", p_credits: 23000 })
    expect(supabase.rpc).not.toHaveBeenCalledWith("grant_plan_change_credits", expect.anything())
    const profileWrites = tables.updates("profiles")
    expect(profileWrites.some((p) => "subscription_credits" in p)).toBe(false)
    expect(profileWrites.some((p) => "storage_limit_bytes" in p)).toBe(false)
  })
})

describe("POST /v1/billing/change-plan — a few changes per account per day", () => {
  it(`allows ${CHANGE_PLAN_DAILY_LIMIT} a day per account, keyed on the account rather than the session token`, async () => {
    const { default: rateLimit } = await import("@fastify/rate-limit")
    const limited = Fastify({ logger: false })
    await limited.register(rateLimit, { global: false })
    limited.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await limited.register(async (instance) => {
      await billingRoutes(instance)
    })
    await limited.ready()
    // Every attempt is refused before Stripe (unknown price): refusals count too.
    const attempt = (userId: string, token: string) =>
      limited.inject({
        method: "POST",
        url: "/v1/billing/change-plan",
        headers: { authorization: `Bearer ${token}` },
        payload: { userId, newPriceId: "pri_unknown_invalid" },
      })

    for (let i = 0; i < CHANGE_PLAN_DAILY_LIMIT; i++) {
      expect((await attempt("user-a", `token-${i}`)).statusCode).toBe(400)
    }
    expect((await attempt("user-a", "token-fresh")).statusCode).toBe(429)
    // Another account has its own allowance.
    expect((await attempt("user-b", "token-b")).statusCode).toBe(400)
    await limited.close()
  })

  it("declares the limit on the route: per day, after auth", () => {
    expect(CHANGE_PLAN_RATE_LIMIT.rateLimit).toMatchObject({ max: CHANGE_PLAN_DAILY_LIMIT, timeWindow: "24 hours", hook: "preHandler" })
    expect(CHANGE_PLAN_DAILY_LIMIT).toBe(5)
  })
})

describe("POST /v1/billing/create-checkout-session — one subscription per account, promotion codes on plans only", () => {
  it("refuses a second subscription while one is active or past_due, before Stripe is touched", async () => {
    for (const status of ["active", "past_due"]) {
      mockTables({ subscriptions: { list: [{ id: "sub-row", status }] }, stripe_customers: { single: { stripe_customer_id: "cus_123" } } })
      const res = await app.inject({
        method: "POST",
        url: "/v1/billing/create-checkout-session",
        payload: { userId: "user-123", priceId: "pri_pro" },
      })
      expect(res.statusCode, status).toBe(409)
    }
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it("a first subscription opens Checkout with promotion codes allowed", async () => {
    mockTables({ subscriptions: { list: [] }, stripe_customers: { single: { stripe_customer_id: "cus_123" } } })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({ url: "https://checkout.stripe.com/c/sub" } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/create-checkout-session",
      payload: { userId: "user-123", priceId: "pri_pro" },
    })

    expect(res.statusCode).toBe(200)
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "subscription", allow_promotion_codes: true }),
    )
  })

  it("a credit pack opens Checkout without promotion codes, whatever subscription the account has", async () => {
    mockTables({ subscriptions: { list: [{ id: "sub-row", status: "active" }] }, stripe_customers: { single: { stripe_customer_id: "cus_123" } } })
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({ url: "https://checkout.stripe.com/c/pack" } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/create-checkout-session",
      payload: { userId: "user-123", priceId: "pri_pack" },
    })

    expect(res.statusCode).toBe(200)
    const params = vi.mocked(stripe.checkout.sessions.create).mock.calls[0][0] as Record<string, unknown>
    expect(params.mode).toBe("payment")
    expect("allow_promotion_codes" in params && params.allow_promotion_codes !== undefined).toBe(false)
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
