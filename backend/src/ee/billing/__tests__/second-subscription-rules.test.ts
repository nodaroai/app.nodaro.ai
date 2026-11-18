/**
 * When a second subscription is settled at Stripe, and when it is only
 * reported. Refused (granted nothing) in every case below; what differs is
 * whether anything is cancelled or refunded.
 *
 *  - Only one the checkout sold: a plan's price and the account's own stamp.
 *  - Only while its latest invoice is still its first one.
 *  - Only when Stripe created it within the last seven days.
 *  - Only while the subscription the account keeps is live at Stripe.
 *  - Only on the production deployment (another deployment hears the same
 *    events on the same database and leaves the settlement to it).
 *  - A refund Stripe refuses for good is a person's; one it could not take
 *    yet is retried with the event.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
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

import { handleSubscriptionCreated, handleSubscriptionUpdated, handleSubscriptionCanceled, handleInvoicePaid } from "../provision-credits.js"
import { StripeEventRetryError } from "../stripe-event-retry.js"
import * as secondSubscription from "../second-subscription.js"
import {
  state, USER, FIRST, SECOND, PRO, BASIC, GRANTED_PRO, FREE_PROFILE, FIRST_ROW, SECOND_UNPAID_ROW,
  created, updated, deleted, firstInvoicePaid, migratedDb, firstInvoice, soldSub, profile, rowOf, planGrants, refundKey,
  stripeWrites, stripeCalls, alerts, resetHarness, restoreHarness, expectNothingGranted,
} from "./second-subscription-harness.js"

beforeEach(() => {
  resetHarness()
  secondSubscription.forgetSecondSubscriptionAlerts()
})
afterEach(restoreHarness)

/** Every write of a subscription's status after its first recording as `incomplete`. */
const statusWrites = () =>
  state.writes.filter((w) => {
    if (w.table !== "subscriptions") return false
    const written = (w.update ?? w.insert) as Row | undefined
    return written?.status !== undefined && !(w.insert !== undefined && written.status === "incomplete")
  })

/** Refused and reported, with nothing done at Stripe: its row is left as recorded, `incomplete` and never granted. */
function expectOnlyReported(before: Row, note: string) {
  expectNothingGranted(before)
  for (const write of stripeWrites()) expect(write).not.toHaveBeenCalled()
  expect(rowOf(SECOND)).toMatchObject({ status: "incomplete", plan_granted: false })
  expect(statusWrites()).toEqual([])
  expect(alerts()).toEqual([["alert", expect.stringContaining(note)]])
  expect(state.notifySecondSubscription).toHaveBeenCalledWith(USER, FIRST, SECOND, "alert", expect.any(String))
}

const receipts = () => state.writes.filter((w) => w.table === "transactions")

describe("only a subscription the checkout sold is settled", () => {
  it("a price that is no plan's: nothing granted, nothing cancelled or refunded, reported", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, "price_not_a_plan"))
    const before = { ...profile() }
    await handleSubscriptionCreated(created("active", { priceId: "price_not_a_plan" }))
    expectOnlyReported(before, "not sold by the checkout")
  })

  it("no account stamp from the checkout: reported only", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { metadata: {} }))
    const before = { ...profile() }
    await handleSubscriptionCreated(created("active", { metadata: null }))
    expectOnlyReported(before, "not sold by the checkout")
  })

  it("another account's stamp: reported only", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { metadata: { userId: "someone-else" } }))
    const before = { ...profile() }
    await handleSubscriptionUpdated(updated("active"))
    expectOnlyReported(before, "not sold by the checkout")
  })

  it("what the event says is not what decides: Stripe's own copy of the subscription is read", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, "price_not_a_plan", { metadata: {} }))
    const before = { ...profile() }
    await handleSubscriptionCreated(created("active"))
    expectOnlyReported(before, "not sold by the checkout")
  })
})

describe("only a fresh duplicate is settled", () => {
  it("past its first invoice (a renewal): nothing cancelled, nothing refunded, reported", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { latest_invoice: firstInvoice(SECOND, { id: "in_renewal", billing_reason: "subscription_cycle" }) }))
    const before = { ...profile() }
    await handleSubscriptionUpdated(updated("active"))
    expectOnlyReported(before, "first invoice")
    expect(state.stripe.invoicePayments.list).not.toHaveBeenCalled()
  })

  it("a latest invoice that belongs to another subscription: reported only", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { latest_invoice: firstInvoice(FIRST) }))
    const before = { ...profile() }
    await handleSubscriptionCreated(created("active"))
    expectOnlyReported(before, "first invoice")
  })

  it("no invoice at all: reported only", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { latest_invoice: null }))
    const before = { ...profile() }
    await handleSubscriptionCreated(created("active"))
    expectOnlyReported(before, "first invoice")
  })

  it("its later events are refused again and not reported again by this process", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { latest_invoice: firstInvoice(SECOND, { id: "in_renewal", billing_reason: "subscription_cycle" }) }))
    await handleSubscriptionUpdated(updated("active"))
    await handleSubscriptionUpdated(updated("active"))
    await handleSubscriptionCreated(created("active"))
    expect(planGrants()).toHaveLength(0)
    expect(state.notifySecondSubscription).toHaveBeenCalledTimes(1)
    for (const write of stripeWrites()) expect(write).not.toHaveBeenCalled()
  })
})

describe("only a duplicate created within the last seven days is settled", () => {
  const DAY = 24 * 60 * 60
  const NOW = 1_800_000_000
  const aged = (seconds: number, over: Record<string, unknown> = {}) => soldSub(SECOND, BASIC, { created: NOW - seconds, ...over })
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000)
  })
  afterEach(() => {
    vi.mocked(Date.now).mockRestore()
  })

  it("the bound is seven days, in seconds", () => {
    expect(secondSubscription.SECOND_SUBSCRIPTION_MAX_AGE_SECONDS).toBe(7 * 24 * 60 * 60)
  })

  it("six days old: cancelled and refunded", async () => {
    state.stripeSubs.set(SECOND, aged(6 * DAY))
    await handleSubscriptionCreated(created("active"))
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(state.stripe.refunds.create).toHaveBeenCalledTimes(1)
    expect(alerts()).toEqual([["cancel-and-refund", undefined]])
  })

  it("eight days old, its first invoice still its latest: nothing cancelled, nothing refunded, reported", async () => {
    state.stripeSubs.set(SECOND, aged(8 * DAY))
    const before = { ...profile() }
    await handleSubscriptionUpdated(updated("active"))
    expectOnlyReported(before, "more than 7 days")
    expect(state.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1)
  })

  it("exactly seven days old is settled; one second older is not", async () => {
    state.stripeSubs.set(SECOND, aged(7 * DAY))
    await handleSubscriptionCreated(created("active"))
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)

    resetHarness()
    secondSubscription.forgetSecondSubscriptionAlerts()
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000)
    state.stripeSubs.set(SECOND, aged(7 * DAY + 1))
    const before = { ...profile() }
    await handleSubscriptionCreated(created("active"))
    expectOnlyReported(before, "more than 7 days")
  })

  it("a subscription Stripe gives no creation time for is not settled", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { created: undefined }))
    const before = { ...profile() }
    await handleSubscriptionCreated(created("active"))
    expectOnlyReported(before, "more than 7 days")
  })

  it("both rules must hold: young but past its first invoice is reported only", async () => {
    state.stripeSubs.set(SECOND, aged(DAY, { latest_invoice: firstInvoice(SECOND, { id: "in_renewal", billing_reason: "subscription_cycle" }) }))
    const before = { ...profile() }
    await handleSubscriptionUpdated(updated("active"))
    expectOnlyReported(before, "first invoice")
  })

  it("an ended, never granted one older than seven days is not refunded when a paid event finds it: reported only", async () => {
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW, { ...SECOND_UNPAID_ROW, status: "canceled" }])
    state.stripeSubs.set(SECOND, aged(8 * DAY, { status: "canceled" }))
    const before = { ...profile() }
    await handleSubscriptionUpdated(updated("active"))
    await handleSubscriptionCreated(created("active"))
    expectNothingGranted(before)
    for (const write of stripeWrites()) expect(write).not.toHaveBeenCalled()
    expect(rowOf(SECOND)).toMatchObject({ status: "canceled", plan_granted: false })
    expect(alerts()).toEqual([["alert", expect.stringContaining("more than 7 days")]])
  })
})

describe("a second subscription that was only reported", () => {
  it("keeps its row as recorded, and is granted by its next paid event once the first plan has ended", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { latest_invoice: firstInvoice(SECOND, { id: "in_renewal", billing_reason: "subscription_cycle" }) }))
    const before = { ...profile() }
    await handleSubscriptionUpdated(updated("active"))
    expectOnlyReported(before, "first invoice")

    // The first plan ends; the second is still paid at Stripe.
    state.db.tables.subscriptions = (state.db.tables.subscriptions as Row[]).map((r) => (r.stripe_subscription_id === FIRST ? { ...r, status: "canceled" } : r))
    state.db.tables.profiles = [{ ...FREE_PROFILE }]
    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(1)
    expect(rowOf(SECOND)).toMatchObject({ status: "active", plan_granted: true, tier: "basic" })
    expect(profile()).toMatchObject({ tier: "basic" })
    for (const write of stripeWrites()) expect(write).not.toHaveBeenCalled()
    expect(state.notifySecondSubscription).toHaveBeenCalledTimes(1)
  })
})

describe("only while the kept subscription is live at Stripe", () => {
  it.each(["canceled", "incomplete_expired", "paused"])("the kept one is %s at Stripe: nothing cancelled, nothing refunded, reported", async (status) => {
    state.stripeSubs.set(FIRST, soldSub(FIRST, PRO, { status }))
    const before = { ...profile() }
    await handleSubscriptionCreated(created("active"))
    expectOnlyReported(before, "kept")
    expect(state.stripe.subscriptions.retrieve).toHaveBeenCalledWith(FIRST)
  })

  it("the kept one is unknown to Stripe: reported only", async () => {
    state.stripeSubs.delete(FIRST)
    const before = { ...profile() }
    await handleSubscriptionCreated(created("active"))
    expectOnlyReported(before, "kept")
  })

  it("the kept one is confirmed before the cancel", async () => {
    const order: string[] = []
    const retrieve = state.stripe.subscriptions.retrieve.getMockImplementation()!
    state.stripe.subscriptions.retrieve.mockImplementation(async (id: string, ...rest: unknown[]) => {
      order.push(`retrieve ${id}`)
      return retrieve(id, ...rest)
    })
    const cancel = state.stripe.subscriptions.cancel.getMockImplementation()!
    state.stripe.subscriptions.cancel.mockImplementation(async (id: string, ...rest: unknown[]) => {
      order.push(`cancel ${id}`)
      return cancel(id, ...rest)
    })
    await handleSubscriptionCreated(created("active"))
    expect(order).toEqual([`retrieve ${SECOND}`, `retrieve ${FIRST}`, `cancel ${SECOND}`])
  })

  it("a failure reading the kept one is retried with the event, nothing cancelled", async () => {
    const retrieve = state.stripe.subscriptions.retrieve.getMockImplementation()!
    state.stripe.subscriptions.retrieve.mockImplementation(async (id: string, ...rest: unknown[]) => {
      if (id === FIRST) throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" })
      return retrieve(id, ...rest)
    })
    await expect(handleSubscriptionCreated(created("active"))).rejects.toBeInstanceOf(StripeEventRetryError)
    for (const write of stripeWrites()) expect(write).not.toHaveBeenCalled()
  })
})

describe("only the production deployment settles", () => {
  /** Refused, with nothing at Stripe, its row left as recorded and nobody told. */
  async function expectLeftToProduction() {
    const before = { ...profile() }
    await expect(handleSubscriptionCreated(created("active"))).resolves.toBeUndefined()
    await expect(handleSubscriptionUpdated(updated("active"))).resolves.toBeUndefined()
    expectNothingGranted(before)
    for (const call of stripeCalls()) expect(call).not.toHaveBeenCalled()
    expect(state.notifySecondSubscription).not.toHaveBeenCalled()
    expect(statusWrites()).toEqual([])
    expect(rowOf(SECOND)).toMatchObject({ status: "incomplete", plan_granted: false })
  }

  it("another deployment named explicitly: the event is acknowledged, nothing granted, no Stripe call, no alert", async () => {
    vi.stubEnv("RUNTIME_ENV", "staging")
    await expectLeftToProduction()
  })

  it("another deployment by its platform environment name", async () => {
    vi.stubEnv("RUNTIME_ENV", "")
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging")
    await expectLeftToProduction()
  })

  it("a deployment that says nothing about itself does not act", async () => {
    vi.stubEnv("RUNTIME_ENV", "")
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "")
    expect(secondSubscription.settlesSecondSubscriptions()).toBe(false)
    await expectLeftToProduction()
  })

  it("production by its platform environment name acts", async () => {
    vi.stubEnv("RUNTIME_ENV", "")
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production")
    expect(secondSubscription.settlesSecondSubscriptions()).toBe(true)
    await handleSubscriptionCreated(created("active"))
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(state.stripe.refunds.create).toHaveBeenCalledTimes(1)
  })

  it("an explicit name wins over the platform's", async () => {
    vi.stubEnv("RUNTIME_ENV", "staging")
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production")
    await expectLeftToProduction()
  })

  it("a second subscription recorded unpaid is not claimed there either, and its row is left for production", async () => {
    vi.stubEnv("RUNTIME_ENV", "staging")
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW, SECOND_UNPAID_ROW])
    await handleSubscriptionUpdated(updated("active"))
    await handleSubscriptionCreated(created("active"))
    expect(planGrants()).toHaveLength(0)
    expect(rowOf(SECOND)).toMatchObject({ status: "incomplete", plan_granted: false })
    for (const call of stripeCalls()) expect(call).not.toHaveBeenCalled()
    expect(state.notifySecondSubscription).not.toHaveBeenCalled()

    // Production's own delivery then settles it.
    vi.stubEnv("RUNTIME_ENV", "production")
    await handleSubscriptionUpdated(updated("active"))
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(rowOf(SECOND)).toMatchObject({ status: "canceled", plan_granted: false })
  })
})

describe("a refund that cannot be made", () => {
  const refused = (code: string) => Object.assign(new Error(`refused: ${code}`), { type: "StripeInvalidRequestError", code })

  it("refused for good (a disputed charge): the event is acknowledged and a person is told to refund by hand", async () => {
    state.stripe.refunds.create.mockRejectedValue(refused("charge_disputed"))
    await expect(handleSubscriptionCreated(created("active"))).resolves.toBeUndefined()
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(rowOf(SECOND)).toMatchObject({ status: "canceled", plan_granted: false })
    expect(alerts()).toEqual([["cancel-and-refund", expect.stringMatching(/charge_disputed.*refund by hand/)]])
    expect(planGrants()).toHaveLength(0)
  })

  it("is told every time it happens, not only by the delivery that cancelled", async () => {
    state.stripe.refunds.create.mockRejectedValue(refused("refund_disputed_payment"))
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionUpdated(updated("active"))
    expect(state.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1)
    expect(alerts()).toEqual([
      ["cancel-and-refund", expect.stringContaining("refund by hand")],
      ["cancel-and-refund", expect.stringContaining("refund by hand")],
    ])
  })

  it("already refunded is done, not a person's", async () => {
    state.stripe.refunds.create.mockRejectedValue(refused("charge_already_refunded"))
    await handleSubscriptionCreated(created("active"))
    expect(alerts()).toEqual([["cancel-and-refund", undefined]])
  })

  it.each(["StripeConnectionError", "StripeAPIError", "StripeRateLimitError"])("a %s is retried with the event", async (type) => {
    state.stripe.refunds.create.mockRejectedValue(Object.assign(new Error("try again"), { type }))
    await expect(handleSubscriptionCreated(created("active"))).rejects.toBeInstanceOf(StripeEventRetryError)
  })

  it("a paid first invoice whose payments come back empty is not settled: retried, and it is said", async () => {
    state.invoicePayments = []
    await expect(handleSubscriptionCreated(created("active"))).rejects.toBeInstanceOf(StripeEventRetryError)
    expect(state.stripe.refunds.create).not.toHaveBeenCalled()
    expect(alerts()).toEqual([["cancel-and-refund", expect.stringContaining("not refunded")]])
    // The same delivery again, by this process: retried again, said once.
    await expect(handleSubscriptionCreated(created("active"))).rejects.toBeInstanceOf(StripeEventRetryError)
    expect(state.notifySecondSubscription).toHaveBeenCalledTimes(1)
  })

  it("more paid payments than were read: those read are refunded, and it is retried", async () => {
    state.stripe.invoicePayments.list.mockImplementation(async () => ({ object: "list", data: state.invoicePayments, has_more: true }))
    await expect(handleSubscriptionCreated(created("active"))).rejects.toBeInstanceOf(StripeEventRetryError)
    expect(state.stripe.refunds.create.mock.calls.map((c) => c[1])).toEqual([refundKey])
    expect(alerts()).toEqual([["cancel-and-refund", expect.stringContaining("not refunded")]])
  })
})

describe("the alert does not depend on who cancelled", () => {
  it("cancelled by another delivery that never got to say so: this one refunds and tells", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { status: "canceled" }))
    await handleSubscriptionCreated(created("active"))
    expect(state.stripe.subscriptions.cancel).not.toHaveBeenCalled()
    expect(state.stripe.refunds.create).toHaveBeenCalledTimes(1)
    expect(rowOf(SECOND)).toMatchObject({ status: "canceled", plan_granted: false })
    expect(alerts()).toEqual([["cancel-and-refund", undefined]])
  })
})

describe("the alert is repeated only when it was sent", () => {
  it("a message that could not be posted is sent again by the next event", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, "price_not_a_plan"))
    state.notifySecondSubscription.mockResolvedValueOnce(false)
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionCreated(created("active"))
    // The first was not posted; the second was, and the third is not repeated.
    expect(state.notifySecondSubscription).toHaveBeenCalledTimes(2)
  })

  it("a notifier that throws does not break the event and is tried again", async () => {
    state.stripeSubs.set(SECOND, soldSub(SECOND, "price_not_a_plan"))
    state.notifySecondSubscription.mockRejectedValueOnce(new Error("slack down"))
    await expect(handleSubscriptionCreated(created("active"))).resolves.toBeUndefined()
    await handleSubscriptionCreated(created("active"))
    expect(state.notifySecondSubscription).toHaveBeenCalledTimes(2)
  })
})

describe("an ended, never granted subscription with a paid event while another is live", () => {
  // As it is today: it is taken for a refused second subscription and settled
  // again, within the same seven days as any other (an older one is only
  // reported: see the seven-day cases). Pinned so that a change is deliberate.
  it("cancelled by someone else, created within the last seven days, its paid update: not cancelled again, the kept one not read, its first invoice refunded, told once, nothing granted", async () => {
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW, { ...SECOND_UNPAID_ROW, status: "canceled" }])
    state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { status: "canceled", created: Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60 }))
    const before = { ...profile() }
    await handleSubscriptionUpdated(updated("active"))

    expectNothingGranted(before)
    expect(state.stripe.subscriptions.retrieve.mock.calls).toEqual([[SECOND, { expand: ["latest_invoice"] }]])
    expect(state.stripe.subscriptions.cancel).not.toHaveBeenCalled()
    expect(state.stripe.refunds.create.mock.calls).toEqual([[
      { payment_intent: "pi_second", amount: 1900, reason: "duplicate", metadata: { reason: "second_subscription", subscription: SECOND } },
      refundKey,
    ]])
    expect(rowOf(SECOND)).toMatchObject({ status: "canceled", plan_granted: false })
    expect(state.writes.filter((w) => w.table === "subscriptions" && (w.update as Row | undefined)?.status)).toEqual([])
    expect(alerts()).toEqual([["cancel-and-refund", undefined]])
  })

  it("its created event the same; with no other live subscription, or an event that is not a paid one, nothing happens", async () => {
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW, { ...SECOND_UNPAID_ROW, status: "incomplete_expired" }])
    state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { status: "incomplete_expired" }))
    await handleSubscriptionUpdated(updated("past_due"))
    for (const call of stripeCalls()) expect(call).not.toHaveBeenCalled()

    await handleSubscriptionCreated(created("trialing"))
    expect(state.stripe.refunds.create).toHaveBeenCalledTimes(1)
    expect(planGrants()).toHaveLength(0)
  })
})

describe("when the refused subscription's row is written as ended", () => {
  const ENDED = { status: "canceled", plan_granted: false }
  const AS_RECORDED = { status: "incomplete", plan_granted: false }

  it("cancelled and refunded: written `canceled` and never granted, and only after Stripe confirmed the cancel", async () => {
    const seen: string[] = []
    state.stripe.subscriptions.cancel.mockImplementationOnce(async (id: string) => {
      seen.push(`cancel asked: row ${rowOf(SECOND)?.status}, ${statusWrites().length} status writes`)
      state.stripeSubs.set(id, { ...state.stripeSubs.get(id)!, status: "canceled" })
      return { id, status: "canceled" }
    })
    await handleSubscriptionCreated(created("active"))
    expect(seen).toEqual(["cancel asked: row incomplete, 0 status writes"])
    expect(rowOf(SECOND)).toMatchObject(ENDED)
    expect(statusWrites()).toEqual([{ table: "subscriptions", update: expect.objectContaining({ status: "canceled" }) }])
  })

  it("a cancel Stripe did not confirm writes nothing: the row stays as recorded", async () => {
    state.stripe.subscriptions.cancel.mockRejectedValue(new Error("connection reset"))
    await expect(handleSubscriptionUpdated(updated("active"))).rejects.toBeInstanceOf(StripeEventRetryError)
    expect(rowOf(SECOND)).toMatchObject(AS_RECORDED)
    expect(statusWrites()).toEqual([])
  })

  const DAY = 24 * 60 * 60
  it.each([
    ["older than seven days", () => state.stripeSubs.set(SECOND, soldSub(SECOND, BASIC, { created: Math.floor(Date.now() / 1000) - 8 * DAY }))],
    ["not sold by the checkout", () => state.stripeSubs.set(SECOND, soldSub(SECOND, "price_not_a_plan"))],
    ["on a deployment that does not settle", () => vi.stubEnv("RUNTIME_ENV", "staging")],
  ])("only reported, %s: nothing cancelled, the row left `incomplete` and never granted, by either event", async (_why, arrange) => {
    arrange()
    await handleSubscriptionCreated(created("active"))
    expect(rowOf(SECOND)).toMatchObject(AS_RECORDED)
    await handleSubscriptionUpdated(updated("active"))
    await handleSubscriptionCreated(created("active"))
    expect(rowOf(SECOND)).toMatchObject(AS_RECORDED)
    expect(statusWrites()).toEqual([])
    for (const write of stripeWrites()) expect(write).not.toHaveBeenCalled()
    expect(planGrants()).toHaveLength(0)
  })
})

describe("the refused subscription's row", () => {
  it("takes the plan's price, tier and period from Stripe, and is never marked granted", async () => {
    await handleSubscriptionCreated(created("active"))
    expect(rowOf(SECOND)).toMatchObject({
      user_id: USER, stripe_subscription_id: SECOND, stripe_price_id: BASIC, tier: "basic", status: "canceled", plan_granted: false,
      current_period_start: "2026-11-01T00:00:00.000Z", current_period_end: "2026-12-01T00:00:00.000Z",
    })
  })

  it("its own cancellation event ending the row first is not a failure: no retry, no false alert, refunded", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    // Stripe's `deleted` event for our cancel lands between the row's read and its write.
    state.interleave = {
      when: (w) => (w.update as Row | undefined)?.status === "canceled",
      run: () => handleSubscriptionCanceled(deleted(SECOND)),
    }
    await expect(handleSubscriptionUpdated(updated("active"))).resolves.toBeUndefined()
    expect(rowOf(SECOND)).toMatchObject({ status: "canceled", plan_granted: false })
    expect(state.stripe.refunds.create).toHaveBeenCalledTimes(1)
    expect(alerts()).toEqual([["cancel-and-refund", undefined]])
    expect(profile()).toEqual(GRANTED_PRO)
  })

  it("a row that turned out granted meanwhile is not ended and not refunded: a person is told", async () => {
    state.stripe.subscriptions.cancel.mockImplementationOnce(async (id: string) => {
      state.stripeSubs.set(id, { ...state.stripeSubs.get(id)!, status: "canceled" })
      state.db.tables.subscriptions = (state.db.tables.subscriptions as Row[]).map((r) => (r.stripe_subscription_id === SECOND ? { ...r, plan_granted: true } : r))
      return { id, status: "canceled" }
    })
    await expect(handleSubscriptionCreated(created("active"))).resolves.toBeUndefined()
    expect(rowOf(SECOND)).toMatchObject({ status: "incomplete", plan_granted: true })
    expect(state.stripe.refunds.create).not.toHaveBeenCalled()
    expect(alerts()).toEqual([["cancel-and-refund", expect.stringContaining("by hand")]])
  })
})

describe("a plan-change invoice", () => {
  const planChangePaid = (subscriptionId: string) => ({
    invoiceId: `in_change_${subscriptionId}`, subscriptionId, stripeCustomerId: "cus_second_1", amountPaid: 1850, metadata: null,
    billingReason: "subscription_update",
    lines: [{ priceId: BASIC, amount: -650 }, { priceId: PRO, amount: 2500 }],
  })
  const planChangeGrants = () => state.writes.filter((w) => w.rpc === "grant_plan_change_credits")

  it("on a second subscription only reported (its row still `incomplete`, never granted): no plan-change grant, nothing written", async () => {
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW, SECOND_UNPAID_ROW])
    const before = { ...profile() }
    await handleInvoicePaid(planChangePaid(SECOND))
    expect(planChangeGrants()).toEqual([])
    expectNothingGranted(before)
    expect(rowOf(SECOND)).toMatchObject({ status: "incomplete", plan_granted: false })
  })

  it("on a refused one recorded as ended and never granted: no plan-change grant, nothing written", async () => {
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW, { ...SECOND_UNPAID_ROW, status: "canceled" }])
    const before = { ...profile() }
    await handleInvoicePaid(planChangePaid(SECOND))
    expect(planChangeGrants()).toEqual([])
    expectNothingGranted(before)
  })

  it("on the granted subscription: granted as before, and the account's other subscriptions are not read", async () => {
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW, SECOND_UNPAID_ROW])
    const otherReads: string[] = []
    state.refusals.push({
      when: (t, p) => {
        if (t === "subscriptions" && p === "neq") otherReads.push(p)
        return false
      },
      error: { code: "unused", message: "unused" },
    })
    await handleInvoicePaid(planChangePaid(FIRST))
    expect(planChangeGrants()).toHaveLength(1)
    expect(planChangeGrants()[0]!.args).toMatchObject({ p_user_id: USER, p_invoice_id: `in_change_${FIRST}` })
    expect(otherReads).toEqual([])
  })

  it("a database error deciding it asks for the event again, nothing granted", async () => {
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW, SECOND_UNPAID_ROW])
    state.refusals.push({ when: (t, p) => t === "subscriptions" && p === "neq", error: { code: "57014", message: "canceling statement due to statement timeout" } })
    await expect(handleInvoicePaid(planChangePaid(SECOND))).rejects.toBeInstanceOf(StripeEventRetryError)
    expect(planChangeGrants()).toEqual([])
  })
})

describe("the first invoice's receipt", () => {
  it("its first invoice paid before it was refused (still recorded unpaid) writes no receipt", async () => {
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW, SECOND_UNPAID_ROW])
    await handleInvoicePaid(firstInvoicePaid(SECOND))
    expect(receipts()).toEqual([])
  })

  it("its first invoice paid after it was refused writes no receipt, on any deployment", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionUpdated(updated("active"))
    vi.stubEnv("RUNTIME_ENV", "staging")
    await handleInvoicePaid(firstInvoicePaid(SECOND))
    vi.stubEnv("RUNTIME_ENV", "production")
    await handleInvoicePaid(firstInvoicePaid(SECOND))
    expect(receipts()).toEqual([])
  })

  it("an account's only subscription keeps its receipt, paid before or after its grant", async () => {
    state.db = migratedDb(FREE_PROFILE, [{ ...SECOND_UNPAID_ROW }])
    await handleInvoicePaid(firstInvoicePaid(SECOND))
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW])
    await handleInvoicePaid(firstInvoicePaid(FIRST))
    expect(receipts().map((w) => (w.upsert as Row).stripe_transaction_id)).toEqual([`in_${SECOND}`, `in_${FIRST}`])
  })

  it("a database error deciding it asks for the event again, nothing written", async () => {
    state.db = migratedDb(GRANTED_PRO, [FIRST_ROW, SECOND_UNPAID_ROW])
    state.refusals.push({ when: (t, p) => t === "subscriptions" && p === "neq", error: { code: "57014", message: "canceling statement due to statement timeout" } })
    await expect(handleInvoicePaid(firstInvoicePaid(SECOND))).rejects.toBeInstanceOf(StripeEventRetryError)
    expect(receipts()).toEqual([])
  })
})
