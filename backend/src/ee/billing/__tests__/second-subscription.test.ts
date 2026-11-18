/**
 * One subscription per account: a second one is granted nothing.
 *
 * An account that already holds a live subscription (`active`, `trialing`,
 * `past_due`, `unpaid`) and gets a second one through (a race the checkout's
 * 409 cannot see) keeps the plan it has. The second is the one whose
 * plan-grant claim the database refuses (`other_live`), whichever Stripe
 * created first: it is cancelled at Stripe at once, recorded as ended and
 * never granted only once Stripe has it cancelled, the payments of its first
 * invoice are refunded in full, and the founders' channel is told. A Stripe
 * failure asks Stripe to deliver the event again with nothing granted.
 *
 * When it is settled at all (only one the checkout sold, only while its first
 * invoice is its latest, only on the production deployment) is in
 * second-subscription-rules.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { TIER_CREDITS } from "../stripe-config.js"
import type { Row } from "../../../test/memory-tables.js"

vi.mock("@/lib/supabase.js", async () => (await import("./second-subscription-harness.js")).supabaseModule())
vi.mock("@/lib/config.js", async () => (await import("./second-subscription-harness.js")).configModule())
vi.mock("@/ee/billing/credits.js", async () => {
  const { state } = await import("./second-subscription-harness.js")
  return { CreditsService: { logTransaction: state.logTransaction } }
})
vi.mock("@/ee/billing/balance-cache.js", async () => ({ invalidateBalanceCache: (await import("./second-subscription-harness.js")).state.invalidate }))
vi.mock("@/ee/notifications/founder-notify.js", async () => {
  const { state } = await import("./second-subscription-harness.js")
  return {
    notifyPaidConversion: state.notifyPaidConversion,
    notifyCancellation: state.notifyCancellation,
    notifySecondSubscription: state.notifySecondSubscription,
  }
})
vi.mock("@/ee/billing/stripe-client.js", async () => {
  const { state } = await import("./second-subscription-harness.js")
  return { getStripe: () => state.stripe }
})
vi.mock("@/ee/billing/signup-grant.js", () => ({
  activateSignupGrantOnPurchase: vi.fn(async () => ({ activated: false, state: "granted" })),
}))
vi.mock("@/ee/lib/account-blocking.js", () => ({ releaseQuietStopOnPurchase: vi.fn(async () => ({ released: false })) }))

import { handleSubscriptionCreated, handleSubscriptionUpdated, handleSubscriptionCanceled, handleInvoicePaid, handleTopupClawback } from "../provision-credits.js"
import { StripeEventRetryError } from "../stripe-event-retry.js"
import * as secondSubscription from "../second-subscription.js"
import {
  state, USER, FIRST, SECOND, PRO, BASIC, GRANTED_PRO, FREE_PROFILE, FIRST_ROW, SECOND_UNPAID_ROW,
  created, updated, deleted, firstInvoicePaid, migratedDb, firstInvoice, soldSub, profile, rowOf, planGrants, refundKey,
  stripeCalls, alerts, resetHarness, restoreHarness, expectNothingGranted,
} from "./second-subscription-harness.js"

const { SECOND_SUBSCRIPTION_ACTION } = secondSubscription
const CANCEL_PARAMS = { prorate: false, invoice_now: false }
/** The second subscription, recorded as ended and never granted. */
const REFUSED = { user_id: USER, status: "canceled", plan_granted: false, stripe_price_id: BASIC, tier: "basic" }
/** Every write that records a subscription as ended. */
const endedWrites = () =>
  state.writes.filter((w) => w.table === "subscriptions" && ((w.update as Row | undefined)?.status === "canceled" || (w.insert as Row | undefined)?.status === "canceled"))

beforeEach(() => {
  resetHarness()
  secondSubscription.forgetSecondSubscriptionAlerts()
})
afterEach(restoreHarness)

describe("the action", () => {
  it("is to cancel the second subscription now and refund its first invoice", () => {
    expect(SECOND_SUBSCRIPTION_ACTION).toBe("cancel-and-refund")
  })
})

describe("a second subscription paid at once (created active)", () => {
  it("a second subscription created active: nothing granted, cancelled, recorded as ended, refunded, alerted", async () => {
    const before = { ...profile() }
    await handleSubscriptionCreated(created("active"))

    expectNothingGranted(before)
    expect(rowOf(SECOND)).toMatchObject(REFUSED)
    // A cancel is a DELETE: Stripe ignores an idempotency key on it, so none is sent.
    expect(state.stripe.subscriptions.cancel.mock.calls).toEqual([[SECOND, CANCEL_PARAMS]])
    expect(state.stripe.invoicePayments.list).toHaveBeenCalledWith({ invoice: `in_${SECOND}`, status: "paid", limit: 100 })
    expect(state.stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_second", amount: 1900, reason: "duplicate", metadata: { reason: "second_subscription", subscription: SECOND } },
      refundKey,
    )
    expect(state.stripe.refunds.create).toHaveBeenCalledTimes(1)
    expect(state.notifySecondSubscription).toHaveBeenCalledTimes(1)
    expect(state.notifySecondSubscription).toHaveBeenCalledWith(USER, FIRST, SECOND, "cancel-and-refund")
  })

  it.each(["past_due", "unpaid", "trialing"])("a first subscription stored %s is the account's live one: the second is refused", async (status) => {
    state.db = migratedDb(GRANTED_PRO, [{ ...FIRST_ROW, status }])
    state.stripeSubs.set(FIRST, soldSub(FIRST, PRO, { status }))
    await handleSubscriptionCreated(created("active"))
    expect(planGrants()).toHaveLength(0)
    expect(profile()).toEqual(GRANTED_PRO)
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
  })

  it("is recorded only once Stripe has it cancelled, then refunded: a retry after a failed refund only refunds", async () => {
    const order: string[] = []
    state.stripe.subscriptions.cancel.mockImplementationOnce(async (id: string) => {
      order.push(`cancel (row: ${rowOf(SECOND)?.status ?? "none"})`)
      state.stripeSubs.set(id, { ...state.stripeSubs.get(id)!, status: "canceled" })
      return { id, status: "canceled" }
    })
    state.stripe.refunds.create.mockImplementationOnce(async () => {
      order.push(`refund (row: ${rowOf(SECOND)?.status ?? "none"})`)
      throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" })
    })
    await expect(handleSubscriptionCreated(created("active"))).rejects.toBeInstanceOf(StripeEventRetryError)
    // Until Stripe has it cancelled the row is as it was recorded.
    expect(order).toEqual(["cancel (row: incomplete)", "refund (row: canceled)"])
    expect(state.claims).toEqual([{ p_stripe_subscription_id: SECOND, p_user_id: USER }])
    // The delivery that failed says what is left.
    expect(alerts()).toEqual([["cancel-and-refund", expect.stringContaining("not refunded")]])

    // Redelivered: its row is ended and never granted, and it is still settled.
    await handleSubscriptionCreated(created("active"))
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(state.stripe.refunds.create.mock.calls.map((c) => c[1])).toEqual([refundKey, refundKey])
    expect(alerts()).toEqual([["cancel-and-refund", expect.stringContaining("not refunded")], ["cancel-and-refund", undefined]])
    expect(planGrants()).toHaveLength(0)
    expect(rowOf(SECOND)).toMatchObject(REFUSED)
  })

  it("a redelivered event settles again idempotently: the same refund key, no second cancel, no second alert", async () => {
    await handleSubscriptionCreated(created("active"))
    // A day later the keys have expired; Stripe answers the refund as already made.
    const alreadyRefunded = () => Object.assign(new Error("Charge ch_1 has already been refunded."), { type: "StripeInvalidRequestError", code: "charge_already_refunded" })
    state.stripe.refunds.create.mockRejectedValueOnce(alreadyRefunded())
    await expect(handleSubscriptionCreated(created("active"))).resolves.toBeUndefined()
    // Its paid update, late: the same.
    state.stripe.refunds.create.mockRejectedValueOnce(alreadyRefunded())
    await expect(handleSubscriptionUpdated(updated("active"))).resolves.toBeUndefined()

    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(state.stripe.refunds.create.mock.calls.map((c) => c[1])).toEqual([refundKey, refundKey, refundKey])
    expect(state.notifySecondSubscription).toHaveBeenCalledTimes(1)
    expect(planGrants()).toHaveLength(0)
    expect(rowOf(SECOND)).toMatchObject(REFUSED)
  })

  it("a Stripe failure while cancelling asks for the event again: nothing recorded, nothing refunded, and it is said", async () => {
    state.stripe.subscriptions.cancel.mockRejectedValue(new Error("connection reset"))
    const before = { ...profile() }
    await expect(handleSubscriptionCreated(created("active"))).rejects.toBeInstanceOf(StripeEventRetryError)
    expectNothingGranted(before)
    expect(rowOf(SECOND)).toMatchObject({ status: "incomplete", plan_granted: false })
    expect(endedWrites()).toEqual([])
    expect(state.stripe.refunds.create).not.toHaveBeenCalled()
    expect(alerts()).toEqual([["cancel-and-refund", expect.stringContaining("not cancelled")]])

    // Redelivered once Stripe answers: claimed again, refused again, settled.
    state.stripe.subscriptions.cancel.mockReset().mockImplementation(async (id: string) => {
      state.stripeSubs.set(id, { ...state.stripeSubs.get(id)!, status: "canceled" })
      return { id, status: "canceled" }
    })
    await handleSubscriptionCreated(created("active"))
    expect(state.claims).toHaveLength(2)
    expect(rowOf(SECOND)).toMatchObject(REFUSED)
    expect(state.stripe.refunds.create).toHaveBeenCalledTimes(1)
    expectNothingGranted(before)
  })

  it("a cancel Stripe answers without confirming it is not believed: nothing recorded, the event asked for again", async () => {
    state.stripe.subscriptions.cancel.mockImplementation(async (id: string) => ({ id, status: "active" }))
    await expect(handleSubscriptionCreated(created("active"))).rejects.toBeInstanceOf(StripeEventRetryError)
    expect(rowOf(SECOND)).toMatchObject({ status: "incomplete", plan_granted: false })
    expect(endedWrites()).toEqual([])
    expect(state.stripe.refunds.create).not.toHaveBeenCalled()
  })

  it("a failed cancel whose re-read says cancelled counts as done", async () => {
    state.stripe.subscriptions.cancel.mockImplementationOnce(async (id: string) => {
      state.stripeSubs.set(id, { ...state.stripeSubs.get(id)!, status: "canceled" })
      throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" })
    })
    await handleSubscriptionCreated(created("active"))
    expect(state.stripe.refunds.create).toHaveBeenCalledTimes(1)
    expect(alerts()).toEqual([["cancel-and-refund", undefined]])
  })

  it("any other error in the settlement also asks for redelivery, never an acknowledged duplicate", async () => {
    state.stripe.invoicePayments.list.mockResolvedValueOnce(undefined as never)
    await expect(handleSubscriptionCreated(created("active"))).rejects.toBeInstanceOf(StripeEventRetryError)
    expect(planGrants()).toHaveLength(0)
  })
})

describe("a second subscription paid after creation (incomplete, then paid)", () => {
  it("created incomplete, then paid: recorded unpaid, the paid update grants nothing, settles it and ends its row", async () => {
    const before = { ...profile() }
    await handleSubscriptionCreated(created("incomplete"))
    expect(state.stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(rowOf(SECOND)).toMatchObject({ plan_granted: false, status: "incomplete" })
    await handleSubscriptionUpdated(updated("active"))

    expectNothingGranted(before)
    expect(rowOf(SECOND)).toMatchObject(REFUSED)
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(state.stripe.refunds.create).toHaveBeenCalledTimes(1)
    expect(state.notifySecondSubscription).toHaveBeenCalledTimes(1)
  })

  it("the paid update arriving before created: nothing granted, settled, and the late created records nothing over it", async () => {
    const before = { ...profile() }
    await handleSubscriptionUpdated(updated("active"))

    expectNothingGranted(before)
    expect(rowOf(SECOND)).toMatchObject(REFUSED)
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(state.stripe.refunds.create).toHaveBeenCalledTimes(1)
    expect(state.notifySecondSubscription).toHaveBeenCalledTimes(1)

    // Its created event, late and still saying incomplete: the ended row stays.
    await handleSubscriptionCreated(created("incomplete"))
    expect(rowOf(SECOND)).toMatchObject(REFUSED)
    expect((state.db.tables.subscriptions as Row[]).filter((r) => r.stripe_subscription_id === SECOND)).toHaveLength(1)
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(profile()).toEqual(before)
  })

  it("a first invoice that charged nothing refunds nothing and is not an error", async () => {
    state.invoicePayments = []
    state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { status: "trialing", latest_invoice: firstInvoice(SECOND, { amount_paid: 0 }) }))
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionUpdated(updated("trialing"))
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(state.stripe.refunds.create).not.toHaveBeenCalled()
    expect(planGrants()).toHaveLength(0)
    expect(alerts()).toEqual([["cancel-and-refund", undefined]])
  })

  it("a refund that failed is retried by the redelivered update, although its cancellation ended the row meanwhile", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    state.stripe.refunds.create.mockRejectedValueOnce(Object.assign(new Error("connection reset"), { type: "StripeConnectionError" }))
    await expect(handleSubscriptionUpdated(updated("active"))).rejects.toBeInstanceOf(StripeEventRetryError)
    await handleSubscriptionCanceled(deleted(SECOND))

    await handleSubscriptionUpdated(updated("active"))
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(state.stripe.refunds.create.mock.calls.map((c) => c[1])).toEqual([refundKey, refundKey])
    expect(planGrants()).toHaveLength(0)
    expect(profile()).toEqual(GRANTED_PRO)
  })
})

describe("what is refunded", () => {
  it("a payment by charge is refunded by its charge, keyed by it", async () => {
    state.invoicePayments = [{ id: "inpay_2", status: "paid", amount_paid: 1900, payment: { type: "charge", charge: { id: "ch_second" } } }]
    await handleSubscriptionCreated(created("active"))
    expect(state.stripe.refunds.create).toHaveBeenCalledWith(
      { charge: "ch_second", amount: 1900, reason: "duplicate", metadata: { reason: "second_subscription", subscription: SECOND } },
      { idempotencyKey: "second-subscription-refund:ch_second" },
    )
  })

  it("an invoice given as an id is read to check it", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { latest_invoice: `in_${SECOND}` }))
    await handleSubscriptionCreated(created("active"))
    expect(state.stripe.invoices.retrieve).toHaveBeenCalledWith(`in_${SECOND}`)
    expect(state.stripe.refunds.create).toHaveBeenCalledTimes(1)
  })

  it("a first invoice still settling (a bank debit) is cancelled, nothing refunded yet, and a person is told", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { latest_invoice: firstInvoice(SECOND, { status: "open", amount_paid: 0, amount_due: 1900, amount_remaining: 1900 }) }))
    state.invoicePayments = []
    await expect(handleSubscriptionCreated(created("active"))).resolves.toBeUndefined()
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(state.stripe.refunds.create).not.toHaveBeenCalled()
    expect(state.notifySecondSubscription).toHaveBeenCalledWith(USER, FIRST, SECOND, "cancel-and-refund", expect.stringContaining("not settled"))
  })

  it("a paid payment that cannot be refunded here is reported for a person, not retried forever", async () => {
    state.invoicePayments = [{ id: "inpay_3", status: "paid", amount_paid: 1900, payment: { type: "payment_record", payment_record: "pr_1" } }]
    await expect(handleSubscriptionCreated(created("active"))).resolves.toBeUndefined()
    expect(state.stripe.refunds.create).not.toHaveBeenCalled()
    expect(state.notifySecondSubscription).toHaveBeenCalledWith(USER, FIRST, SECOND, "cancel-and-refund", expect.stringContaining("by hand"))
  })
})

describe("the second subscription's later events", () => {
  it("its later cancellation leaves the account as it was", async () => {
    const before = { ...profile() }
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionUpdated(updated("canceled"))
    await handleSubscriptionCanceled(deleted(SECOND))
    expectNothingGranted(before)
    expect(rowOf(SECOND)).toMatchObject(REFUSED)
    expect(state.notifyCancellation).not.toHaveBeenCalled()
  })

  it("on the incomplete path too: its row ends cancelled, the first plan untouched", async () => {
    const before = { ...profile() }
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionUpdated(updated("active"))
    await handleSubscriptionUpdated(updated("canceled"))
    await handleSubscriptionCanceled(deleted(SECOND))
    expect(profile()).toEqual(before)
    expect(rowOf(FIRST)).toEqual(FIRST_ROW)
    expect(rowOf(SECOND)).toMatchObject(REFUSED)
    expect(state.notifyCancellation).not.toHaveBeenCalled()
    expect(state.notifySecondSubscription).toHaveBeenCalledTimes(1)
  })

  it("its refund claws nothing back, and its late first invoice grants nothing and writes no receipt", async () => {
    const before = { ...profile() }
    await handleSubscriptionCreated(created("active"))
    await handleTopupClawback({ paymentIntentId: "pi_second", refunds: [{ refundId: "re_second", amountCents: 1900 }] })
    await handleInvoicePaid(firstInvoicePaid(SECOND))
    expectNothingGranted(before)
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(state.notifySecondSubscription).toHaveBeenCalledTimes(1)
  })
})

describe("not a second subscription", () => {
  it.each(["canceled", "incomplete_expired", "expired", "incomplete"])("an account whose only other row is %s grants as today", async (status) => {
    state.db = migratedDb(FREE_PROFILE, [{ ...FIRST_ROW, status }])
    await handleSubscriptionCreated(created("active"))
    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject({ tier: "basic", subscription_credits: TIER_CREDITS.basic })
    expect(rowOf(SECOND)).toMatchObject({ status: "active", plan_granted: true })
    expect(state.stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(state.notifySecondSubscription).not.toHaveBeenCalled()
  })

  it("a re-subscribe paid after creation, the old plan ended, grants as today", async () => {
    state.db = migratedDb(FREE_PROFILE, [{ ...FIRST_ROW, status: "canceled" }])
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionUpdated(updated("active"))
    expect(planGrants()).toHaveLength(1)
    expect(rowOf(SECOND)).toMatchObject({ status: "active", plan_granted: true })
    expect(state.stripe.subscriptions.retrieve).not.toHaveBeenCalled()
  })

  it("the first subscription's own events are untouched (renewal, update)", async () => {
    // A plan change of the same subscription, then its renewal, then a redelivered created.
    await handleSubscriptionUpdated(updated("active", { subscriptionId: FIRST, priceId: BASIC }))
    await handleSubscriptionUpdated(
      updated("active", { subscriptionId: FIRST, priceId: BASIC, currentPeriodStart: "2026-12-01T00:00:00.000Z", currentPeriodEnd: "2027-01-01T00:00:00.000Z" }),
    )
    await handleSubscriptionCreated(created("active", { subscriptionId: FIRST, priceId: PRO }))
    expect(rowOf(FIRST)).toMatchObject({ status: "active", stripe_price_id: BASIC, plan_granted: true })
    expect(planGrants()).toHaveLength(0)
    for (const call of stripeCalls()) expect(call).not.toHaveBeenCalled()
    expect(state.notifySecondSubscription).not.toHaveBeenCalled()
  })

  it("a first subscription whose grant was released (active, not granted) is regranted by its redelivery, not refused", async () => {
    state.db = migratedDb(FREE_PROFILE, [{ ...FIRST_ROW, plan_granted: false }])
    await handleSubscriptionCreated(created("active", { subscriptionId: FIRST, priceId: PRO }))
    expect(planGrants()).toHaveLength(1)
    expect(rowOf(FIRST)).toMatchObject({ plan_granted: true })
    expect(state.stripe.subscriptions.retrieve).not.toHaveBeenCalled()
  })

  it("a subscription that ended unpaid and gets a late paid event, with no other live one, reaches Stripe for nothing", async () => {
    state.db = migratedDb(FREE_PROFILE, [{ ...SECOND_UNPAID_ROW, status: "canceled" }])
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionUpdated(updated("active"))
    expect(planGrants()).toHaveLength(0)
    for (const call of stripeCalls()) expect(call).not.toHaveBeenCalled()
    expect(state.notifySecondSubscription).not.toHaveBeenCalled()
  })
})

describe("the call sites", () => {
  it("a recorded, never granted second subscription redelivered as created active is refused at the regrant", async () => {
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW, SECOND_UNPAID_ROW])
    await handleSubscriptionCreated(created("active"))
    expect(planGrants()).toHaveLength(0)
    expect(rowOf(SECOND)).toMatchObject(REFUSED)
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
  })

  it("a paid event of a settled second, redelivered after the first plan ended, grants nothing: its ended row is never claimed", async () => {
    await handleSubscriptionCreated(created("active"))
    state.db.tables.subscriptions = (state.db.tables.subscriptions as Row[]).map((r) => (r.stripe_subscription_id === FIRST ? { ...r, status: "canceled" } : r))
    state.db.tables.profiles = [{ ...FREE_PROFILE }]
    state.writes.length = 0
    const stripeBefore = stripeCalls().map((c) => c.mock.calls.length)

    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionUpdated(updated("active"))
    await handleInvoicePaid(firstInvoicePaid(SECOND))

    expect(planGrants()).toHaveLength(0)
    expect(profile()).toEqual(FREE_PROFILE)
    expect(rowOf(SECOND)).toMatchObject(REFUSED)
    expect(state.writes.filter((w) => w.table === "profiles" || w.table === "transactions" || w.rpc)).toEqual([])
    expect(stripeCalls().map((c) => c.mock.calls.length)).toEqual(stripeBefore)
  })
})

describe("the database", () => {
  it("the claim decides it: the account's subscriptions are not read before it, and only its refusal is settled", async () => {
    const reads: string[] = []
    state.refusals.push({
      when: (t, p) => {
        if (t === "subscriptions" && p === "neq") reads.push(`read of the other subscriptions (claims so far: ${state.claims.length})`)
        return false
      },
      error: { code: "unused", message: "unused" },
    })
    await handleSubscriptionCreated(created("active"))
    expect(state.claims).toEqual([{ p_stripe_subscription_id: SECOND, p_user_id: USER }])
    expect(reads).toEqual([])
    expect(state.notifySecondSubscription).toHaveBeenCalledWith(USER, FIRST, SECOND, "cancel-and-refund")
  })

  it("the subscription the account keeps is the one the claim names", async () => {
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW, SECOND_UNPAID_ROW])
    state.stripeSubs.set("sub_named", soldSub("sub_named", PRO))
    state.claimAnswer = [{ outcome: "other_live", other_stripe_subscription_id: "sub_named" }]
    await handleSubscriptionUpdated(updated("active"))
    expect(state.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_named")
    expect(state.notifySecondSubscription).toHaveBeenCalledWith(USER, "sub_named", SECOND, "cancel-and-refund")
  })

  it.each(["claimed", "not_claimable"])("a claim answered %s settles nothing", async (outcome) => {
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW, SECOND_UNPAID_ROW])
    state.claimAnswer = [{ outcome, other_stripe_subscription_id: null }]
    await handleSubscriptionUpdated(updated("active"))
    for (const call of stripeCalls()) expect(call).not.toHaveBeenCalled()
    expect(state.notifySecondSubscription).not.toHaveBeenCalled()
  })

  it("a claim the database could not answer asks for redelivery: nothing granted, nothing at Stripe", async () => {
    state.claimAnswer = [{ outcome: "something_else", other_stripe_subscription_id: null }]
    const before = { ...profile() }
    await expect(handleSubscriptionCreated(created("active"))).rejects.toBeInstanceOf(StripeEventRetryError)
    expectNothingGranted(before)
    expect(rowOf(SECOND)).toMatchObject({ status: "incomplete", plan_granted: false })
    for (const call of stripeCalls()) expect(call).not.toHaveBeenCalled()
  })

  it("a database error reading who holds the plan, for a row already ended, asks for redelivery", async () => {
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW, { ...SECOND_UNPAID_ROW, status: "canceled" }])
    state.refusals.push({ when: (t, p) => t === "subscriptions" && p === "neq", error: { code: "57014", message: "canceling statement due to statement timeout" } })
    const before = { ...profile() }
    await expect(handleSubscriptionCreated(created("active"))).rejects.toBeInstanceOf(StripeEventRetryError)
    expect(state.writes).toEqual([])
    expectNothingGranted(before)
    expect(state.stripe.subscriptions.retrieve).not.toHaveBeenCalled()
  })

  it("a refused subscription that cannot be recorded asks for the event again, before anything is refunded", async () => {
    state.refusals.push({ when: (t, p, arg) => t === "subscriptions" && p === "update" && (arg as Row).status === "canceled", error: { code: "57014", message: "canceling statement due to statement timeout" } })
    await expect(handleSubscriptionCreated(created("active"))).rejects.toBeInstanceOf(StripeEventRetryError)
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(state.stripe.refunds.create).not.toHaveBeenCalled()
    expect(planGrants()).toHaveLength(0)
  })

  it("two subscriptions paid at creation at once: the one whose claim is refused is settled", async () => {
    state.db = migratedDb(FREE_PROFILE, [])
    state.interleave = {
      when: (w) => (w.insert as Row | undefined)?.stripe_subscription_id === SECOND,
      run: () => handleSubscriptionCreated(created("active", { subscriptionId: FIRST, priceId: PRO })),
    }
    await handleSubscriptionCreated(created("active"))
    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject({ tier: "pro" })
    expect(rowOf(SECOND)).toMatchObject(REFUSED)
    expect(state.stripe.subscriptions.cancel.mock.calls).toEqual([[SECOND, CANCEL_PARAMS]])
    expect(state.notifySecondSubscription).toHaveBeenCalledWith(USER, FIRST, SECOND, "cancel-and-refund")
  })

  it("a paid update racing another subscription's grant is settled too", async () => {
    state.db = migratedDb(FREE_PROFILE, [])
    state.interleave = {
      when: (w) => (w.insert as Row | undefined)?.stripe_subscription_id === SECOND,
      run: () => handleSubscriptionCreated(created("active", { subscriptionId: FIRST, priceId: PRO })),
    }
    await handleSubscriptionUpdated(updated("active"))
    expect(planGrants()).toHaveLength(1)
    expect(rowOf(SECOND)).toMatchObject(REFUSED)
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
  })
})
