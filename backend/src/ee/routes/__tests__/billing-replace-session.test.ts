import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import Stripe from "stripe"

/**
 * `replacesSessionId` on the two Checkout routes (create-checkout-session and
 * create-load-session): the Checkout session a new one replaces. Read first
 * (only the caller's own), refused when it is paid or being paid, expired
 * when it is open and nobody is paying it, and only then is the new session
 * created. Without the field nothing changes.
 */

// ---------------------------------------------------------------------------
// Mocks -- hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
}))

const mockStripe = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn(), retrieve: vi.fn(), expire: vi.fn() } },
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
import { CHECKOUT_SESSION_NOT_FOUND } from "../../billing/checkout-status.js"

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Per-table chains: `single()` answers `single`, awaiting the chain answers `list`. */
function mockTables(spec: Record<string, { single?: unknown; list?: unknown[] }>) {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const conf = spec[table] ?? {}
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const m of ["select", "eq", "is", "in", "not", "order", "limit", "insert", "upsert", "update"]) chain[m] = vi.fn(self)
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

const HOSTED_PACK_KEYS = ["customer", "mode", "line_items", "metadata", "subscription_data", "success_url", "cancel_url", "locale"]
const HOSTED_LOAD_KEYS = ["customer", "mode", "line_items", "metadata", "payment_intent_data", "success_url", "cancel_url", "locale"]

const sessions = mockStripe.checkout.sessions

beforeEach(() => {
  sessions.retrieve.mockReset()
  sessions.expire.mockReset()
})

/** The first session, as the checkout route creates a pack's (`pri_pack`). */
const firstOpen = (o: Record<string, unknown> = {}) => ({
  id: "cs_first",
  customer: "cus_1",
  mode: "payment",
  status: "open",
  payment_status: "unpaid",
  payment_intent: null,
  subscription: null,
  metadata: { userId: "u1", topupPriceId: "pri_pack" },
  ...o,
})
/** As the load route creates a load's ($20). */
const firstLoad = (o: Record<string, unknown> = {}) => firstOpen({ metadata: { userId: "u1", kind: "load", loadUsd: "20" }, ...o })
/** As the checkout route creates a plan's. */
const firstPlan = (o: Record<string, unknown> = {}) => firstOpen({ mode: "subscription", metadata: { userId: "u1" }, ...o })

const refused = () =>
  Object.assign(
    new Stripe.errors.StripeInvalidRequestError({ message: "This Checkout Session is not in an expireable state" } as never),
    { statusCode: 400 },
  )

const COMPLETE = {
  error: { code: "checkout_already_complete", message: "This purchase has already been paid. Nothing new was started." },
}
const IN_PROGRESS = {
  error: {
    code: "checkout_in_progress",
    message: "The payment for this purchase is still being confirmed. Nothing new was started.",
  },
}
const NOT_FOUND = { error: { code: "checkout_session_not_found", message: "No checkout session with this id on your account." } }

function nothingStarted() {
  expect(sessions.expire).not.toHaveBeenCalled()
  expect(sessions.create).not.toHaveBeenCalled()
}

// ---------------------------------------------------------------------------
// Absent: exactly today's
// ---------------------------------------------------------------------------

describe("without replacesSessionId", () => {
  it("absent field: no extra Stripe call, today's hosted answer", async () => {
    const res = await checkout({ priceId: "pri_pack", returnPath: "/account/plans", userId: "u1" })
    expect(res.statusCode).toBe(200)
    expect(Object.keys(createParams())).toEqual(HOSTED_PACK_KEYS)
    expect(res.body).toBe(JSON.stringify({ data: { url: "https://checkout.stripe.test/cs_test_1" } }))
    expect(sessions.retrieve).not.toHaveBeenCalled()
    expect(sessions.expire).not.toHaveBeenCalled()
  })

  it("absent field on a load: no extra Stripe call", async () => {
    const res = await load({ amountUsd: 20, userId: "u1" })
    expect(res.statusCode).toBe(200)
    expect(Object.keys(createParams())).toEqual(HOSTED_LOAD_KEYS)
    expect(sessions.retrieve).not.toHaveBeenCalled()
    expect(sessions.expire).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Replacing
// ---------------------------------------------------------------------------

describe("replacing a session", () => {
  it("reads the named session with its payment and subscription expanded", async () => {
    sessions.retrieve.mockResolvedValue(firstOpen({ status: "expired" }))
    await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })
    expect(sessions.retrieve).toHaveBeenCalledWith("cs_first", { expand: ["payment_intent", "subscription"] })
  })

  it("an open first session is expired, then the hosted one is created, in that order", async () => {
    sessions.retrieve.mockResolvedValue(firstOpen())
    sessions.expire.mockResolvedValue(firstOpen({ status: "expired" }))
    const res = await checkout({ priceId: "pri_pack", returnPath: "/account/plans", replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(200)
    expect(sessions.expire).toHaveBeenCalledTimes(1)
    expect(sessions.expire).toHaveBeenCalledWith("cs_first")
    expect(sessions.expire.mock.invocationCallOrder[0]).toBeLessThan(sessions.create.mock.invocationCallOrder[0]!)
    // The new session is today's hosted session, and its answer today's.
    expect(Object.keys(createParams())).toEqual(HOSTED_PACK_KEYS)
    expect(res.body).toBe(JSON.stringify({ data: { url: "https://checkout.stripe.test/cs_test_1" } }))
  })

  it("an open first session waiting on a 3-D Secure challenge is expired, not waited on", async () => {
    sessions.retrieve.mockResolvedValue(firstLoad({ payment_intent: { id: "pi_1", status: "requires_action" } }))
    sessions.expire.mockResolvedValue(firstOpen({ status: "expired" }))
    const res = await load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(200)
    expect(sessions.expire).toHaveBeenCalledWith("cs_first")
    expect(Object.keys(createParams())).toEqual(HOSTED_LOAD_KEYS)
  })

  it("an open first plan session whose subscription is incomplete is expired, then the plan session created", async () => {
    sessions.retrieve.mockResolvedValue(firstPlan({ subscription: { id: "sub_1", status: "incomplete" } }))
    sessions.expire.mockResolvedValue(firstOpen({ status: "expired" }))
    const res = await checkout({ priceId: "pri_basic", replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(200)
    expect(sessions.expire).toHaveBeenCalledWith("cs_first")
    expect(createParams().mode).toBe("subscription")
  })

  it("an expired first session: created without an expire", async () => {
    sessions.retrieve.mockResolvedValueOnce(firstOpen({ status: "expired" })).mockResolvedValueOnce(firstLoad({ status: "expired" }))
    for (const res of [
      await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" }),
      await load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" }),
    ]) {
      expect(res.statusCode).toBe(200)
    }
    expect(sessions.expire).not.toHaveBeenCalled()
    expect(sessions.create).toHaveBeenCalledTimes(2)
  })

  it("a complete first session: 409 checkout_already_complete, nothing expired or created", async () => {
    sessions.retrieve.mockResolvedValue(firstOpen({ status: "complete", payment_status: "paid" }))
    const res = await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual(COMPLETE)
    nothingStarted()
  })

  it("a complete first session still settling: 409 checkout_already_complete on a load too", async () => {
    sessions.retrieve.mockResolvedValue(firstLoad({ status: "complete", payment_status: "unpaid" }))
    const res = await load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual(COMPLETE)
    nothingStarted()
  })

  it("a submitted payment: 409 checkout_in_progress, nothing expired or created", async () => {
    sessions.retrieve.mockResolvedValue(firstLoad({ payment_intent: { id: "pi_1", status: "processing" } }))
    const res = await load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual(IN_PROGRESS)
    nothingStarted()
  })

  it("a succeeded payment on a session still open: 409 checkout_in_progress", async () => {
    sessions.retrieve.mockResolvedValue(firstOpen({ payment_intent: { id: "pi_1", status: "succeeded" } }))
    const res = await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("checkout_in_progress")
    nothingStarted()
  })

  it("a plan session whose subscription is already active: 409 checkout_in_progress", async () => {
    sessions.retrieve.mockResolvedValue(firstPlan({ subscription: { id: "sub_1", status: "active" } }))
    const res = await checkout({ priceId: "pri_basic", replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("checkout_in_progress")
    nothingStarted()
  })

  it("completes before the expire: Stripe refuses, the re-read says complete, 409 and nothing created", async () => {
    sessions.retrieve.mockResolvedValueOnce(firstOpen()).mockResolvedValueOnce(firstOpen({ status: "complete" }))
    sessions.expire.mockRejectedValue(refused())
    const res = await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual(COMPLETE)
    expect(sessions.create).not.toHaveBeenCalled()
  })

  it("a refused expire whose re-read still says open: 409 checkout_in_progress, nothing created", async () => {
    sessions.retrieve.mockResolvedValue(firstLoad())
    sessions.expire.mockRejectedValue(refused())
    const res = await load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual(IN_PROGRESS)
    expect(sessions.create).not.toHaveBeenCalled()
  })

  it("a refused expire whose re-read says expired: the new session is created", async () => {
    sessions.retrieve.mockResolvedValueOnce(firstOpen()).mockResolvedValueOnce(firstOpen({ status: "expired" }))
    sessions.expire.mockRejectedValue(refused())
    const res = await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(200)
    expect(sessions.create).toHaveBeenCalledTimes(1)
  })

  it("another customer's session: 404 with the status read's body, nothing expired or created", async () => {
    // Each of the request's own purchase, so only the owner differs.
    sessions.retrieve.mockResolvedValueOnce(firstOpen({ customer: "cus_other" })).mockResolvedValueOnce(firstLoad({ customer: "cus_other" }))
    for (const res of [
      await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" }),
      await load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" }),
    ]) {
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual(NOT_FOUND)
      expect(res.body).toBe(JSON.stringify(NOT_FOUND))
    }
    nothingStarted()
  })

  it("the create routes' 404 and the status read's 404 are the same body", async () => {
    // The status read, the pack checkout, then the load: each of its own purchase, so only the owner differs.
    sessions.retrieve
      .mockResolvedValueOnce(firstOpen({ customer: "cus_other" }))
      .mockResolvedValueOnce(firstOpen({ customer: "cus_other" }))
      .mockResolvedValueOnce(firstLoad({ customer: "cus_other" }))
    const signedIn = await buildApp((req) => {
      req.userId = "u1"
    })
    const statusRead = await signedIn.inject({ method: "GET", url: "/v1/billing/checkout-session/cs_first" })
    await signedIn.close()
    const created = await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })
    const loaded = await load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" })
    for (const res of [statusRead, created, loaded]) {
      expect(res.statusCode).toBe(404)
      expect(res.body).toBe(JSON.stringify(CHECKOUT_SESSION_NOT_FOUND))
    }
  })

  it("a missing session, a setup session and a malformed id: the same 404", async () => {
    sessions.retrieve.mockRejectedValueOnce(
      Object.assign(new Stripe.errors.StripeInvalidRequestError({ message: "No such checkout.session" } as never), { statusCode: 404 }),
    )
    const gone = await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })
    sessions.retrieve.mockResolvedValueOnce(firstOpen({ mode: "setup" }))
    const setup = await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })
    const malformed = await checkout({ priceId: "pri_pack", replacesSessionId: "not a session", userId: "u1" })
    for (const res of [gone, setup, malformed]) {
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual(NOT_FOUND)
    }
    expect(sessions.retrieve).toHaveBeenCalledTimes(2)
    nothingStarted()
  })

  it("an account that never reached Stripe: 404, nothing created", async () => {
    mockTables({ ...DEFAULT_TABLES, stripe_customers: { single: null } })
    const res = await load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual(NOT_FOUND)
    expect(sessions.retrieve).not.toHaveBeenCalled()
    nothingStarted()
    expect(mockStripe.customers.create).not.toHaveBeenCalled()
  })

  it("a first plan session that completed and was already recorded: checkout_already_complete, not the subscriber 409", async () => {
    mockTables({ ...DEFAULT_TABLES, subscriptions: { list: [{ id: "s1", status: "active" }] } })
    sessions.retrieve.mockResolvedValue(firstPlan({ status: "complete", payment_intent: null, subscription: "sub_1" }))
    const res = await checkout({ priceId: "pri_basic", replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual(COMPLETE)
    nothingStarted()
  })

  it("a subscriber replacing an open session: the subscriber 409, and the first session is NOT expired", async () => {
    mockTables({ ...DEFAULT_TABLES, subscriptions: { list: [{ id: "s1", status: "active" }] } })
    sessions.retrieve.mockResolvedValue(firstPlan())
    const res = await checkout({ priceId: "pri_basic", replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({
      error: "You already have a subscription. Change your plan from the billing page instead of starting a new one.",
    })
    nothingStarted()
  })

  it("a retry after a failed create goes on (the first now reads expired)", async () => {
    sessions.retrieve.mockResolvedValueOnce(firstOpen()).mockResolvedValueOnce(firstOpen({ status: "expired" }))
    sessions.expire.mockResolvedValue(firstOpen({ status: "expired" }))
    sessions.create.mockRejectedValueOnce(new Error("Stripe is down"))
    const failed = await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })
    expect(failed.statusCode).toBe(500)
    expect(failed.json()).toEqual({ error: "Failed to create checkout session" })
    const retried = await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })
    expect(retried.statusCode).toBe(200)
    expect(retried.body).toBe(JSON.stringify({ data: { url: "https://checkout.stripe.test/cs_test_1" } }))
    expect(sessions.expire).toHaveBeenCalledTimes(1)
    expect(sessions.create).toHaveBeenCalledTimes(2)
  })

  it("Stripe failing on the read: the route's 500, nothing created", async () => {
    sessions.retrieve.mockRejectedValue(new Error("connection reset"))
    const pack = await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })
    expect(pack.statusCode).toBe(500)
    expect(pack.json()).toEqual({ error: "Failed to create checkout session" })
    const loaded = await load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" })
    expect(loaded.statusCode).toBe(500)
    expect(loaded.json()).toEqual({ error: "Failed to create load session" })
    nothingStarted()
  })

  it("Stripe failing on the expire: the route's 500, nothing created", async () => {
    sessions.retrieve.mockResolvedValueOnce(firstOpen()).mockResolvedValueOnce(firstLoad())
    sessions.expire.mockRejectedValue(new Stripe.errors.StripeAPIError({ message: "server error" } as never))
    const pack = await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })
    expect(pack.statusCode).toBe(500)
    expect(pack.json()).toEqual({ error: "Failed to create checkout session" })
    const loaded = await load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" })
    expect(loaded.statusCode).toBe(500)
    expect(loaded.json()).toEqual({ error: "Failed to create load session" })
    expect(sessions.retrieve).toHaveBeenCalledTimes(2)
    expect(sessions.create).not.toHaveBeenCalled()
  })

  it("an embedded replacement answers the embedded body", async () => {
    sessions.retrieve.mockResolvedValue(firstOpen())
    sessions.expire.mockResolvedValue(firstOpen({ status: "expired" }))
    const res = await checkout({ priceId: "pri_pack", uiMode: "embedded", replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { url: null, clientSecret: "sec_1", sessionId: "cs_test_1" } })
  })
})

// ---------------------------------------------------------------------------
// The same purchase
// ---------------------------------------------------------------------------

describe("the named session must be of the same purchase", () => {
  /** A session of another purchase, in each state it can be in. */
  const STATES: Array<Record<string, unknown>> = [
    {},
    { status: "expired" },
    { status: "complete", payment_status: "paid" },
    { payment_intent: { id: "pi_1", status: "processing" }, subscription: { id: "sub_1", status: "active" } },
  ]

  async function notFound(first: Record<string, unknown>, ask: () => ReturnType<typeof checkout>) {
    for (const state of STATES) {
      sessions.retrieve.mockReset()
      sessions.retrieve.mockResolvedValue({ ...first, ...state })
      const res = await ask()
      expect(res.statusCode, JSON.stringify(state)).toBe(404)
      expect(res.body).toBe(JSON.stringify(CHECKOUT_SESSION_NOT_FOUND))
      // The session already read decides: no second Stripe call.
      expect(sessions.retrieve).toHaveBeenCalledTimes(1)
    }
    nothingStarted()
  }

  it("a plan request naming a pack session, and a pack request naming a plan session: 404", async () => {
    await notFound(firstOpen(), () => checkout({ priceId: "pri_basic", replacesSessionId: "cs_first", userId: "u1" }))
    await notFound(firstPlan(), () => checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" }))
  })

  it("a pack request naming a session of another pack price, or of no pack price: 404", async () => {
    await notFound(firstOpen({ metadata: { userId: "u1", topupPriceId: "pri_other" } }), () =>
      checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" }),
    )
    await notFound(firstOpen({ metadata: { userId: "u1" } }), () => checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" }))
    await notFound(firstOpen({ metadata: null }), () => checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" }))
  })

  it("a load request naming a load session of another amount: 404", async () => {
    await notFound(firstLoad(), () => load({ amountUsd: 25, replacesSessionId: "cs_first", userId: "u1" }))
    await notFound(firstLoad({ metadata: { userId: "u1", kind: "load", loadUsd: "200" } }), () =>
      load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" }),
    )
  })

  it("a load request naming a checkout session, and a checkout request naming a load session: 404", async () => {
    await notFound(firstOpen(), () => load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" }))
    await notFound(firstPlan(), () => load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" }))
    await notFound(firstLoad(), () => checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" }))
    await notFound(firstLoad(), () => checkout({ priceId: "pri_basic", replacesSessionId: "cs_first", userId: "u1" }))
  })

  it("a subscriber's plan request naming a pack session: the 404, before the subscriber 409", async () => {
    mockTables({ ...DEFAULT_TABLES, subscriptions: { list: [{ id: "s1", status: "active" }] } })
    sessions.retrieve.mockResolvedValue(firstOpen())
    const res = await checkout({ priceId: "pri_basic", replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual(NOT_FOUND)
    nothingStarted()
  })

  it("a match is replaced as before: the same pack, the same load amount, a plan", async () => {
    sessions.expire.mockResolvedValue(firstOpen({ status: "expired" }))
    sessions.retrieve.mockResolvedValueOnce(firstOpen())
    const pack = await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })
    sessions.retrieve.mockResolvedValueOnce(firstLoad())
    const loaded = await load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" })
    sessions.retrieve.mockResolvedValueOnce(firstPlan())
    const plan = await checkout({ priceId: "pri_basic", replacesSessionId: "cs_first", userId: "u1" })
    for (const res of [pack, loaded, plan]) expect(res.statusCode).toBe(200)
    expect(sessions.retrieve).toHaveBeenCalledTimes(3)
    expect(sessions.expire).toHaveBeenCalledTimes(3)
    expect(sessions.create).toHaveBeenCalledTimes(3)
  })

  it("a plan session is matched by its mode: the route stores no plan price on it", async () => {
    // What the route stores on a plan session, read back from its own create call.
    await checkout({ priceId: "pri_basic", userId: "u1" })
    const stored = createParams().metadata as Record<string, unknown>
    expect(Object.keys(stored)).toEqual(["userId"])
    sessions.retrieve.mockResolvedValue(firstPlan({ metadata: stored }))
    sessions.expire.mockResolvedValue(firstPlan({ status: "expired" }))
    const res = await checkout({ priceId: "pri_basic", replacesSessionId: "cs_first", userId: "u1" })
    expect(res.statusCode).toBe(200)
    expect(sessions.expire).toHaveBeenCalledWith("cs_first")
  })

  it("the metadata the routes store is what the comparison reads", async () => {
    await checkout({ priceId: "pri_pack", userId: "u1" })
    const packStored = sessions.create.mock.calls[0][0].metadata as Record<string, unknown>
    await load({ amountUsd: 20, userId: "u1" })
    const loadStored = sessions.create.mock.calls[1][0].metadata as Record<string, unknown>
    sessions.create.mockClear()
    sessions.expire.mockResolvedValue(firstOpen({ status: "expired" }))

    sessions.retrieve.mockResolvedValueOnce(firstOpen({ metadata: packStored }))
    expect((await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })).statusCode).toBe(200)
    sessions.retrieve.mockResolvedValueOnce(firstOpen({ metadata: loadStored }))
    expect((await load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" })).statusCode).toBe(200)
    // Crossed, each is another purchase.
    sessions.retrieve.mockResolvedValueOnce(firstOpen({ metadata: loadStored }))
    expect((await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })).statusCode).toBe(404)
    sessions.retrieve.mockResolvedValueOnce(firstOpen({ metadata: packStored }))
    expect((await load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" })).statusCode).toBe(404)
    expect(sessions.create).toHaveBeenCalledTimes(2)
    expect(sessions.expire).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Refusals that come first
// ---------------------------------------------------------------------------

describe("what is checked before the named session is read", () => {
  it("a non-string replacesSessionId is a 400 naming the field, before Stripe", async () => {
    for (const bad of [42, "", "x".repeat(256), { id: "cs_first" }]) {
      for (const res of [
        await checkout({ priceId: "pri_pack", replacesSessionId: bad, userId: "u1" }),
        await load({ amountUsd: 20, replacesSessionId: bad, userId: "u1" }),
      ]) {
        expect(res.statusCode).toBe(400)
        expect(res.json()).toEqual({ error: "replacesSessionId must be a Checkout session id" })
      }
    }
    // uiMode and returnPath are worded first.
    expect((await checkout({ priceId: "pri_pack", uiMode: "page", replacesSessionId: 42 })).json().error).toBe('uiMode must be "hosted" or "embedded"')
    expect((await checkout({ priceId: "pri_pack", returnPath: "//evil.test", replacesSessionId: 42 })).json().error).toBe(
      "returnPath must be a path on this origin: one leading /, no host, no #",
    )
    expect(sessions.retrieve).not.toHaveBeenCalled()
    expect(sessions.create).not.toHaveBeenCalled()
  })

  it("refusals still come first: an OAuth token, selfServe:false and a 503 embedded ask never read the named session", async () => {
    const oauth = await buildApp((req) => {
      req.userId = "u1"
      req.appAuthorization = { appId: "evil", authorizationId: "z", scopes: ["workflows:execute"] }
    })
    expect((await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first" }, oauth)).statusCode).toBe(403)
    expect((await load({ amountUsd: 20, replacesSessionId: "cs_first" }, oauth)).statusCode).toBe(403)
    await oauth.close()

    surface.selfServe = false
    expect((await checkout({ priceId: "pri_pack", replacesSessionId: "cs_first", userId: "u1" })).statusCode).toBe(403)
    expect((await load({ amountUsd: 20, replacesSessionId: "cs_first", userId: "u1" })).statusCode).toBe(403)
    surface.selfServe = true

    config.STRIPE_PUBLISHABLE_KEY = ""
    config.VITE_STRIPE_PUBLISHABLE_KEY = ""
    expect((await checkout({ priceId: "pri_pack", uiMode: "embedded", replacesSessionId: "cs_first", userId: "u1" })).statusCode).toBe(503)
    expect((await load({ amountUsd: 20, uiMode: "embedded", replacesSessionId: "cs_first", userId: "u1" })).statusCode).toBe(503)

    expect((await checkout({ priceId: "pri_nope", replacesSessionId: "cs_first", userId: "u1" })).statusCode).toBe(400)

    expect(sessions.retrieve).not.toHaveBeenCalled()
    nothingStarted()
  })
})
