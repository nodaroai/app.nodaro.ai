import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * B4 — `billing.selfServe` had NO backend reader (spec D14, §8.3).
 *
 * The flag removes the pricing page, the buy-packs UI and the billing nav from
 * the browser, and everybody assumed that was the control. It is not:
 * `POST /v1/billing/create-checkout-session` and `create-load-session` never
 * consulted it, so any signed-in user of a `selfServe:false` deployment could
 * open Stripe Checkout by calling the route directly and buy Nodaro credits
 * into their own frozen personal balance — money that, on a payer deployment,
 * nothing will ever spend.
 *
 * The gate is `selfServe || req.userId === deploymentPayerId()`: the payer
 * BUYS through its own route (`/v1/deployment-billing/checkout`), but the stock
 * ones stay open to it so a future page or a support flow is not silently
 * broken by the same class of surprise.
 *
 * MAINLINE (R2): `selfServe` defaults TRUE in the code default, so the
 * condition short-circuits before it looks at the payer at all and both routes
 * take exactly today's path. The first two tests here pass against the
 * unmodified file, and are the ones that must never change.
 */

const PAYER = "00000000-0000-4000-8000-000000000009"
const USER = "00000000-0000-4000-8000-000000000101"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

const mockFrom = vi.fn()
vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: (...a: unknown[]) => mockFrom(...a) },
}))

const sessionsCreate = vi.fn()
const customersCreate = vi.fn()
vi.mock("@/ee/billing/stripe-client.js", () => ({
  getStripe: () => ({
    checkout: { sessions: { create: sessionsCreate } },
    customers: { create: customersCreate },
    billingPortal: { sessions: { create: vi.fn() } },
    subscriptions: { retrieve: vi.fn(), update: vi.fn() },
  }),
}))

vi.mock("@/ee/billing/stripe-config.js", () => ({
  PRICE_TO_PLAN: { pri_pro: { plan: "pro", interval: "monthly" } } as Record<string, unknown>,
  TOP_UPS: { pri_topup: 3300 } as Record<string, number>,
  getTierFromPriceId: () => "pro",
  TIER_CREDITS: { free: 1500, basic: 4500, standard: 11000, pro: 23000 } as Record<string, number>,
  TIER_STORAGE_LIMITS: { free: 1, basic: 2, standard: 3, pro: 4 } as Record<string, number>,
}))

vi.mock("@/ee/billing/provision-credits.js", () => ({ ensureStripeCustomer: vi.fn() }))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", STRIPE_SECRET_KEY: "sk_test" },
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasCredits: () => true,
  hasAdmin: () => true,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { billingRoutes } from "../billing.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } from "../../../lib/deployment-payer.js"

const REAL_ENV = process.env.NODARO_SURFACE_PROFILE

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {}
  const self = () => c
  for (const op of ["select", "eq", "is", "in", "order", "limit", "range", "or", "neq", "gte"]) c[op] = vi.fn(self)
  c.single = vi.fn(async () => result)
  c.maybeSingle = vi.fn(async () => result)
  c.then = vi.fn((resolve: (v: unknown) => void) => resolve(result))
  return c
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  __resetDeploymentPayerForTests()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  mockFrom.mockReturnValue(chain({ data: { stripe_customer_id: "cus_1", email: "x@y.z" }, error: null }))
  sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.test/s/1" })

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
    req.authKind = "jwt"
  })
  await app.register(async (i) => {
    await billingRoutes(i)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  __resetDeploymentPayerForTests()
  if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
  __resetSurfaceProfileCacheForTests()
})

/** `selfServe:false` and a payer — the hosted deployment shape. */
function withheldDeployment(): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
    billing: { selfServe: false, payerAccount: PAYER, unitLabel: "קרדיטים", unitRate: 2000 },
  })
  __resetSurfaceProfileCacheForTests()
  __setDeploymentPayerForTests(PAYER)
}

// ---------------------------------------------------------------------------
// Mainline — these must pass against the UNMODIFIED billing.ts
// ---------------------------------------------------------------------------

describe("mainline (no surface profile, selfServe defaults true)", () => {
  it("create-checkout-session still reaches Stripe for an ordinary user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/create-checkout-session",
      headers: { "x-user-id": USER, origin: "https://app.example" },
      payload: { priceId: "pri_topup", mode: "payment" },
    })

    expect(res.statusCode).toBe(200)
    expect(sessionsCreate).toHaveBeenCalledTimes(1)
  })

  it("create-load-session still reaches Stripe for an ordinary user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/create-load-session",
      headers: { "x-user-id": USER, origin: "https://app.example" },
      payload: { amountUsd: 10 },
    })

    expect(res.statusCode).toBe(200)
    expect(sessionsCreate).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe("selfServe:false — the users may not buy", () => {
  it("refuses create-load-session for a signed-in NON-payer, before Stripe is touched", async () => {
    withheldDeployment()

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/create-load-session",
      headers: { "x-user-id": USER, origin: "https://acme.example" },
      payload: { amountUsd: 10 },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("self_serve_disabled")
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("refuses create-checkout-session for a signed-in NON-payer", async () => {
    withheldDeployment()

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/create-checkout-session",
      headers: { "x-user-id": USER, origin: "https://acme.example" },
      payload: { priceId: "pri_topup", mode: "payment" },
    })

    expect(res.statusCode).toBe(403)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("still lets the BILLING ACCOUNT through both stock routes", async () => {
    withheldDeployment()

    const load = await app.inject({
      method: "POST",
      url: "/v1/billing/create-load-session",
      headers: { "x-user-id": PAYER, origin: "https://acme.example" },
      payload: { amountUsd: 10 },
    })
    expect(load.statusCode).toBe(200)

    const checkout = await app.inject({
      method: "POST",
      url: "/v1/billing/create-checkout-session",
      headers: { "x-user-id": PAYER, origin: "https://acme.example" },
      payload: { priceId: "pri_topup", mode: "payment" },
    })
    expect(checkout.statusCode).toBe(200)
  })

  it("refuses on a selfServe:false deployment with NO payer at all — the flag alone is the control", async () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ billing: { selfServe: false } })
    __resetSurfaceProfileCacheForTests()

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/create-load-session",
      headers: { "x-user-id": USER, origin: "https://x.example" },
      payload: { amountUsd: 10 },
    })

    expect(res.statusCode).toBe(403)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })
})
