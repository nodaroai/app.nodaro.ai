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

export interface CheckoutStatus {
  status: "open" | "complete" | "expired"
  paymentStatus: "paid" | "unpaid" | "no_payment_required"
  mode: "payment" | "subscription"
  granted: boolean
}

/**
 * A Checkout session id: Stripe's `cs_` prefix and a length bound only. A
 * stricter guess at its alphabet would turn a real id into a permanent 404.
 */
export const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]{1,250}$/

/** An id field Stripe sends as a string, or as the expanded object. */
function idOf(field: string | { id: string } | null | undefined): string | null {
  if (typeof field === "string") return field || null
  return field?.id ?? null
}

function isMissingSession(err: unknown): boolean {
  return err instanceof Stripe.errors.StripeInvalidRequestError && err.statusCode === 404
}

async function retrieveSession(sessionId: string): Promise<Stripe.Checkout.Session | null> {
  try {
    return await getStripe().checkout.sessions.retrieve(sessionId)
  } catch (err) {
    if (isMissingSession(err)) return null
    throw err
  }
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
  if (!CHECKOUT_SESSION_ID.test(sessionId)) return null
  const customerId = await stripeCustomerIdOf(userId)
  if (!customerId) return null
  const session = await retrieveSession(sessionId)
  if (!session) return null
  if (idOf(session.customer) !== customerId) return null
  if (session.mode !== "payment" && session.mode !== "subscription") return null

  const granted = session.mode === "payment" ? await packGranted(userId, session) : await subscriptionGranted(userId, session)
  return {
    status: session.status ?? "open",
    paymentStatus: session.payment_status,
    mode: session.mode,
    granted,
  }
}
