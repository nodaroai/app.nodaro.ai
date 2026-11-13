import type Stripe from "stripe"
import { gaVisitIdsOf } from "./visit-ids.js"

/**
 * Which Stripe events are a purchase for the site analytics, and what each one
 * says. Pure: no I/O.
 *
 * A purchase is money that SETTLED, read from the same events the grants are
 * made on (routes/stripe-webhook.ts) but independently of whether our grant
 * succeeded — the person paid either way:
 *
 * - a one-time Checkout (a credit pack, a credit load, an organization pack)
 *   once its payment is `paid`, for more than nothing;
 * - every paid subscription invoice (`invoice.paid`): the first payment, each
 *   renewal and each plan change. Never the subscription's Checkout, which
 *   would count the first payment twice;
 * - an auto-recharge charge (`payment_intent.succeeded`, kind `auto_recharge`).
 *
 * `transactionId` is the id the grant itself claims on (the payment intent of a
 * Checkout or an auto-recharge, the invoice of a subscription), so one payment
 * is one purchase whichever of its events arrives. Test-mode events are never
 * a purchase.
 */

export type PurchaseCategory = "credit_pack" | "credit_load" | "org_pack" | "subscription" | "auto_recharge" | "payment"

export interface PurchaseItem {
  readonly id: string
  readonly name: string
  readonly category: PurchaseCategory
  /** A subscription invoice's billing reason (first payment, renewal, plan change). */
  readonly variant?: string
}

export interface PurchaseFacts {
  readonly transactionId: string
  /** In the currency's smallest unit, as Stripe states it. */
  readonly amountMinor: number
  /** ISO 4217, upper case. */
  readonly currency: string
  readonly item: PurchaseItem
  /** The account's internal id, from the payment's metadata. */
  readonly userId: string | null
  /** The GA client id of the visit that started the checkout. */
  readonly gaClientId: string | null
  /** That visit's session id — only for a payment made during that visit. */
  readonly gaSessionId: string | null
}

const USER_ID = /^[A-Za-z0-9-]{1,64}$/
const ITEM_ID_MAX = 100

export function purchaseOfStripeEvent(event: Stripe.Event): PurchaseFacts | null {
  if (event.livemode === false) return null
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return fromCheckoutSession(event.data.object)
    case "invoice.paid":
      return fromInvoice(event.data.object)
    case "payment_intent.succeeded":
      return fromAutoRecharge(event.data.object)
    default:
      return null
  }
}

function fromCheckoutSession(session: Stripe.Checkout.Session): PurchaseFacts | null {
  // A subscription's Checkout is reported by its first invoice.
  if (session.mode !== "payment" || session.payment_status !== "paid") return null
  const amountMinor = session.amount_total ?? 0
  if (!(amountMinor > 0) || !session.currency) return null
  const metadata = session.metadata ?? {}
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id
  const visit = gaVisitIdsOf(metadata)
  return {
    transactionId: paymentIntent ?? session.id,
    amountMinor,
    currency: session.currency.toUpperCase(),
    item: checkoutItem(metadata),
    // An organization pack names its buyer as the actor.
    userId: userIdOf(metadata.userId ?? metadata.actorUserId),
    gaClientId: visit.clientId,
    gaSessionId: visit.sessionId,
  }
}

function checkoutItem(metadata: Readonly<Record<string, string>>): PurchaseItem {
  if (metadata.payerKind === "org") return { id: itemId(metadata.packId, "org-pack"), name: "Organization credit pack", category: "org_pack" }
  if (metadata.kind === "load") return { id: "credit-load", name: "Credit load", category: "credit_load" }
  if (metadata.topupPriceId) return { id: itemId(metadata.topupPriceId, "credit-pack"), name: "Credit pack", category: "credit_pack" }
  return { id: "payment", name: "Payment", category: "payment" }
}

function fromInvoice(invoice: Stripe.Invoice): PurchaseFacts | null {
  const subscription = invoice.parent?.subscription_details
  if (!subscription || !invoice.id) return null
  const amountMinor = invoice.amount_paid ?? 0
  if (!(amountMinor > 0) || !invoice.currency) return null
  const metadata = subscription.metadata ?? {}
  const visit = gaVisitIdsOf(metadata)
  const reason = invoice.billing_reason ?? undefined
  return {
    transactionId: invoice.id,
    amountMinor,
    currency: invoice.currency.toUpperCase(),
    item: { id: "subscription", name: "Subscription", category: "subscription", ...(reason ? { variant: reason } : {}) },
    userId: userIdOf(metadata.userId),
    gaClientId: visit.clientId,
    // Only the first payment is made during the visit that started the Checkout.
    gaSessionId: reason === "subscription_create" ? visit.sessionId : null,
  }
}

function fromAutoRecharge(intent: Stripe.PaymentIntent): PurchaseFacts | null {
  // Checkout-created intents are reported by their Checkout (above).
  if (intent.metadata?.kind !== "auto_recharge") return null
  const amountMinor = intent.amount_received ?? 0
  if (!(amountMinor > 0) || !intent.currency) return null
  return {
    transactionId: intent.id,
    amountMinor,
    currency: intent.currency.toUpperCase(),
    item: { id: "auto-recharge", name: "Credit auto-recharge", category: "auto_recharge" },
    userId: userIdOf(intent.metadata.userId),
    gaClientId: null,
    gaSessionId: null,
  }
}

function userIdOf(value: string | undefined): string | null {
  return typeof value === "string" && USER_ID.test(value) ? value : null
}

function itemId(value: string | undefined, fallback: string): string {
  return value ? value.slice(0, ITEM_ID_MAX) : fallback
}
