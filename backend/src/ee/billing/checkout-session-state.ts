/**
 * Where a Checkout session stands, read from the session as Stripe has it:
 * the rule both the status read and a replacing create's first read follow.
 * A replacing create has one more source of "under way" that the session
 * itself may not show: an expire Stripe refuses while the session still
 * reads open (`replace-checkout-session.ts`).
 */

import type Stripe from "stripe"

/** What the read expands: the payment of a pack or a load, the subscription of a plan. */
export const REPLACE_EXPAND = ["payment_intent", "subscription"] as const

/** A plan session's subscription in one of these has been paid for. */
export const SUBSCRIPTION_PAID: ReadonlySet<Stripe.Subscription.Status> = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
  "past_due",
  "unpaid",
])

/** A pack or load session's payment in one of these has been submitted. */
export const PAYMENT_UNDER_WAY: ReadonlySet<Stripe.PaymentIntent.Status> = new Set<Stripe.PaymentIntent.Status>([
  "processing",
  "requires_capture",
  "succeeded",
])

/**
 * Whether the session's payment has been submitted (a pack or a load) or its
 * subscription paid for (a plan). Reads the expanded objects; a bare id,
 * which the read never leaves unexpanded, reads as not under way.
 */
export function paymentUnderWay(session: Stripe.Checkout.Session): boolean {
  if (session.mode === "payment") {
    const intent = session.payment_intent
    return typeof intent === "object" && intent !== null && PAYMENT_UNDER_WAY.has(intent.status)
  }
  if (session.mode === "subscription") {
    const subscription = session.subscription
    return typeof subscription === "object" && subscription !== null && SUBSCRIPTION_PAID.has(subscription.status)
  }
  return false
}

export type CheckoutSessionState = "complete" | "expired" | "under-way" | "open"

/**
 * A session read with `REPLACE_EXPAND`, classified: `complete`; `expired`;
 * `under-way` when it is open and its payment submitted; else `open`.
 */
export function checkoutSessionState(session: Stripe.Checkout.Session): CheckoutSessionState {
  // Stripe's `null` status reads `open`.
  const status = session.status ?? "open"
  if (status === "complete") return "complete"
  if (status === "expired") return "expired"
  if (paymentUnderWay(session)) return "under-way"
  return "open"
}
