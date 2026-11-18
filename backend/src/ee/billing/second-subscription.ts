/**
 * One subscription per account, in the Stripe webhook.
 *
 * The checkout refuses a second subscription to an account that has one, but
 * a race can still get one through (two checkouts paid at once, a payment
 * finished after the account subscribed elsewhere). Its plan is then never
 * granted: no tier change, no plan credits, no move of the first plan's
 * credits into top-up, and nothing written to the account or to the first
 * subscription.
 *
 * Which one is "the second": the one whose plan-grant claim is refused
 * because another subscription of the account holds the plan
 * (`claim_subscription_grant` answers `other_live`, naming the one the account
 * keeps; subscription-grant.ts). The claim decides it under the account's
 * lock, so of two subscriptions paid at once exactly one is granted and the
 * other comes here; nothing is read beforehand to decide it. Stripe's
 * creation order is not read: the one already granted may be what the person
 * is spending.
 *
 * What is done with it, beyond granting it nothing:
 *  - "cancel-and-refund" (SECOND_SUBSCRIPTION_ACTION), only when all of these
 *    hold. It is one the checkout sold: a plan's price, and the account's own
 *    stamp in its metadata. Its latest invoice is still its first one, and
 *    Stripe created it within the last seven days
 *    (SECOND_SUBSCRIPTION_MAX_AGE_SECONDS): a fresh mistake, not an old
 *    duplicate. And, before it is cancelled, the subscription the account
 *    keeps is live at Stripe too.
 *    Then: cancelled at Stripe at once (no proration, no final invoice),
 *    recorded here as ended and never granted, and every paid payment of its
 *    first invoice refunded in full (reason `duplicate`). The cancel comes
 *    first: it stops any further charge, and a cancelled subscription can
 *    still be read, so a retry after a failed refund finds the invoice and
 *    refunds it. A cancel takes no idempotency key (Stripe ignores one on a
 *    DELETE): it is made only for a subscription Stripe says is not cancelled
 *    yet, and one that fails is read again. Each refund carries a key derived
 *    from its payment, and an already refunded charge counts as done.
 *  - "alert": any other second subscription. Nothing is cancelled, refunded
 *    or written: its row stays as it was recorded (`incomplete`, never
 *    granted), and a person is told.
 *
 * The recorded row (`canceled`, `plan_granted = false`) is what keeps a
 * settled one from ever being granted: an ended row is never claimed, a late
 * event never moves an ended status, and nothing inserts over a recorded
 * subscription. It is written only once Stripe has the subscription
 * cancelled: a cancel Stripe did not confirm writes nothing, and the row
 * stays `incomplete`. Two other writers upsert a row as `active` (credits.ts's
 * period self-heal, the admin subscription sync), but only for a subscription
 * Stripe lists as active, so neither can bring an ended row back. (A second
 * subscription that is refused but still active at Stripe, an "alert" one,
 * keeps its `incomplete` row, and those two writers can still move it.)
 *
 * A settlement that failed is tried again by the event's redelivery. While
 * the row is still `incomplete`, the redelivery claims again, is refused
 * again and comes here. Once the row is recorded ended it is no longer
 * claimed (the claim answers `not_claimable`), so a paid event that finds
 * such a row, while another subscription holds the account's plan, settles it
 * again (settleRefusedAgain): that is how a refund that failed is retried.
 *
 * Only the production deployment settles (settlesSecondSubscriptions): any
 * other deployment hearing the same events refuses the grant the same way and
 * does nothing else.
 *
 * Telling the founders' channel: by the delivery that reaches an end (done,
 * or left to a person), and by one that fails, saying what is left. The same
 * message for the same subscription is sent once per process (one that could
 * not be posted is sent again by the next event); a refund Stripe refused for
 * good is said every time. A failure Stripe may recover from
 * throws StripeEventRetryError with nothing granted, so Stripe delivers the
 * event again and the settlement is retried.
 */

import type Stripe from "stripe"
import { supabase } from "../../lib/supabase.js"
import { getRuntimeEnv, PRODUCTION_RUNTIME_ENV } from "../../lib/runtime-env.js"
import { getStripe } from "./stripe-client.js"
import { LIVE_SUBSCRIPTION_STATUSES, readLiveOrClaimedSubscriptions } from "./downgrade-floor.js"
import { PRICE_TO_PLAN, getTierFromPriceId } from "./stripe-config.js"
import { ENDED_STATUS_LIST, GRANTING_STATUSES, isEndedStatus, planGranted, readSubscriptionRow, type GrantMarker } from "./subscription-grant.js"
import { StripeEventRetryError } from "./stripe-event-retry.js"
import { notifySecondSubscription } from "../notifications/founder-notify.js"

export type SecondSubscriptionAction = "alert" | "cancel-and-refund"

export const SECOND_SUBSCRIPTION_ACTION: SecondSubscriptionAction = "cancel-and-refund"

/** Stripe statuses a subscription never leaves: nothing more to cancel. */
const TERMINAL_STRIPE_STATUSES: ReadonlySet<string> = new Set(["canceled", "incomplete_expired"])

/**
 * How long after Stripe created it a second subscription is still cancelled
 * and refunded here. An older one is only reported.
 */
export const SECOND_SUBSCRIPTION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

/** The `billing_reason` of a subscription's first invoice. */
const FIRST_INVOICE_REASON = "subscription_create"

/**
 * Whether this deployment cancels, refunds and tells. Only the one whose
 * runtime environment is named `production` (lib/runtime-env.ts: `RUNTIME_ENV`
 * when set, else the platform's own environment name). A deployment that
 * names no environment does not act.
 */
export function settlesSecondSubscriptions(): boolean {
  return getRuntimeEnv() === PRODUCTION_RUNTIME_ENV
}

/**
 * The `stripe_subscription_id` of another subscription that holds this
 * account's plan (a live status, or a claimed grant on one that has not
 * ended), else null. Never read to decide a grant, which the claim alone
 * does: only for a subscription already refused, whose row no longer claims.
 * A database error throws StripeEventRetryError before anything is written.
 */
async function planHolderBesides(userId: string, subscriptionId: string): Promise<string | null> {
  const { data, error } = await readLiveOrClaimedSubscriptions<{ stripe_subscription_id?: string | null }>("stripe_subscription_id", (q) =>
    q.eq("user_id", userId).neq("stripe_subscription_id", subscriptionId),
  )
  if (error) {
    throw new StripeEventRetryError(`reading the live subscriptions of ${userId} failed: ${error.message}`)
  }
  return data.find((r) => typeof r.stripe_subscription_id === "string")?.stripe_subscription_id ?? null
}

/**
 * For a subscription whose plan-grant claim was just refused (`other_live`):
 * `keptId` is the subscription the claim named, the one the account keeps.
 * Nothing was granted and the caller grants nothing. On the production
 * deployment it is also settled (see the header); any other deployment only
 * logs. A failure Stripe may recover from (or any unexpected one) throws
 * StripeEventRetryError.
 */
export async function settleSecondSubscription(userId: string, subscriptionId: string, keptId: string, event: string): Promise<void> {
  if (!settlesSecondSubscriptions()) {
    console.error(
      `[stripe] ${event}: SECOND SUBSCRIPTION: user=${userId} keeps ${keptId}; ${subscriptionId} is granted nothing (left to the production deployment, this one is "${getRuntimeEnv()}")`,
    )
    return
  }

  console.error(`[stripe] ${event}: SECOND SUBSCRIPTION: user=${userId} keeps ${keptId}; ${subscriptionId} is granted nothing`)
  const settlement: Settlement = { userId, keptId, secondId: subscriptionId, left: "nothing done at Stripe yet" }
  try {
    await settle(settlement)
  } catch (err) {
    console.error(`[stripe] ${event}: SECOND SUBSCRIPTION ${subscriptionId} not settled (${settlement.left}), asking for the event again:`, (err as Error).message)
    tell(settlement, SECOND_SUBSCRIPTION_ACTION, `not settled yet: ${settlement.left}; retried with the event`)
    if (err instanceof StripeEventRetryError) throw err
    throw new StripeEventRetryError(`settling the second subscription ${subscriptionId} failed: ${(err as Error).message}`)
  }
}

/**
 * For a paid event of a subscription whose stored row has ended and was never
 * granted: when another subscription holds the account's plan, it is a
 * refused one (or would have been) and is settled again, so a refund that
 * failed after its cancel is retried. The same rules decide it, the seven
 * days included: an older one is only reported. Nothing is granted either
 * way. True when it was one; false, with nothing read, for any other row or
 * event.
 */
export async function settleRefusedAgain(
  userId: string,
  subscriptionId: string,
  event: string,
  stored: GrantMarker & { readonly status: string },
  eventStatus: string,
): Promise<boolean> {
  if (planGranted(stored) || !isEndedStatus(stored.status) || !GRANTING_STATUSES.has(eventStatus)) return false
  const keptId = await planHolderBesides(userId, subscriptionId)
  if (!keptId) return false
  await settleSecondSubscription(userId, subscriptionId, keptId, event)
  return true
}

/**
 * Whether a paid invoice (its first one, or a plan change's) is a refused
 * second subscription's, which gets no receipt and no plan-change credits:
 * its plan was never granted. True for a stored row never granted that has
 * ended, or while another subscription holds the account's plan (the invoice
 * arrived before the refusal, or the refused row was left as recorded). A
 * granted row answers false after its one read. A database error on the
 * second read throws StripeEventRetryError.
 */
export async function refusedSubscriptionInvoice(userId: string, subscriptionId: string, invoiceId: string): Promise<boolean> {
  const row = await readSubscriptionRow<{ status: string }>(subscriptionId, "status")
  if (!row || planGranted(row)) return false
  if (!isEndedStatus(row.status) && !(await planHolderBesides(userId, subscriptionId))) return false
  console.log(`[stripe] invoice.paid: invoice=${invoiceId} is of ${subscriptionId}, a second subscription granted nothing: no receipt, no credits`)
  return true
}

// ── Telling ──────────────────────────────────────────────────────

interface Settlement {
  readonly userId: string
  readonly keptId: string
  readonly secondId: string
  /** What is still to do, for the message of a delivery that fails. */
  left: string
}

/** The messages this process already sent, so the same one is not repeated on every event. */
const told = new Set<string>()

/** Forget what was told (tests). */
export function forgetSecondSubscriptionAlerts(): void {
  told.clear()
}

function tell(s: Settlement, action: SecondSubscriptionAction, note?: string, everyTime = false): void {
  const key = `${s.secondId}|${action}|${note ?? ""}`
  if (!everyTime && told.has(key)) return
  // Marked at once, so events handled together do not all send it; unmarked
  // when it was not posted, so the next event sends it.
  told.add(key)
  const posting = note === undefined
    ? notifySecondSubscription(s.userId, s.keptId, s.secondId, action)
    : notifySecondSubscription(s.userId, s.keptId, s.secondId, action, note)
  void posting.then((posted) => posted, () => false).then((posted) => {
    if (!posted) told.delete(key)
  })
}

// ── Settling ─────────────────────────────────────────────────────

async function settle(s: Settlement): Promise<void> {
  const stripe = getStripe()
  const sub = await stripe.subscriptions.retrieve(s.secondId, { expand: ["latest_invoice"] })

  const reportOnly = (why: string) => {
    console.error(`[stripe] SECOND SUBSCRIPTION ${s.secondId}: ${why}`)
    tell(s, "alert", why)
  }

  if (!soldByCheckout(sub, s.userId)) {
    return reportOnly("not sold by the checkout (its price or its account stamp): nothing cancelled or refunded, settle it by hand")
  }
  const invoice = await firstInvoiceOf(stripe, sub, s.secondId)
  if (invoice === null) {
    return reportOnly("its latest invoice is not its first invoice: nothing cancelled or refunded, settle it by hand")
  }

  if (!createdRecently(sub)) {
    return reportOnly("created more than 7 days ago: nothing cancelled or refunded, settle it by hand")
  }

  if (!TERMINAL_STRIPE_STATUSES.has(sub.status)) {
    const keptStatus = await stripeStatusOf(stripe, s.keptId)
    if (keptStatus === null || !LIVE_SUBSCRIPTION_STATUSES.includes(keptStatus)) {
      return reportOnly(`the kept subscription is ${keptStatus ?? "unknown"} at Stripe: nothing cancelled or refunded, settle it by hand`)
    }
    s.left = "not cancelled"
    await cancelNow(stripe, s.secondId)
  }

  s.left = "cancelled, but not recorded as ended and its first invoice not refunded"
  if (!(await recordRefused(s.userId, sub))) {
    console.error(`[stripe] SECOND SUBSCRIPTION ${s.secondId}: cancelled at Stripe, but its row here says its plan was granted; nothing refunded`)
    return tell(s, SECOND_SUBSCRIPTION_ACTION, "cancelled, but it is recorded here as granted: nothing refunded, check the account and refund by hand", true)
  }

  s.left = "cancelled, its first invoice not refunded"
  const refund = await refundInvoice(stripe, invoice, s.secondId)
  if (refund.short) {
    throw new Error(`invoice ${invoice.id} is paid, but its paid payments could not all be read`)
  }

  if (refund.refused.length > 0) {
    return tell(s, SECOND_SUBSCRIPTION_ACTION, `${refund.refused.length} payment(s) of its first invoice Stripe would not refund (${refund.refused.join(", ")}): refund by hand`, true)
  }
  if (refund.unrefundable > 0) {
    return tell(s, SECOND_SUBSCRIPTION_ACTION, `${refund.unrefundable} paid payment(s) of its first invoice could not be refunded here: refund by hand`)
  }
  // A payment still settling (a bank debit) is not refundable yet, and its
  // later payment finds nothing here to refund it: a person does.
  if (unsettled(invoice)) {
    return tell(s, SECOND_SUBSCRIPTION_ACTION, "its first invoice is not settled yet: refund it by hand if it is paid")
  }
  tell(s, SECOND_SUBSCRIPTION_ACTION)
}

/**
 * One the checkout sold to this account: every price a plan's, and the
 * checkout's stamp of the account in its metadata. Read from Stripe's own
 * copy of the subscription, never from the event.
 */
function soldByCheckout(sub: Stripe.Subscription, userId: string): boolean {
  const prices = (sub.items?.data ?? []).map((item) => item.price?.id)
  if (prices.length === 0) return false
  if (!prices.every((id) => typeof id === "string" && Object.prototype.hasOwnProperty.call(PRICE_TO_PLAN, id))) return false
  return sub.metadata?.userId === userId
}

/** Created at Stripe no longer ago than the bound. No creation time reads as too old. */
function createdRecently(sub: Stripe.Subscription): boolean {
  if (typeof sub.created !== "number") return false
  return Date.now() / 1000 - sub.created <= SECOND_SUBSCRIPTION_MAX_AGE_SECONDS
}

/** A subscription's status at Stripe; null when Stripe has no such subscription. */
async function stripeStatusOf(stripe: Stripe, subscriptionId: string): Promise<string | null> {
  try {
    return (await stripe.subscriptions.retrieve(subscriptionId)).status
  } catch (err) {
    if ((err as { code?: string }).code === "resource_missing") return null
    throw err
  }
}

/** An invoice that still has something to collect: not paid, not voided, an amount remaining. */
function unsettled(invoice: Stripe.Invoice): boolean {
  if (invoice.status === "paid" || invoice.status === "void") return false
  return (invoice.amount_remaining ?? 0) > 0
}

/**
 * Cancel now. Returns only once Stripe says the subscription is cancelled:
 * by the cancel's own answer, or, when the cancel failed or answered anything
 * else, by reading it again. Otherwise it throws, and nothing is recorded.
 */
async function cancelNow(stripe: Stripe, secondId: string): Promise<void> {
  let failure: unknown = null
  try {
    const cancelled = await stripe.subscriptions.cancel(secondId, { prorate: false, invoice_now: false })
    if (cancelled?.status === "canceled") return
  } catch (err) {
    failure = err
  }
  const again = await stripe.subscriptions.retrieve(secondId)
  if (again.status === "canceled") return
  throw failure ?? new Error(`Stripe did not confirm the cancel of ${secondId}: it is ${again.status}`)
}

/**
 * Record the cancelled subscription as ended and never granted. Called only
 * once Stripe has it cancelled. A row recorded unpaid is ended; a row already
 * ended is left; with no row (a database where the refusal came from the
 * one-active index, before the row was recorded), one is inserted, always
 * naming `plan_granted: false` (a row without the marker reads as granted,
 * and its cancellation would end the account's plan).
 * False when its row says the plan was granted: that row is left alone. A
 * write that fails throws StripeEventRetryError.
 */
async function recordRefused(userId: string, sub: Stripe.Subscription): Promise<boolean> {
  const row = await readSubscriptionRow<{ status: string }>(sub.id, "status")
  const now = new Date().toISOString()
  if (row) {
    if (planGranted(row)) return false
    if (isEndedStatus(row.status)) return true
    const { data, error } = await supabase
      .from("subscriptions")
      .update({ status: "canceled", canceled_at: now, updated_at: now })
      .eq("stripe_subscription_id", sub.id)
      .eq("plan_granted", false)
      .not("status", "in", ENDED_STATUS_LIST)
      .select("id")
    if (error) throw new StripeEventRetryError(`recording the second subscription ${sub.id} as ended failed: ${error.message}`)
    if (Array.isArray(data) && data.length > 0) return true
    // It moved between the read and the write. Ended meanwhile and still
    // never granted (the cancellation's own event got there first) is done.
    const moved = await readSubscriptionRow<{ status: string }>(sub.id, "status")
    if (moved && !planGranted(moved) && isEndedStatus(moved.status)) return true
    throw new StripeEventRetryError(`recording the second subscription ${sub.id} as ended matched no row: it moved meanwhile`)
  }

  const item = sub.items?.data?.[0]
  const priceId = item?.price?.id ?? ""
  const { error } = await supabase.from("subscriptions").insert({
    user_id: userId,
    stripe_subscription_id: sub.id,
    stripe_price_id: priceId,
    tier: getTierFromPriceId(priceId),
    status: "canceled",
    current_period_start: isoOf(item?.current_period_start),
    current_period_end: isoOf(item?.current_period_end),
    canceled_at: now,
    plan_granted: false,
  })
  if (error) throw new StripeEventRetryError(`recording the second subscription ${sub.id} as ended failed: ${error.message}`)
  return true
}

function isoOf(seconds: number | null | undefined): string | null {
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null
}

/**
 * The subscription's latest invoice when it is its first one (made by its
 * creation, and its own); null otherwise, so an invoice of another
 * subscription, or a later one, is never refunded. No invoice at all: null.
 */
async function firstInvoiceOf(stripe: Stripe, sub: Stripe.Subscription, secondId: string): Promise<Stripe.Invoice | null> {
  const latest = sub.latest_invoice
  if (!latest) return null
  const invoice = typeof latest === "string" ? await stripe.invoices.retrieve(latest) : latest
  const owner = invoice.parent?.subscription_details?.subscription
  const ownerId = typeof owner === "string" ? owner : owner?.id
  if (ownerId !== secondId || invoice.billing_reason !== FIRST_INVOICE_REASON) {
    console.error(
      `[stripe] SECOND SUBSCRIPTION ${secondId}: latest invoice ${invoice.id} is not its first (reason=${invoice.billing_reason ?? "none"})`,
    )
    return null
  }
  return invoice
}

interface RefundOutcome {
  /** Paid payments the refunds API cannot refund (a payment record). */
  readonly unrefundable: number
  /** The codes of the refunds Stripe refused for good. */
  readonly refused: readonly string[]
  /** The invoice is paid, yet its paid payments were not all read. */
  readonly short: boolean
}

/**
 * Refund every paid payment of the invoice in full, each keyed by its
 * payment. Nothing paid is nothing to refund. An already refunded charge is
 * done. A refund Stripe refuses as an invalid request (a disputed charge, one
 * partly refunded by hand) will be refused again: it is counted for a person
 * and not retried. Any other failure throws, and is retried with the event.
 */
async function refundInvoice(stripe: Stripe, invoice: Stripe.Invoice, secondId: string): Promise<RefundOutcome> {
  const payments = await stripe.invoicePayments.list({ invoice: invoice.id!, status: "paid", limit: 100 })
  const short = (invoice.amount_paid ?? 0) > 0 && (payments.data.length === 0 || payments.has_more)
  if (short) {
    console.error(`[stripe] SECOND SUBSCRIPTION ${secondId}: invoice ${invoice.id} is paid, but ${payments.has_more ? "has more paid payments than were read" : "lists no paid payment"}`)
  }
  let unrefundable = 0
  const refused: string[] = []
  for (const payment of payments.data) {
    const target = refundTarget(payment)
    if (!target) {
      unrefundable += 1
      console.error(`[stripe] SECOND SUBSCRIPTION ${secondId}: payment ${payment.id} (${payment.payment.type}) cannot be refunded here, refund it by hand`)
      continue
    }
    const amount = typeof payment.amount_paid === "number" && payment.amount_paid > 0 ? { amount: payment.amount_paid } : {}
    try {
      await stripe.refunds.create(
        { ...target.params, ...amount, reason: "duplicate", metadata: { reason: "second_subscription", subscription: secondId } },
        { idempotencyKey: `second-subscription-refund:${target.id}` },
      )
    } catch (err) {
      const { type, code } = err as { type?: string; code?: string }
      if (code === "charge_already_refunded") continue
      if (type !== "StripeInvalidRequestError") throw err
      refused.push(code ?? "invalid_request")
      console.error(`[stripe] SECOND SUBSCRIPTION ${secondId}: Stripe would not refund ${target.id} (${code ?? "invalid_request"}), refund it by hand:`, (err as Error).message)
    }
  }
  return { unrefundable, refused, short }
}

function refundTarget(payment: Stripe.InvoicePayment): { id: string; params: { payment_intent: string } | { charge: string } } | null {
  const idOf = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : value?.id ?? null)
  const intent = payment.payment.type === "payment_intent" ? idOf(payment.payment.payment_intent) : null
  if (intent) return { id: intent, params: { payment_intent: intent } }
  const charge = payment.payment.type === "charge" ? idOf(payment.payment.charge) : null
  if (charge) return { id: charge, params: { charge } }
  return null
}
