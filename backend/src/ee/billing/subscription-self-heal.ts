/**
 * Re-reads an account's subscription period from Stripe when ours is stale:
 * the balance read's fallback (credits.ts `getBalance`) and the admin
 * "sync from Stripe" action (admin-subscription-health.ts).
 *
 * It only ever refreshes a subscription whose plan this account was granted
 * (`plan_granted = true`, not ended). It never creates a subscription row and
 * never writes a status onto one that was not granted:
 *  - a row is recorded, claimed and granted only by the Stripe webhook
 *    (subscription-grant.ts). A row created here would carry the column's
 *    default `plan_granted = true` with no plan credits behind it, and the
 *    webhook's claim would then find it already granted and grant nothing;
 *  - a subscription that was never granted (still unpaid, or refused as a
 *    second subscription of the account, second-subscription.ts) must stay as
 *    the webhook recorded it. Marked `active`, the checkout would refuse the
 *    account a new plan and the liveness reads would count it as live.
 *
 * Of several subscriptions active at Stripe, the one refreshed is the one
 * the account was granted, never simply the first Stripe lists.
 */
import type Stripe from "stripe"
import { supabase } from "../../lib/supabase.js"
import { getStripe } from "./stripe-client.js"
import { ENDED_STATUSES } from "./downgrade-floor.js"

/** `ENDED_STATUSES` as a PostgREST list, for `.not("status", "in", …)`. */
const ENDED_STATUS_LIST = `(${ENDED_STATUSES.join(",")})`

/** Enough for any account: the checkout allows one live subscription. */
const STRIPE_ACTIVE_LIST_LIMIT = 10

export type GrantedSubscriptionSync =
  | {
      outcome: "synced"
      stripeSubscriptionId: string
      priceId: string
      tier: string
      periodStart: string
      periodEnd: string
    }
  /** Stripe lists no active subscription for the customer. */
  | { outcome: "no_active_stripe_subscription" }
  /**
   * Stripe lists active subscriptions, but none is one this account was
   * granted here (not recorded yet, still unpaid, or a refused second
   * subscription). Nothing was written.
   */
  | { outcome: "not_granted"; stripeSubscriptionIds: string[] }

export async function syncGrantedSubscriptionFromStripe(params: {
  userId: string
  stripeCustomerId: string
  /** The tier to store on the row, from its Stripe item. */
  tierFor: (item: Stripe.SubscriptionItem) => string
}): Promise<GrantedSubscriptionSync> {
  const { userId, stripeCustomerId, tierFor } = params
  const subs = await getStripe().subscriptions.list({
    customer: stripeCustomerId,
    status: "active",
    limit: STRIPE_ACTIVE_LIST_LIMIT,
  })
  const active = subs.data.filter((s) => s.items.data[0] != null)
  if (active.length === 0) return { outcome: "no_active_stripe_subscription" }
  const activeIds = active.map((s) => s.id)

  const { data: granted, error: readError } = await supabase
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("user_id", userId)
    .in("stripe_subscription_id", activeIds)
    .eq("plan_granted", true)
    .not("status", "in", ENDED_STATUS_LIST)
  if (readError) throw new Error(`subscription self-heal read failed: ${readError.message}`)
  const grantedIds = new Set((granted ?? []).map((r) => r.stripe_subscription_id as string))
  const sub = active.find((s) => grantedIds.has(s.id))
  if (!sub) return { outcome: "not_granted", stripeSubscriptionIds: activeIds }

  const item = sub.items.data[0]!
  const periodStart = new Date(item.current_period_start * 1000).toISOString()
  const periodEnd = new Date(item.current_period_end * 1000).toISOString()
  const tier = tierFor(item)
  // Conditional on the grant, so a row that ended or was released between the
  // read and this write is left alone.
  const { data: written, error: writeError } = await supabase
    .from("subscriptions")
    .update({
      stripe_price_id: item.price?.id ?? "",
      tier,
      status: "active",
      current_period_start: periodStart,
      current_period_end: periodEnd,
    })
    .eq("user_id", userId)
    .eq("stripe_subscription_id", sub.id)
    .eq("plan_granted", true)
    .not("status", "in", ENDED_STATUS_LIST)
    .select("stripe_subscription_id")
  if (writeError) throw new Error(`subscription self-heal write failed: ${writeError.message}`)
  if (!written || written.length === 0) {
    return { outcome: "not_granted", stripeSubscriptionIds: activeIds }
  }
  return {
    outcome: "synced",
    stripeSubscriptionId: sub.id,
    priceId: item.price?.id ?? "",
    tier,
    periodStart,
    periodEnd,
  }
}
