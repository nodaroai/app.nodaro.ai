/**
 * Whether a signed-in person's own Checkout session's purchase has been granted.
 *
 * An embedded Checkout never leaves the app's page, so the page asks here once
 * Stripe's form says it is done: the session's status as Stripe has it, and
 * whether the platform has recorded the grant (which the webhook does, usually
 * seconds after payment). A session that is not the caller's reads exactly like
 * one that does not exist (`null`), so the route cannot be used to probe ids.
 */

import Stripe from "stripe"
import { supabase } from "../../lib/supabase.js"
import { getStripe } from "./stripe-client.js"
import { stripeCustomerIdOf } from "./stripe-customer.js"
import { isMissingColumnError } from "../../lib/postgrest-errors.js"
import { planGranted, type GrantMarker } from "./subscription-grant.js"
import { checkoutSessionState, REPLACE_EXPAND } from "./checkout-session-state.js"

export interface CheckoutStatus {
  status: "open" | "complete" | "expired"
  paymentStatus: "paid" | "unpaid" | "no_payment_required"
  mode: "payment" | "subscription"
  granted: boolean
  /**
   * True when the session is open and its payment has been submitted: a
   * create that names it as the one it replaces is refused
   * `checkout_in_progress`. False means no submitted payment is seen on the
   * session; such a create can still be refused (Stripe may refuse the
   * expire), so false is not a promise that it goes through.
   */
  paymentUnderWay: boolean
}

/**
 * A Checkout session id: Stripe's `cs_` prefix and a length bound only. A
 * stricter guess at its alphabet would turn a real id into a permanent 404.
 */
export const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]{1,250}$/

/**
 * The answer for a session that is not the caller's or does not exist: the
 * status read's 404 body, and a create route's when the session it was asked
 * to replace is not found. One object, so the two can never differ.
 */
export const CHECKOUT_SESSION_NOT_FOUND = {
  error: { code: "checkout_session_not_found", message: "No checkout session with this id on your account." },
} as const

/** An id field Stripe sends as a string, or as the expanded object. */
function idOf(field: string | { id: string } | null | undefined): string | null {
  if (typeof field === "string") return field || null
  return field?.id ?? null
}

function isMissingSession(err: unknown): boolean {
  return err instanceof Stripe.errors.StripeInvalidRequestError && err.statusCode === 404
}

async function retrieveSession(sessionId: string, expand?: readonly string[]): Promise<Stripe.Checkout.Session | null> {
  const sessions = getStripe().checkout.sessions
  try {
    return expand ? await sessions.retrieve(sessionId, { expand: [...expand] }) : await sessions.retrieve(sessionId)
  } catch (err) {
    if (isMissingSession(err)) return null
    throw err
  }
}

/**
 * `sessionId` as Stripe has it (with `expand`, when given) when it is the
 * caller's own pack, load or plan session; `null` when its id is malformed,
 * the caller has no Stripe customer, it does not exist, it is another
 * customer's, or it is not a payment or subscription session. Any other
 * Stripe failure throws: a failed read is never a "not found".
 */
export async function retrieveOwnSession(
  userId: string,
  sessionId: string,
  expand?: readonly string[],
): Promise<Stripe.Checkout.Session | null> {
  if (!CHECKOUT_SESSION_ID.test(sessionId)) return null
  const customerId = await stripeCustomerIdOf(userId)
  if (!customerId) return null
  const session = await retrieveSession(sessionId, expand)
  if (!session) return null
  if (idOf(session.customer) !== customerId) return null
  if (session.mode !== "payment" && session.mode !== "subscription") return null
  return session
}

/** A pack or a load: the claim row the webhook's grant writes, keyed as it keys it. */
async function packGranted(userId: string, session: Stripe.Checkout.Session): Promise<boolean> {
  const transactionId = idOf(session.payment_intent) ?? session.id
  const { data, error } = await supabase
    .from("transactions")
    .select("id")
    .eq("stripe_transaction_id", transactionId)
    .eq("user_id", userId)
    .eq("type", "topup")
    .maybeSingle()
  if (error) throw new Error(`transactions lookup failed: ${error.message}`)
  return data !== null && data !== undefined
}

interface SubscriptionOwner extends GrantMarker {
  readonly user_id: string
}

/**
 * The subscription row with its grant marker, read as `readSubscriptionRow`
 * reads it (a database without the marker yet is read again without it),
 * except that a database error throws: a failed read is never "not granted yet".
 */
async function readSubscriptionOwner(subscriptionId: string): Promise<SubscriptionOwner | null> {
  const withMarker = await supabase
    .from("subscriptions")
    .select("id, user_id, plan_granted")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle()
  if (!withMarker.error) return (withMarker.data ?? null) as SubscriptionOwner | null
  if (!isMissingColumnError(withMarker.error)) throw new Error(`subscriptions lookup failed: ${withMarker.error.message}`)
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id, user_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle()
  if (error) throw new Error(`subscriptions lookup failed: ${error.message}`)
  return (data ?? null) as SubscriptionOwner | null
}

/** A plan: the caller's subscription row, recorded with its plan granted. */
async function subscriptionGranted(userId: string, session: Stripe.Checkout.Session): Promise<boolean> {
  const subscriptionId = idOf(session.subscription)
  if (!subscriptionId) return false
  const row = await readSubscriptionOwner(subscriptionId)
  // No row is not granted (planGranted alone would read a missing marker as granted).
  if (!row) return false
  return row.user_id === userId && planGranted(row)
}

/**
 * The status of `sessionId` when it is the caller's own; `null` when it is not
 * theirs or does not exist. Throws on a Stripe or database failure, which is
 * never a "not found".
 */
export async function readCheckoutStatus(userId: string, sessionId: string): Promise<CheckoutStatus | null> {
  // One read, with what the under-way rule reads expanded.
  const session = await retrieveOwnSession(userId, sessionId, REPLACE_EXPAND)
  if (!session) return null
  // Repeats retrieveOwnSession's check on purpose: it narrows `mode` for the type.
  if (session.mode !== "payment" && session.mode !== "subscription") return null

  const granted = session.mode === "payment" ? await packGranted(userId, session) : await subscriptionGranted(userId, session)
  return {
    status: session.status ?? "open",
    paymentStatus: session.payment_status,
    mode: session.mode,
    granted,
    paymentUnderWay: checkoutSessionState(session) === "under-way",
  }
}
