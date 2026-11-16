import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import Stripe from "stripe"

/**
 * `GET /v1/billing/checkout-session/:sessionId`: whether the caller's own
 * Checkout session's purchase has been granted. Another customer's session
 * answers exactly what a session that does not exist answers.
 */

// ---------------------------------------------------------------------------
// Mocks -- hoisted before any route import
// ---------------------------------------------------------------------------

/** One chain per table read: what `maybeSingle()` / `single()` answer, and every `eq` it saw. */
const tables = vi.hoisted(() => {
  type DbError = { message: string; code?: string }
  /** `errors` answers the reads in turn before `error` does (one entry per read). */
  interface TableState { row: unknown; error: DbError | null; errors: (DbError | null)[]; eqs: [string, unknown][]; selects: string[] }
  const fresh = (): TableState => ({ row: null, error: null, errors: [], eqs: [], selects: [] })
  return { transactions: fresh(), subscriptions: fresh(), fresh }
})
const transactions = tables.transactions
const subscriptions = tables.subscriptions

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      const state = table === "transactions" ? tables.transactions : table === "subscriptions" ? tables.subscriptions : tables.fresh()
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn((columns: string) => {
        state.selects.push(columns)
        return chain
      })
      chain.eq = vi.fn((column: string, value: unknown) => {
        state.eqs.push([column, value])
        return chain
      })
      const answer = () => {
        const error = state.errors.length > 0 ? state.errors.shift() ?? null : state.error
        return Promise.resolve(error ? { data: null, error } : { data: state.row, error: null })
      }
      chain.maybeSingle = vi.fn(answer)
      chain.single = vi.fn(answer)
      return chain
    }),
  },
}))

const retrieve = vi.hoisted(() => vi.fn())
vi.mock("@/ee/billing/stripe-client.js", () => ({ getStripe: () => ({ checkout: { sessions: { retrieve } } }) }))

const stripeCustomerIdOf = vi.hoisted(() => vi.fn())
vi.mock("@/ee/billing/stripe-customer.js", () => ({ stripeCustomerIdOf }))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  billingCheckoutStatusRoutes,
  CHECKOUT_STATUS_PER_MINUTE,
  CHECKOUT_STATUS_RATE_LIMIT,
} from "../billing-checkout-status.js"
import { CHECKOUT_SESSION_ID } from "../../billing/checkout-status.js"

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const pack = (o: Record<string, unknown> = {}) => ({
  id: "cs_test_1",
  customer: "cus_me",
  mode: "payment",
  status: "complete",
  payment_status: "paid",
  payment_intent: "pi_1",
  subscription: null,
  ...o,
})
const plan = (o: Record<string, unknown> = {}) => ({ ...pack(), mode: "subscription", payment_intent: null, subscription: "sub_1", ...o })

const missing = () =>
  Object.assign(
    new Stripe.errors.StripeInvalidRequestError({ message: "No such checkout.session", code: "resource_missing" } as never),
    { statusCode: 404 },
  )

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  Object.assign(transactions, tables.fresh())
  Object.assign(subscriptions, tables.fresh())
  stripeCustomerIdOf.mockResolvedValue("cus_me")
  retrieve.mockResolvedValue(pack())
  app = Fastify({ logger: false })
  // The auth hook's outcome, from test headers: a user, and an OAuth app token.
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user"]
    if (typeof user === "string") req.userId = user
    if (req.headers["x-app"]) (req as unknown as { appAuthorization: unknown }).appAuthorization = { appId: "app_1" }
  })
  await app.register(async (instance) => { await billingCheckoutStatusRoutes(instance) })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function read(sessionId: string, userId?: string, headers: Record<string, string> = {}) {
  return app.inject({
    method: "GET",
    url: `/v1/billing/checkout-session/${sessionId}`,
    headers: { ...(userId ? { "x-user": userId } : {}), ...headers },
  })
}

// ---------------------------------------------------------------------------
// Who may read
// ---------------------------------------------------------------------------

describe("who may read", () => {
  it("401 signed out; 403 for an OAuth app token", async () => {
    const out = await read("cs_test_1")
    expect(out.statusCode).toBe(401)
    expect(out.json()).toEqual({ error: "Authentication required" })

    const oauth = await read("cs_test_1", "u1", { "x-app": "1" })
    expect(oauth.statusCode).toBe(403)
    expect(oauth.json().error.code).toBe("forbidden")
    expect(retrieve).not.toHaveBeenCalled()
  })

  it("a malformed id is a 404 without reading anything", async () => {
    const res = await read("not-a-session", "u1")
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("checkout_session_not_found")
    expect(stripeCustomerIdOf).not.toHaveBeenCalled()
    expect(retrieve).not.toHaveBeenCalled()
  })

  it("the id shape: the cs_ prefix and a length bound only", () => {
    expect(CHECKOUT_SESSION_ID.test("cs_test_a1B2c3")).toBe(true)
    expect(CHECKOUT_SESSION_ID.test("cs_live_" + "a".repeat(200))).toBe(true)
    expect(CHECKOUT_SESSION_ID.test("cs_")).toBe(false)
    expect(CHECKOUT_SESSION_ID.test("cs_" + "a".repeat(251))).toBe(false)
    expect(CHECKOUT_SESSION_ID.test("pi_123")).toBe(false)
    expect(CHECKOUT_SESSION_ID.test("cs_a/b")).toBe(false)
  })

  it("a person Stripe does not know: 404, Stripe not called", async () => {
    stripeCustomerIdOf.mockResolvedValue(null)
    const res = await read("cs_test_1", "u1")
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("checkout_session_not_found")
    expect(stripeCustomerIdOf).toHaveBeenCalledWith("u1")
    expect(retrieve).not.toHaveBeenCalled()
  })

  it("another customer's session: 404 checkout_session_not_found, the same body as a missing one", async () => {
    retrieve.mockResolvedValue(pack({ customer: "cus_other" }))
    const a = await read("cs_test_1", "u1")
    retrieve.mockRejectedValue(missing())
    const b = await read("cs_test_1", "u1")
    expect([a.statusCode, b.statusCode]).toEqual([404, 404])
    expect(a.json()).toEqual(b.json())
    expect(a.json()).toEqual({
      error: { code: "checkout_session_not_found", message: "No checkout session with this id on your account." },
    })
    expect(a.headers["cache-control"]).toBe(b.headers["cache-control"])
  })

  it("a session with no customer is not the caller's: 404", async () => {
    retrieve.mockResolvedValue(pack({ customer: null }))
    expect((await read("cs_test_1", "u1")).statusCode).toBe(404)
  })

  it("an expanded customer object is compared by its id", async () => {
    transactions.row = { id: "t1" }
    retrieve.mockResolvedValue(pack({ customer: { id: "cus_me", object: "customer" } }))
    const mine = await read("cs_test_1", "u1")
    expect(mine.statusCode).toBe(200)
    expect(mine.json().data.granted).toBe(true)

    retrieve.mockResolvedValue(pack({ customer: { id: "cus_other", object: "customer" } }))
    expect((await read("cs_test_1", "u1")).statusCode).toBe(404)
  })

  it("Stripe failing (not a 404): 500, never 404", async () => {
    retrieve.mockRejectedValue(new Error("connection reset"))
    const res = await read("cs_test_1", "u1")
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: "Failed to read the checkout session" })
  })

  it("Stripe's invalid-request error that is not a 404: 500", async () => {
    retrieve.mockRejectedValue(
      Object.assign(new Stripe.errors.StripeInvalidRequestError({ message: "Bad request" } as never), { statusCode: 400 }),
    )
    expect((await read("cs_test_1", "u1")).statusCode).toBe(500)
  })

  it("the customer lookup failing: 500", async () => {
    stripeCustomerIdOf.mockRejectedValue(new Error("stripe_customers lookup failed: boom"))
    expect((await read("cs_test_1", "u1")).statusCode).toBe(500)
  })

  it("a setup-mode session is not one of ours: 404", async () => {
    retrieve.mockResolvedValue(pack({ mode: "setup", payment_intent: null }))
    const res = await read("cs_test_1", "u1")
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("checkout_session_not_found")
  })
})

// ---------------------------------------------------------------------------
// A credit pack (or a load)
// ---------------------------------------------------------------------------

describe("a pack", () => {
  it("a paid pack whose grant is recorded: granted, keyed on its payment intent and the caller", async () => {
    retrieve.mockResolvedValue(pack())
    transactions.row = { id: "t1" }
    const res = await read("cs_test_1", "u1")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toStrictEqual({ data: { status: "complete", paymentStatus: "paid", mode: "payment", granted: true } })
    expect(transactions.eqs).toEqual(
      expect.arrayContaining([["stripe_transaction_id", "pi_1"], ["user_id", "u1"], ["type", "topup"]]),
    )
    expect(res.headers["cache-control"]).toBe("no-store")
    expect(retrieve).toHaveBeenCalledWith("cs_test_1")
  })

  it("a paid pack before its webhook: complete, paid, not granted", async () => {
    transactions.row = null
    const res = await read("cs_test_1", "u1")
    expect(res.json()).toStrictEqual({ data: { status: "complete", paymentStatus: "paid", mode: "payment", granted: false } })
  })

  it("a pack still settling (async method): complete, unpaid, not granted", async () => {
    retrieve.mockResolvedValue(pack({ payment_status: "unpaid" }))
    const res = await read("cs_test_1", "u1")
    expect(res.json()).toStrictEqual({ data: { status: "complete", paymentStatus: "unpaid", mode: "payment", granted: false } })
  })

  it("a session with no payment intent is keyed on its own id; an expanded intent on its id", async () => {
    retrieve.mockResolvedValue(pack({ payment_intent: null }))
    await read("cs_test_1", "u1")
    expect(transactions.eqs).toEqual(expect.arrayContaining([["stripe_transaction_id", "cs_test_1"]]))

    transactions.eqs = []
    retrieve.mockResolvedValue(pack({ payment_intent: { id: "pi_expanded", object: "payment_intent" } }))
    await read("cs_test_1", "u1")
    expect(transactions.eqs).toEqual(expect.arrayContaining([["stripe_transaction_id", "pi_expanded"]]))
  })

  it("a database error reading the grant is a 500, never granted: false", async () => {
    transactions.error = { message: "connection lost" }
    const res = await read("cs_test_1", "u1")
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: "Failed to read the checkout session" })
  })
})

// ---------------------------------------------------------------------------
// A plan
// ---------------------------------------------------------------------------

describe("a plan", () => {
  it("a subscription with no row yet: not granted", async () => {
    retrieve.mockResolvedValue(plan())
    subscriptions.row = null
    const res = await read("cs_test_1", "u1")
    expect(res.json()).toStrictEqual({ data: { status: "complete", paymentStatus: "paid", mode: "subscription", granted: false } })
    expect(subscriptions.eqs).toEqual([["stripe_subscription_id", "sub_1"]])
  })

  it("a session with no subscription: not granted, nothing read", async () => {
    retrieve.mockResolvedValue(plan({ subscription: null }))
    const res = await read("cs_test_1", "u1")
    expect(res.json().data.granted).toBe(false)
    expect(subscriptions.eqs).toEqual([])
  })

  it("a subscription recorded unpaid (plan_granted false): not granted", async () => {
    retrieve.mockResolvedValue(plan())
    subscriptions.row = { id: "s1", user_id: "u1", plan_granted: false }
    expect((await read("cs_test_1", "u1")).json().data.granted).toBe(false)
  })

  it("a subscription granted: granted; a row of another user: not granted", async () => {
    retrieve.mockResolvedValue(plan())
    subscriptions.row = { id: "s1", user_id: "u1", plan_granted: true }
    expect((await read("cs_test_1", "u1")).json()).toStrictEqual({
      data: { status: "complete", paymentStatus: "paid", mode: "subscription", granted: true },
    })

    subscriptions.row = { id: "s1", user_id: "u2", plan_granted: true }
    expect((await read("cs_test_1", "u1")).json().data.granted).toBe(false)
  })

  it("a database error reading the subscription is a 500, never granted: false", async () => {
    retrieve.mockResolvedValue(plan())
    subscriptions.error = { message: "connection lost", code: "08006" }
    const res = await read("cs_test_1", "u1")
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: "Failed to read the checkout session" })
    expect(res.headers["cache-control"]).toBe("no-store")
  })

  it("a database without the grant marker yet: read again without it, the row still found", async () => {
    retrieve.mockResolvedValue(plan())
    subscriptions.errors = [{ message: 'column "plan_granted" does not exist', code: "42703" }]
    subscriptions.row = { id: "s1", user_id: "u1" }
    const res = await read("cs_test_1", "u1")
    expect(res.statusCode).toBe(200)
    expect(res.json().data.granted).toBe(true)
    expect(subscriptions.selects).toEqual(["id, user_id, plan_granted", "id, user_id"])
  })

  it("the read without the marker failing too: 500", async () => {
    retrieve.mockResolvedValue(plan())
    subscriptions.errors = [{ message: "no column", code: "PGRST204" }, { message: "connection lost" }]
    expect((await read("cs_test_1", "u1")).statusCode).toBe(500)
  })

  it("an expanded subscription is read by its id", async () => {
    retrieve.mockResolvedValue(plan({ subscription: { id: "sub_expanded", object: "subscription" } }))
    subscriptions.row = { id: "s1", user_id: "u1", plan_granted: true }
    expect((await read("cs_test_1", "u1")).json().data.granted).toBe(true)
    expect(subscriptions.eqs).toEqual([["stripe_subscription_id", "sub_expanded"]])
  })
})

// ---------------------------------------------------------------------------
// Status and limits
// ---------------------------------------------------------------------------

describe("status", () => {
  it("an open session reads open; Stripe's null status reads open; an expired one reads expired", async () => {
    retrieve.mockResolvedValue(pack({ status: "open", payment_status: "unpaid" }))
    expect((await read("cs_test_1", "u1")).json().data).toStrictEqual({ status: "open", paymentStatus: "unpaid", mode: "payment", granted: false })

    retrieve.mockResolvedValue(pack({ status: null, payment_status: "unpaid" }))
    expect((await read("cs_test_1", "u1")).json().data.status).toBe("open")

    retrieve.mockResolvedValue(pack({ status: "expired", payment_status: "unpaid" }))
    expect((await read("cs_test_1", "u1")).json().data.status).toBe("expired")
  })

  it("declares its limit: 60 a minute per account, after auth", () => {
    expect(CHECKOUT_STATUS_RATE_LIMIT.rateLimit).toMatchObject({ max: CHECKOUT_STATUS_PER_MINUTE, timeWindow: "1 minute", hook: "preHandler" })
    expect(CHECKOUT_STATUS_PER_MINUTE).toBe(60)
    const key = CHECKOUT_STATUS_RATE_LIMIT.rateLimit.keyGenerator
    expect(key({ userId: "u1" } as never)).toBe("checkout-status:user:u1")
  })
})
