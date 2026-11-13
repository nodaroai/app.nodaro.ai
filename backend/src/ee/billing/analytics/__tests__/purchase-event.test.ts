import { describe, it, expect } from "vitest"
import type Stripe from "stripe"
import { purchaseOfStripeEvent } from "../purchase-event.js"

const USER = "8a1f3c2e-0b4d-4e6f-9a7b-1c2d3e4f5a6b"
const VISIT = { ga_client_id: "1234567890.1700000000", ga_session_id: "1700000500" }

function event(type: string, object: Record<string, unknown>, livemode = true): Stripe.Event {
  return { id: "evt_1", type, livemode, data: { object } } as unknown as Stripe.Event
}

function checkout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "cs_1",
    mode: "payment",
    payment_status: "paid",
    payment_intent: "pi_1",
    amount_total: 2500,
    currency: "usd",
    metadata: { userId: USER, topupPriceId: "price_pack", ...VISIT },
    ...overrides,
  }
}

function invoice(overrides: Record<string, unknown> = {}, metadata: Record<string, string> = { userId: USER, ...VISIT }): Record<string, unknown> {
  return {
    id: "in_1",
    amount_paid: 2900,
    currency: "usd",
    billing_reason: "subscription_create",
    parent: { subscription_details: { subscription: "sub_1", metadata } },
    ...overrides,
  }
}

describe("purchaseOfStripeEvent — one-time Checkouts", () => {
  it("a paid credit pack is a purchase on its payment intent, with the visit it started in", () => {
    expect(purchaseOfStripeEvent(event("checkout.session.completed", checkout()))).toEqual({
      transactionId: "pi_1",
      amountMinor: 2500,
      currency: "USD",
      item: { id: "price_pack", name: "Credit pack", category: "credit_pack" },
      userId: USER,
      gaClientId: VISIT.ga_client_id,
      gaSessionId: VISIT.ga_session_id,
    })
  })

  it("an async payment settles on async_payment_succeeded with the same transaction", () => {
    const facts = purchaseOfStripeEvent(event("checkout.session.async_payment_succeeded", checkout()))
    expect(facts?.transactionId).toBe("pi_1")
  })

  it("a load and an organization pack are named for what they are", () => {
    const load = purchaseOfStripeEvent(event("checkout.session.completed", checkout({ metadata: { userId: USER, kind: "load", loadUsd: "20" } })))
    expect(load?.item).toEqual({ id: "credit-load", name: "Credit load", category: "credit_load" })
    const org = purchaseOfStripeEvent(event("checkout.session.completed", checkout({ metadata: { payerKind: "org", orgId: "o1", packId: "pack_10", actorUserId: USER } })))
    expect(org?.item).toEqual({ id: "pack_10", name: "Organization credit pack", category: "org_pack" })
    // An organization pack names its buyer as the actor.
    expect(org?.userId).toBe(USER)
    const anonymousOrg = purchaseOfStripeEvent(event("checkout.session.completed", checkout({ metadata: { payerKind: "org", orgId: "o1", packId: "pack_10" } })))
    expect(anonymousOrg?.userId).toBeNull()
  })

  it("an expanded payment intent and a missing one both resolve a transaction id", () => {
    expect(purchaseOfStripeEvent(event("checkout.session.completed", checkout({ payment_intent: { id: "pi_x" } })))?.transactionId).toBe("pi_x")
    expect(purchaseOfStripeEvent(event("checkout.session.completed", checkout({ payment_intent: null })))?.transactionId).toBe("cs_1")
  })

  it("nothing settled is no purchase: unpaid, free, or no currency", () => {
    for (const overrides of [
      { payment_status: "unpaid" },
      { payment_status: "no_payment_required" },
      { amount_total: 0 },
      { amount_total: null },
      { currency: null },
    ]) {
      expect(purchaseOfStripeEvent(event("checkout.session.completed", checkout(overrides))), JSON.stringify(overrides)).toBeNull()
    }
  })

  it("a subscription's Checkout is not a purchase (its first invoice is)", () => {
    expect(purchaseOfStripeEvent(event("checkout.session.completed", checkout({ mode: "subscription" })))).toBeNull()
  })

  it("malformed ids in the metadata are dropped, not passed on", () => {
    const facts = purchaseOfStripeEvent(event("checkout.session.completed", checkout({
      metadata: { userId: "not a user id!", ga_client_id: "GA1.1.12.34", ga_session_id: "s123" },
    })))
    expect(facts).toMatchObject({ userId: null, gaClientId: null, gaSessionId: null })
  })
})

describe("purchaseOfStripeEvent — subscriptions", () => {
  it("the first payment carries the visit's session", () => {
    expect(purchaseOfStripeEvent(event("invoice.paid", invoice()))).toEqual({
      transactionId: "in_1",
      amountMinor: 2900,
      currency: "USD",
      item: { id: "subscription", name: "Subscription", category: "subscription", variant: "subscription_create" },
      userId: USER,
      gaClientId: VISIT.ga_client_id,
      gaSessionId: VISIT.ga_session_id,
    })
  })

  it("a renewal and a plan change keep the client but not the long-gone session", () => {
    for (const reason of ["subscription_cycle", "subscription_update"]) {
      const facts = purchaseOfStripeEvent(event("invoice.paid", invoice({ billing_reason: reason })))
      expect(facts, reason).toMatchObject({ gaClientId: VISIT.ga_client_id, gaSessionId: null, item: { variant: reason } })
    }
  })

  it("a zero invoice, a non-subscription invoice, and a missing id are no purchase", () => {
    expect(purchaseOfStripeEvent(event("invoice.paid", invoice({ amount_paid: 0 })))).toBeNull()
    expect(purchaseOfStripeEvent(event("invoice.paid", invoice({ parent: null })))).toBeNull()
    expect(purchaseOfStripeEvent(event("invoice.paid", invoice({ id: undefined })))).toBeNull()
  })
})

describe("purchaseOfStripeEvent — auto-recharge and the rest", () => {
  it("an auto-recharge is a purchase with no visit", () => {
    const facts = purchaseOfStripeEvent(event("payment_intent.succeeded", {
      id: "pi_auto",
      amount_received: 1000,
      currency: "usd",
      metadata: { kind: "auto_recharge", userId: USER },
    }))
    expect(facts).toEqual({
      transactionId: "pi_auto",
      amountMinor: 1000,
      currency: "USD",
      item: { id: "auto-recharge", name: "Credit auto-recharge", category: "auto_recharge" },
      userId: USER,
      gaClientId: null,
      gaSessionId: null,
    })
  })

  it("a Checkout's own payment intent is not counted again", () => {
    expect(purchaseOfStripeEvent(event("payment_intent.succeeded", { id: "pi_1", amount_received: 2500, currency: "usd", metadata: { userId: USER } }))).toBeNull()
  })

  it("test-mode events and other event types are never a purchase", () => {
    expect(purchaseOfStripeEvent(event("checkout.session.completed", checkout(), false))).toBeNull()
    expect(purchaseOfStripeEvent(event("customer.subscription.created", { id: "sub_1" }))).toBeNull()
    expect(purchaseOfStripeEvent(event("charge.refunded", { id: "ch_1" }))).toBeNull()
  })
})
