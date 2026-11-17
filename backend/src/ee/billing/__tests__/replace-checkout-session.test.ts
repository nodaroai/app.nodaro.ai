import { describe, it, expect, vi, beforeEach } from "vitest"
import Stripe from "stripe"

/**
 * The Checkout session a new one replaces: read only when it is the caller's
 * own, classified, and expired only when it is open and nobody is paying it.
 */

// ---------------------------------------------------------------------------
// Mocks -- hoisted before any import of the module under test
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

const retrieve = vi.hoisted(() => vi.fn())
const expire = vi.hoisted(() => vi.fn())
vi.mock("@/ee/billing/stripe-client.js", () => ({ getStripe: () => ({ checkout: { sessions: { retrieve, expire } } }) }))

const stripeCustomerIdOf = vi.hoisted(() => vi.fn())
vi.mock("@/ee/billing/stripe-customer.js", () => ({ stripeCustomerIdOf }))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { CHECKOUT_SESSION_NOT_FOUND, retrieveOwnSession } from "../checkout-status.js"
import {
  beginReplacement,
  expireReplacedSession,
  finishReplacement,
  PAYMENT_UNDER_WAY,
  readReplacedSession,
  REPLACEMENT_HANDLED,
  REPLACE_EXPAND,
  replacementRefusal,
  samePurchase,
  startReplacement,
  SUBSCRIPTION_PAID,
  type ReplacingPurchase,
} from "../replace-checkout-session.js"
import { checkoutSessionState } from "../checkout-session-state.js"

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
  metadata: { userId: "u1", topupPriceId: "pri_pack" },
  ...o,
})

/** What the request buys: the fixtures above are a pack's session, `planOpen` a plan's. */
const PACK: ReplacingPurchase = { kind: "pack", priceId: "pri_pack" }
const PLAN: ReplacingPurchase = { kind: "plan" }
const LOAD: ReplacingPurchase = { kind: "load", amountUsd: 20 }

const missing = () =>
  Object.assign(
    new Stripe.errors.StripeInvalidRequestError({ message: "No such checkout.session", code: "resource_missing" } as never),
    { statusCode: 404 },
  )

const pi = (status: string) => ({ id: "pi_1", object: "payment_intent", status })
const sub = (status: string) => ({ id: "sub_1", object: "subscription", status })
const open = (o: Record<string, unknown> = {}) => pack({ status: "open", payment_status: "unpaid", payment_intent: null, ...o })
const planOpen = (o: Record<string, unknown> = {}) => open({ mode: "subscription", subscription: null, metadata: { userId: "u1" }, ...o })
const loadOpen = (o: Record<string, unknown> = {}) => open({ metadata: { userId: "u1", kind: "load", loadUsd: "20" }, ...o })
const refused = () =>
  Object.assign(
    new Stripe.errors.StripeInvalidRequestError({ message: "This Checkout Session is not in an expireable state" } as never),
    { statusCode: 400 },
  )

beforeEach(() => {
  vi.clearAllMocks()
  retrieve.mockReset()
  expire.mockReset()
  stripeCustomerIdOf.mockResolvedValue("cus_me")
})

describe("retrieveOwnSession", () => {
  it("asks Stripe with the expansions when given, and with the id alone when not", async () => {
    retrieve.mockResolvedValue(pack())
    await retrieveOwnSession("u1", "cs_test_1", ["payment_intent", "subscription"])
    expect(retrieve).toHaveBeenLastCalledWith("cs_test_1", { expand: ["payment_intent", "subscription"] })
    await retrieveOwnSession("u1", "cs_test_1")
    expect(retrieve.mock.calls.at(-1)).toEqual(["cs_test_1"])
  })

  it("another customer's, a missing, a setup and a malformed session are all null", async () => {
    retrieve.mockResolvedValue(pack({ customer: "cus_other" }))
    expect(await retrieveOwnSession("u1", "cs_test_1")).toBeNull()
    retrieve.mockRejectedValue(missing())
    expect(await retrieveOwnSession("u1", "cs_test_1")).toBeNull()
    retrieve.mockResolvedValue(pack({ mode: "setup" }))
    expect(await retrieveOwnSession("u1", "cs_test_1")).toBeNull()
    expect(await retrieveOwnSession("u1", "nope")).toBeNull()
  })

  it("an account with no Stripe customer is null, without asking Stripe", async () => {
    stripeCustomerIdOf.mockResolvedValue(null)
    expect(await retrieveOwnSession("u1", "cs_test_1")).toBeNull()
    expect(retrieve).not.toHaveBeenCalled()
  })

  it("the caller's own session is returned as Stripe sent it", async () => {
    const own = pack({ customer: { id: "cus_me" } })
    retrieve.mockResolvedValue(own)
    expect(await retrieveOwnSession("u1", "cs_test_1")).toBe(own)
  })

  it("a Stripe failure that is not a 404 throws", async () => {
    retrieve.mockRejectedValue(new Error("connection reset"))
    await expect(retrieveOwnSession("u1", "cs_test_1")).rejects.toThrow("connection reset")
  })
})

describe("readReplacedSession", () => {
  it("reads the session with the PaymentIntent and the Subscription expanded", async () => {
    retrieve.mockResolvedValue(open())
    await readReplacedSession("u1", "cs_test_1", PACK)
    expect(retrieve).toHaveBeenLastCalledWith("cs_test_1", { expand: ["payment_intent", "subscription"] })
    expect(REPLACE_EXPAND).toEqual(["payment_intent", "subscription"])
  })

  it("complete, paid or still settling, is complete", async () => {
    for (const payment_status of ["paid", "unpaid"]) {
      retrieve.mockResolvedValue(pack({ status: "complete", payment_status }))
      expect(await readReplacedSession("u1", "cs_test_1", PACK)).toEqual({ kind: "complete" })
    }
  })

  it("expired is expired; not the caller's is not-found", async () => {
    retrieve.mockResolvedValue(open({ status: "expired" }))
    expect(await readReplacedSession("u1", "cs_test_1", PACK)).toEqual({ kind: "expired" })
    retrieve.mockResolvedValue(open({ customer: "cus_other" }))
    expect(await readReplacedSession("u1", "cs_test_1", PACK)).toEqual({ kind: "not-found" })
  })

  it("missing, setup and malformed sessions are not-found", async () => {
    retrieve.mockRejectedValue(missing())
    expect(await readReplacedSession("u1", "cs_test_1", PACK)).toEqual({ kind: "not-found" })
    retrieve.mockResolvedValue(open({ mode: "setup" }))
    expect(await readReplacedSession("u1", "cs_test_1", PACK)).toEqual({ kind: "not-found" })
    expect(await readReplacedSession("u1", "nope", PACK)).toEqual({ kind: "not-found" })
  })

  it("under way: a submitted payment, or a paid subscription, on an open session", async () => {
    for (const s of ["processing", "requires_capture", "succeeded"]) {
      retrieve.mockResolvedValue(open({ payment_intent: pi(s) }))
      expect(await readReplacedSession("u1", "cs_test_1", PACK), s).toEqual({ kind: "under-way" })
    }
    for (const s of ["active", "trialing", "past_due", "unpaid"]) {
      retrieve.mockResolvedValue(planOpen({ subscription: sub(s) }))
      expect(await readReplacedSession("u1", "cs_test_1", PLAN), s).toEqual({ kind: "under-way" })
    }
    expect([...PAYMENT_UNDER_WAY].sort()).toEqual(["processing", "requires_capture", "succeeded"])
    expect([...SUBSCRIPTION_PAID].sort()).toEqual(["active", "past_due", "trialing", "unpaid"])
  })

  it("waiting on the person (or nothing submitted) is open, so it will be expired", async () => {
    for (const p of [null, pi("requires_action"), pi("requires_payment_method"), pi("requires_confirmation"), pi("canceled")]) {
      retrieve.mockResolvedValue(open({ payment_intent: p }))
      expect(await readReplacedSession("u1", "cs_test_1", PACK)).toEqual({ kind: "open" })
    }
    for (const s of [null, sub("incomplete"), sub("incomplete_expired"), sub("canceled")]) {
      retrieve.mockResolvedValue(planOpen({ subscription: s }))
      expect(await readReplacedSession("u1", "cs_test_1", PLAN)).toEqual({ kind: "open" })
    }
  })

  it("an id Stripe did not expand reads as not under way", async () => {
    retrieve.mockResolvedValue(open({ payment_intent: "pi_1" }))
    expect(await readReplacedSession("u1", "cs_test_1", PACK)).toEqual({ kind: "open" })
    retrieve.mockResolvedValue(planOpen({ subscription: "sub_1" }))
    expect(await readReplacedSession("u1", "cs_test_1", PLAN)).toEqual({ kind: "open" })
  })

  it("Stripe's null status reads open", async () => {
    retrieve.mockResolvedValue(open({ status: null }))
    expect(await readReplacedSession("u1", "cs_test_1", PACK)).toEqual({ kind: "open" })
    retrieve.mockResolvedValue(open({ status: null, payment_intent: pi("processing") }))
    expect(await readReplacedSession("u1", "cs_test_1", PACK)).toEqual({ kind: "under-way" })
  })

  it("a Stripe failure that is not a 404 throws", async () => {
    retrieve.mockRejectedValue(new Error("connection reset"))
    await expect(readReplacedSession("u1", "cs_test_1", PACK)).rejects.toThrow("connection reset")
  })
})

describe("the same purchase", () => {
  it("a plan request matches a subscription session, whatever its metadata", () => {
    expect(samePurchase(planOpen() as never, PLAN)).toBe(true)
    expect(samePurchase(planOpen({ metadata: null }) as never, PLAN)).toBe(true)
    expect(samePurchase(open() as never, PLAN)).toBe(false)
    expect(samePurchase(loadOpen() as never, PLAN)).toBe(false)
  })

  it("a pack request matches a payment session carrying the same pack price", () => {
    expect(samePurchase(open() as never, PACK)).toBe(true)
    expect(samePurchase(open() as never, { kind: "pack", priceId: "pri_other" })).toBe(false)
    expect(samePurchase(open({ metadata: { userId: "u1" } }) as never, PACK)).toBe(false)
    expect(samePurchase(open({ metadata: null }) as never, PACK)).toBe(false)
    expect(samePurchase(loadOpen() as never, PACK)).toBe(false)
    expect(samePurchase(loadOpen({ metadata: { userId: "u1", kind: "load", loadUsd: "20", topupPriceId: "pri_pack" } }) as never, PACK)).toBe(false)
    expect(samePurchase(planOpen({ metadata: { userId: "u1", topupPriceId: "pri_pack" } }) as never, PACK)).toBe(false)
  })

  it("a load request matches a load session of the same amount", () => {
    expect(samePurchase(loadOpen() as never, LOAD)).toBe(true)
    expect(samePurchase(loadOpen() as never, { kind: "load", amountUsd: 25 })).toBe(false)
    expect(samePurchase(loadOpen({ metadata: { userId: "u1", kind: "load", loadUsd: "20.0" } }) as never, LOAD)).toBe(false)
    expect(samePurchase(loadOpen({ metadata: { userId: "u1", loadUsd: "20" } }) as never, LOAD)).toBe(false)
    expect(samePurchase(open() as never, LOAD)).toBe(false)
    expect(samePurchase(planOpen({ metadata: { userId: "u1", kind: "load", loadUsd: "20" } }) as never, LOAD)).toBe(false)
  })

  it("a session of another purchase is not-found in every state, and nothing is expired", async () => {
    const others: Array<[Record<string, unknown>, ReplacingPurchase]> = [
      [planOpen(), PACK],
      [open(), PLAN],
      [open(), { kind: "pack", priceId: "pri_other" }],
      [loadOpen(), { kind: "load", amountUsd: 25 }],
      [loadOpen(), PACK],
      [open(), LOAD],
      [loadOpen(), PLAN],
      [planOpen(), LOAD],
    ]
    for (const [session, purchase] of others) {
      for (const state of [{}, { status: "expired" }, { status: "complete", payment_status: "paid" }, { payment_intent: pi("processing"), subscription: sub("active") }]) {
        retrieve.mockResolvedValueOnce({ ...session, ...state })
        expect(await readReplacedSession("u1", "cs_test_1", purchase), JSON.stringify([session.metadata, purchase, state])).toEqual({ kind: "not-found" })
        retrieve.mockResolvedValueOnce({ ...session, ...state })
        expect(await startReplacement("u1", "cs_test_1", purchase)).toEqual({ refusal: replacementRefusal("not-found") })
      }
    }
    expect(expire).not.toHaveBeenCalled()
    // One read each: the comparison uses the session already retrieved.
    expect(retrieve).toHaveBeenCalledTimes(others.length * 4 * 2)
  })

  it("a matching load and plan session are classified as before", async () => {
    retrieve.mockResolvedValueOnce(loadOpen())
    expect(await readReplacedSession("u1", "cs_test_1", LOAD)).toEqual({ kind: "open" })
    retrieve.mockResolvedValueOnce(loadOpen({ payment_intent: pi("processing") }))
    expect(await readReplacedSession("u1", "cs_test_1", LOAD)).toEqual({ kind: "under-way" })
    retrieve.mockResolvedValueOnce(planOpen({ status: "complete" }))
    expect(await readReplacedSession("u1", "cs_test_1", PLAN)).toEqual({ kind: "complete" })
  })
})

describe("checkoutSessionState", () => {
  it("is what readReplacedSession answers for a session of the same purchase", async () => {
    const rows: Array<[Record<string, unknown>, string]> = [
      [pack({ status: "complete" }), "complete"],
      [open({ status: "expired" }), "expired"],
      [open({ status: "expired", payment_intent: pi("processing") }), "expired"],
      [open({ payment_intent: pi("processing") }), "under-way"],
      [open({ status: null, payment_intent: pi("succeeded") }), "under-way"],
      [open({ payment_intent: pi("requires_action") }), "open"],
      [open(), "open"],
    ]
    for (const [session, want] of rows) {
      expect(checkoutSessionState(session as never)).toBe(want)
      retrieve.mockResolvedValueOnce(session)
      expect(await readReplacedSession("u1", "cs_test_1", PACK)).toEqual({ kind: want })
    }
  })
})

describe("expireReplacedSession", () => {
  it("an expire Stripe accepts is expired, with no re-read", async () => {
    expire.mockResolvedValue(open({ status: "expired" }))
    expect(await expireReplacedSession("u1", "cs_test_1")).toBe("expired")
    expect(expire).toHaveBeenCalledWith("cs_test_1")
    expect(expire.mock.calls[0]).toEqual(["cs_test_1"])
    expect(retrieve).not.toHaveBeenCalled()
  })

  it("a refused expire is classified by a re-read", async () => {
    const cases: Array<[unknown, string]> = [
      [pack({ status: "complete" }), "complete"],
      [open({ status: "expired" }), "expired"],
      [open(), "under-way"],
      [open({ status: null }), "under-way"],
    ]
    for (const [reread, want] of cases) {
      expire.mockRejectedValueOnce(refused())
      retrieve.mockResolvedValueOnce(reread)
      expect(await expireReplacedSession("u1", "cs_test_1")).toBe(want)
      expect(retrieve).toHaveBeenLastCalledWith("cs_test_1", { expand: ["payment_intent", "subscription"] })
    }
    expire.mockRejectedValueOnce(refused())
    retrieve.mockRejectedValueOnce(missing())
    expect(await expireReplacedSession("u1", "cs_test_1")).toBe("expired")
  })

  it("a refused expire whose re-read fails throws", async () => {
    expire.mockRejectedValueOnce(refused())
    retrieve.mockRejectedValueOnce(new Error("connection reset"))
    await expect(expireReplacedSession("u1", "cs_test_1")).rejects.toThrow("connection reset")
  })

  it("any other expire failure throws, never 'expired'", async () => {
    expire.mockRejectedValue(new Error("connection reset"))
    await expect(expireReplacedSession("u1", "cs_test_1")).rejects.toThrow("connection reset")
    expire.mockRejectedValue(new Stripe.errors.StripeAPIError({ message: "server error" } as never))
    await expect(expireReplacedSession("u1", "cs_test_1")).rejects.toThrow("server error")
    expect(retrieve).not.toHaveBeenCalled()
  })
})

it("the refusal bodies", () => {
  expect(replacementRefusal("complete")).toEqual({
    status: 409,
    body: { error: { code: "checkout_already_complete", message: "This purchase has already been paid. Nothing new was started." } },
  })
  expect(replacementRefusal("under-way")).toEqual({
    status: 409,
    body: {
      error: {
        code: "checkout_in_progress",
        message: "The payment for this purchase is still being confirmed. Nothing new was started.",
      },
    },
  })
  expect(replacementRefusal("not-found").body).toBe(CHECKOUT_SESSION_NOT_FOUND)
  expect(replacementRefusal("not-found")).toEqual({
    status: 404,
    body: { error: { code: "checkout_session_not_found", message: "No checkout session with this id on your account." } },
  })
})

describe("a create route's two steps", () => {
  it("startReplacement: a refusal, nothing to expire, or the session to expire", async () => {
    retrieve.mockResolvedValueOnce(pack({ status: "complete" }))
    expect(await startReplacement("u1", "cs_test_1", PACK)).toEqual({ refusal: replacementRefusal("complete") })
    retrieve.mockResolvedValueOnce(open({ payment_intent: pi("processing") }))
    expect(await startReplacement("u1", "cs_test_1", PACK)).toEqual({ refusal: replacementRefusal("under-way") })
    retrieve.mockResolvedValueOnce(open({ customer: "cus_other" }))
    expect(await startReplacement("u1", "cs_test_1", PACK)).toEqual({ refusal: replacementRefusal("not-found") })
    retrieve.mockResolvedValueOnce(open({ status: "expired" }))
    expect(await startReplacement("u1", "cs_test_1", PACK)).toEqual({ expire: null })
    retrieve.mockResolvedValueOnce(open())
    expect(await startReplacement("u1", "cs_test_1", PACK)).toEqual({ expire: "cs_test_1" })
    expect(expire).not.toHaveBeenCalled()
  })

  it("finishReplacement: null once expired, else the refusal", async () => {
    expire.mockResolvedValueOnce(open({ status: "expired" }))
    expect(await finishReplacement("u1", "cs_test_1")).toBeNull()
    expire.mockRejectedValueOnce(refused())
    retrieve.mockResolvedValueOnce(pack({ status: "complete" }))
    expect(await finishReplacement("u1", "cs_test_1")).toEqual(replacementRefusal("complete"))
    expire.mockRejectedValueOnce(refused())
    retrieve.mockResolvedValueOnce(open())
    expect(await finishReplacement("u1", "cs_test_1")).toEqual(replacementRefusal("under-way"))
  })
})

describe("beginReplacement", () => {
  const fakeReply = () => {
    const reply = { status: vi.fn(), send: vi.fn() }
    reply.status.mockReturnValue(reply)
    reply.send.mockReturnValue(reply)
    return reply
  }

  it("a session to expire, or none, sends nothing", async () => {
    const reply = fakeReply()
    retrieve.mockResolvedValueOnce(open())
    expect(await beginReplacement("u1", "cs_test_1", PACK, reply as never, "Failed")).toEqual({ expire: "cs_test_1" })
    retrieve.mockResolvedValueOnce(open({ status: "expired" }))
    expect(await beginReplacement("u1", "cs_test_1", PACK, reply as never, "Failed")).toEqual({ expire: null })
    expect(reply.send).not.toHaveBeenCalled()
  })

  it("a refusal is sent, and the route is told it was handled", async () => {
    const reply = fakeReply()
    retrieve.mockResolvedValueOnce(pack({ status: "complete" }))
    expect(await beginReplacement("u1", "cs_test_1", PACK, reply as never, "Failed")).toBe(REPLACEMENT_HANDLED)
    expect(reply.status).toHaveBeenCalledWith(409)
    expect(reply.send).toHaveBeenCalledWith(replacementRefusal("complete").body)
  })

  it("a failed read sends the route's own 500 message", async () => {
    const reply = fakeReply()
    retrieve.mockRejectedValueOnce(new Error("connection reset"))
    expect(await beginReplacement("u1", "cs_test_1", PACK, reply as never, "Failed to create load session")).toBe(REPLACEMENT_HANDLED)
    expect(reply.status).toHaveBeenCalledWith(500)
    expect(reply.send).toHaveBeenCalledWith({ error: "Failed to create load session" })
    expect(expire).not.toHaveBeenCalled()
  })
})
