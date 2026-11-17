import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

/**
 * `uiMode` on the two Checkout routes (create-checkout-session and
 * create-load-session). A hosted request (no `uiMode`, or `"hosted"`) sends
 * Stripe exactly the parameters it always did, in the same key order, and
 * answers the same body byte for byte. An embedded one opens Stripe's form
 * inside the app's page: no return addresses, never a redirect, the app's
 * dark look, and the client secret in place of a url.
 */

// ---------------------------------------------------------------------------
// Mocks -- hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
}))

const mockStripe = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn() } },
  customers: { create: vi.fn(), update: vi.fn() },
  billingPortal: { sessions: { create: vi.fn() } },
  subscriptions: { retrieve: vi.fn(), update: vi.fn() },
}))
vi.mock("@/ee/billing/stripe-client.js", () => ({ getStripe: () => mockStripe }))

vi.mock("@/ee/billing/stripe-config.js", () => ({
  ON_SALE_PRICE_TO_PLAN: { pri_basic: { plan: "basic", interval: "monthly" } } as Record<string, { plan: string; interval: string }>,
  PRICE_TO_PLAN: { pri_basic: { plan: "basic", interval: "monthly" } } as Record<string, { plan: string; interval: string }>,
  TOP_UPS: { pri_pack: 8500 } as Record<string, number>,
  getTierFromPriceId: (priceId: string) => (priceId === "pri_basic" ? "basic" : "free"),
  TIER_CREDITS: { free: 1500, basic: 4500, standard: 11000, pro: 23000 } as Record<string, number>,
  TIER_STORAGE_LIMITS: { free: 1, basic: 2, standard: 3, pro: 4 } as Record<string, number>,
}))

vi.mock("@/ee/billing/provision-credits.js", () => ({ ensureStripeCustomer: vi.fn() }))

const surface = vi.hoisted(() => ({ selfServe: true }))
vi.mock("@/lib/surface-profile.js", () => ({
  runtimeSurfaceProfile: () => ({ billing: { selfServe: surface.selfServe } }),
}))
vi.mock("@/lib/deployment-payer.js", () => ({
  deploymentPayerId: () => null,
  payerCoverage: () => null,
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn(),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

// Fake Stripe keys are built at run time, never written whole.
const fakeKey = (kind: string, mode: string) => [kind, mode, "0".repeat(12)].join("_")

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    STRIPE_SECRET_KEY: "",
    STRIPE_PUBLISHABLE_KEY: "",
    VITE_STRIPE_PUBLISHABLE_KEY: "",
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
vi.mock("@/ee/billing/balance-cache.js", async () => ({ invalidateBalanceCache: (await import("@/ee/routes/credits.js")).invalidateBalanceCache }))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { billingRoutes } from "../billing.js"
import { supabase } from "../../../lib/supabase.js"
import { config } from "../../../lib/config.js"
import { EMBEDDED_CHECKOUT_BRANDING } from "../../billing/embedded-checkout.js"

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Per-table chains: `single()` answers `single`, awaiting the chain answers `list`. */
function mockTables(spec: Record<string, { single?: unknown; list?: unknown[] }>) {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const conf = spec[table] ?? {}
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const m of ["select", "eq", "is", "in", "order", "limit", "insert", "upsert", "update"]) chain[m] = vi.fn(self)
    chain.single = vi.fn(() => Promise.resolve(conf.single === undefined ? { data: null, error: { message: "Not found" } } : { data: conf.single, error: null }))
    chain.maybeSingle = chain.single
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: conf.list ?? null, error: null }).then(resolve)
    return chain
  }) as never)
}

const DEFAULT_TABLES = {
  stripe_customers: { single: { stripe_customer_id: "cus_1" } },
  profiles: { single: { email: "person@example.test" } },
  subscriptions: { list: [] },
}

let app: FastifyInstance

async function buildApp(hook: (req: FastifyRequest) => void): Promise<FastifyInstance> {
  const a = Fastify({ logger: false })
  a.addHook("preHandler", async (req) => hook(req))
  await a.register(async (instance) => { await billingRoutes(instance) })
  await a.ready()
  return a
}

beforeEach(async () => {
  vi.clearAllMocks()
  surface.selfServe = true
  config.STRIPE_SECRET_KEY = fakeKey("sk", "test")
  config.STRIPE_PUBLISHABLE_KEY = fakeKey("pk", "test")
  config.VITE_STRIPE_PUBLISHABLE_KEY = ""
  mockStripe.checkout.sessions.create.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.test/cs_test_1", client_secret: "sec_1" })
  mockStripe.customers.update.mockResolvedValue({})
  mockTables(DEFAULT_TABLES)
  app = await buildApp((req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
})

afterEach(async () => {
  await app.close()
})

function checkout(payload: Record<string, unknown>, on: FastifyInstance = app) {
  return on.inject({ method: "POST", url: "/v1/billing/create-checkout-session", headers: { origin: "https://tools.test" }, payload: { userId: "user-1", ...payload } })
}

function load(payload: Record<string, unknown>, on: FastifyInstance = app) {
  return on.inject({ method: "POST", url: "/v1/billing/create-load-session", headers: { origin: "https://tools.test" }, payload: { userId: "user-1", ...payload } })
}

/** The params the route handed Stripe's `checkout.sessions.create`. */
function createParams(): Record<string, unknown> {
  expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(1)
  return mockStripe.checkout.sessions.create.mock.calls[0][0] as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Hosted: exactly today's
// ---------------------------------------------------------------------------

const HOSTED_PACK_KEYS = ["customer", "mode", "line_items", "metadata", "subscription_data", "success_url", "cancel_url", "locale"]
const HOSTED_PLAN_KEYS = ["customer", "mode", "line_items", "metadata", "subscription_data", "allow_promotion_codes", "success_url", "cancel_url", "locale"]
const HOSTED_LOAD_KEYS = ["customer", "mode", "line_items", "metadata", "payment_intent_data", "success_url", "cancel_url", "locale"]

describe("a hosted request is exactly today's", () => {
  for (const uiMode of [undefined, "hosted"] as const) {
    it(`pack, uiMode ${uiMode}: same Stripe params in the same order, same body byte for byte`, async () => {
      const res = await checkout({ priceId: "pri_pack", returnPath: "/account/plans", ...(uiMode ? { uiMode } : {}) })
      expect(res.statusCode).toBe(200)
      const params = createParams()
      expect(Object.keys(params)).toEqual(HOSTED_PACK_KEYS)
      expect(params).toMatchObject({
        customer: "cus_1",
        mode: "payment",
        line_items: [{ price: "pri_pack", quantity: 1 }],
        metadata: { userId: "user-1", topupPriceId: "pri_pack" },
        success_url: "https://tools.test/account/plans?checkout=success",
        cancel_url: "https://tools.test/account/plans?checkout=cancelled",
        locale: "en",
      })
      expect(params.subscription_data).toBeUndefined()
      expect(res.body).toBe(JSON.stringify({ data: { url: "https://checkout.stripe.test/cs_test_1" } }))
    })

    it(`plan, uiMode ${uiMode}: same params in the same order, same body`, async () => {
      const res = await checkout({ priceId: "pri_basic", ...(uiMode ? { uiMode } : {}) })
      expect(res.statusCode).toBe(200)
      const params = createParams()
      expect(Object.keys(params)).toEqual(HOSTED_PLAN_KEYS)
      expect(params).toMatchObject({
        mode: "subscription",
        metadata: { userId: "user-1" },
        subscription_data: { metadata: { userId: "user-1" } },
        allow_promotion_codes: true,
        success_url: "https://tools.test/billing?success=true",
        cancel_url: "https://tools.test/pricing",
        locale: "en",
      })
      expect(res.body).toBe(JSON.stringify({ data: { url: "https://checkout.stripe.test/cs_test_1" } }))
    })

    it(`load, uiMode ${uiMode}: same params in the same order, same body`, async () => {
      const res = await load({ amountUsd: 20, embedded: true, ...(uiMode ? { uiMode } : {}) })
      expect(res.statusCode).toBe(200)
      const params = createParams()
      expect(Object.keys(params)).toEqual(HOSTED_LOAD_KEYS)
      expect(params).toMatchObject({
        mode: "payment",
        metadata: { userId: "user-1", kind: "load", loadUsd: "20" },
        payment_intent_data: { setup_future_usage: "off_session", receipt_email: "person@example.test" },
        success_url: "https://tools.test/checkout-complete?status=success",
        cancel_url: "https://tools.test/checkout-complete?status=cancelled",
        locale: "en",
      })
      const credits = (res.json() as { data: { credits: number } }).data.credits
      expect(typeof credits).toBe("number")
      expect(res.body).toBe(JSON.stringify({ data: { url: "https://checkout.stripe.test/cs_test_1", credits } }))
    })

    it(`pack with no returnPath, uiMode ${uiMode}: back to the top-up page, cancel to pricing`, async () => {
      const res = await checkout({ priceId: "pri_pack", ...(uiMode ? { uiMode } : {}) })
      expect(res.statusCode).toBe(200)
      const params = createParams()
      expect(Object.keys(params)).toEqual(HOSTED_PACK_KEYS)
      expect(params).toMatchObject({
        mode: "payment",
        metadata: { userId: "user-1", topupPriceId: "pri_pack" },
        success_url: "https://tools.test/billing?topup=true",
        cancel_url: "https://tools.test/pricing",
        locale: "en",
      })
      expect(params.subscription_data).toBeUndefined()
      expect(res.body).toBe(JSON.stringify({ data: { url: "https://checkout.stripe.test/cs_test_1" } }))
    })

    it(`pack with embedded: true, uiMode ${uiMode}: both ways to the checkout-complete page`, async () => {
      const res = await checkout({ priceId: "pri_pack", embedded: true, ...(uiMode ? { uiMode } : {}) })
      expect(res.statusCode).toBe(200)
      const params = createParams()
      expect(Object.keys(params)).toEqual(HOSTED_PACK_KEYS)
      expect(params).toMatchObject({
        mode: "payment",
        success_url: "https://tools.test/checkout-complete?status=success",
        cancel_url: "https://tools.test/checkout-complete?status=cancelled",
        locale: "en",
      })
      expect(res.body).toBe(JSON.stringify({ data: { url: "https://checkout.stripe.test/cs_test_1" } }))
    })

    it(`plan with embedded: true, uiMode ${uiMode}: both ways to the checkout-complete page`, async () => {
      const res = await checkout({ priceId: "pri_basic", embedded: true, ...(uiMode ? { uiMode } : {}) })
      expect(res.statusCode).toBe(200)
      const params = createParams()
      expect(Object.keys(params)).toEqual(HOSTED_PLAN_KEYS)
      expect(params).toMatchObject({
        mode: "subscription",
        allow_promotion_codes: true,
        success_url: "https://tools.test/checkout-complete?status=success",
        cancel_url: "https://tools.test/checkout-complete?status=cancelled",
        locale: "en",
      })
      expect(res.body).toBe(JSON.stringify({ data: { url: "https://checkout.stripe.test/cs_test_1" } }))
    })

    it(`load by default (no returnPath, no embedded), uiMode ${uiMode}: back to the top-up page, cancel to billing`, async () => {
      const res = await load({ amountUsd: 20, ...(uiMode ? { uiMode } : {}) })
      expect(res.statusCode).toBe(200)
      const params = createParams()
      expect(Object.keys(params)).toEqual(HOSTED_LOAD_KEYS)
      expect(params).toMatchObject({
        mode: "payment",
        metadata: { userId: "user-1", kind: "load", loadUsd: "20" },
        payment_intent_data: { setup_future_usage: "off_session", receipt_email: "person@example.test" },
        success_url: "https://tools.test/billing?topup=true",
        cancel_url: "https://tools.test/billing",
        locale: "en",
      })
      const credits = (res.json() as { data: { credits: number } }).data.credits
      expect(res.body).toBe(JSON.stringify({ data: { url: "https://checkout.stripe.test/cs_test_1", credits } }))
    })

    it(`load with returnPath, uiMode ${uiMode}: back to that path with the outcome added to its query`, async () => {
      const res = await load({ amountUsd: 20, returnPath: "/account?tab=wallet", ...(uiMode ? { uiMode } : {}) })
      expect(res.statusCode).toBe(200)
      const params = createParams()
      expect(Object.keys(params)).toEqual(HOSTED_LOAD_KEYS)
      expect(params).toMatchObject({
        mode: "payment",
        success_url: "https://tools.test/account?tab=wallet&checkout=success",
        cancel_url: "https://tools.test/account?tab=wallet&checkout=cancelled",
        locale: "en",
      })
      const credits = (res.json() as { data: { credits: number } }).data.credits
      expect(res.body).toBe(JSON.stringify({ data: { url: "https://checkout.stripe.test/cs_test_1", credits } }))
    })
  }
})

// ---------------------------------------------------------------------------
// Embedded
// ---------------------------------------------------------------------------

describe("an embedded request opens Stripe's form in the page", () => {
  it("an embedded pack session: embedded, never redirects, dark, no return addresses, the rest as hosted", async () => {
    const res = await checkout({ priceId: "pri_pack", uiMode: "embedded", returnPath: "/x", embedded: true })
    const params = createParams()
    expect(params).toMatchObject({
      ui_mode: "embedded",
      redirect_on_completion: "never",
      branding_settings: EMBEDDED_CHECKOUT_BRANDING,
      customer: "cus_1",
      mode: "payment",
      locale: "en",
      line_items: [{ price: "pri_pack", quantity: 1 }],
      metadata: { userId: "user-1", topupPriceId: "pri_pack" },
    })
    for (const k of ["success_url", "cancel_url", "return_url", "allow_promotion_codes"]) expect(params).not.toHaveProperty(k)
    expect(params.subscription_data).toBeUndefined()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toStrictEqual({ data: { url: null, clientSecret: "sec_1", sessionId: "cs_test_1" } })
  })

  it("an embedded plan session keeps promotion codes and the subscription's metadata", async () => {
    const res = await checkout({ priceId: "pri_basic", uiMode: "embedded" })
    expect(res.statusCode).toBe(200)
    const params = createParams()
    expect(params).toMatchObject({ mode: "subscription", allow_promotion_codes: true, subscription_data: { metadata: { userId: "user-1" } }, ui_mode: "embedded" })
    for (const k of ["success_url", "cancel_url", "return_url"]) expect(params).not.toHaveProperty(k)
  })

  it("an embedded load keeps the saved card and the receipt email, and answers the credits", async () => {
    const res = await load({ amountUsd: 20, uiMode: "embedded", returnPath: "/x" })
    expect(res.statusCode).toBe(200)
    const params = createParams()
    expect(params).toMatchObject({
      mode: "payment",
      payment_intent_data: { setup_future_usage: "off_session", receipt_email: "person@example.test" },
      metadata: { userId: "user-1", kind: "load", loadUsd: "20" },
      ui_mode: "embedded",
      redirect_on_completion: "never",
      branding_settings: EMBEDDED_CHECKOUT_BRANDING,
      locale: "en",
    })
    for (const k of ["success_url", "cancel_url", "return_url"]) expect(params).not.toHaveProperty(k)
    const body = res.json() as { data: Record<string, unknown> }
    expect(Object.keys(body.data)).toEqual(["url", "clientSecret", "sessionId", "credits"])
    expect(body.data).toMatchObject({ url: null, clientSecret: "sec_1", sessionId: "cs_test_1", credits: expect.any(Number) })
  })

  it("a subscriber's embedded plan: the same 409 as hosted, before Stripe is touched", async () => {
    mockTables({ ...DEFAULT_TABLES, subscriptions: { list: [{ id: "s1", status: "active" }] } })
    const res = await checkout({ priceId: "pri_basic", uiMode: "embedded" })
    expect(res.statusCode).toBe(409)
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it("no publishable key: 503 embedded_checkout_unavailable for both routes, before the database or Stripe", async () => {
    config.STRIPE_PUBLISHABLE_KEY = ""
    config.VITE_STRIPE_PUBLISHABLE_KEY = ""
    for (const res of [await checkout({ priceId: "pri_pack", uiMode: "embedded" }), await load({ amountUsd: 20, uiMode: "embedded" })]) {
      expect(res.statusCode).toBe(503)
      expect(res.json()).toStrictEqual({
        error: {
          code: "embedded_checkout_unavailable",
          message: "The in-page payment form is not available on this deployment. Use the Stripe Checkout page.",
        },
      })
    }
    expect(supabase.from).not.toHaveBeenCalled()
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled()
    expect(mockStripe.customers.update).not.toHaveBeenCalled()
  })

  it("no publishable key does not affect a hosted request", async () => {
    config.STRIPE_PUBLISHABLE_KEY = ""
    config.VITE_STRIPE_PUBLISHABLE_KEY = ""
    const pack = await checkout({ priceId: "pri_pack" })
    expect(pack.statusCode).toBe(200)
    expect(pack.json()).toStrictEqual({ data: { url: "https://checkout.stripe.test/cs_test_1" } })
    const viaHosted = await load({ amountUsd: 20, uiMode: "hosted" })
    expect(viaHosted.statusCode).toBe(200)
    expect((viaHosted.json() as { data: { url: string } }).data.url).toBe("https://checkout.stripe.test/cs_test_1")
  })

  it("an unknown uiMode is a 400 naming the field, before Stripe", async () => {
    for (const res of [await checkout({ priceId: "pri_pack", uiMode: "page" }), await load({ amountUsd: 20, uiMode: "page" })]) {
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('uiMode must be "hosted" or "embedded"')
    }
    // Checked before the other fields' messages.
    const both = await checkout({ uiMode: "page", returnPath: "//evil.test" })
    expect(both.json().error).toBe('uiMode must be "hosted" or "embedded"')
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it("a session Stripe returns without a client secret is a 500, never a body without one", async () => {
    mockStripe.checkout.sessions.create.mockResolvedValue({ id: "cs_test_1", url: null, client_secret: null })
    const pack = await checkout({ priceId: "pri_pack", uiMode: "embedded" })
    expect(pack.statusCode).toBe(500)
    expect(pack.json()).toStrictEqual({ error: "Failed to create checkout session" })
    const loaded = await load({ amountUsd: 20, uiMode: "embedded" })
    expect(loaded.statusCode).toBe(500)
    expect(loaded.json()).toStrictEqual({ error: "Failed to create load session" })
  })

  it("embedded still refuses an OAuth app token and a selfServe:false non-payer", async () => {
    const oauth = await buildApp((req) => {
      req.userId = "user-1"
      req.appAuthorization = { appId: "evil", authorizationId: "z", scopes: ["workflows:execute"] }
    })
    expect((await checkout({ priceId: "pri_pack", uiMode: "embedded" }, oauth)).statusCode).toBe(403)
    expect((await load({ amountUsd: 20, uiMode: "embedded" }, oauth)).statusCode).toBe(403)
    await oauth.close()

    surface.selfServe = false
    expect((await checkout({ priceId: "pri_pack", uiMode: "embedded" })).statusCode).toBe(403)
    expect((await load({ amountUsd: 20, uiMode: "embedded" })).statusCode).toBe(403)
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled()
  })
})

describe("the checkout session status read", () => {
  it("billingRoutes registers the status read", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/billing/checkout-session/cs_test_1" })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: "Authentication required" })
  })
})
