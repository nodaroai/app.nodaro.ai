// @registry-enumerates writes the plan grant's audit rows through CreditsService.logTransaction — no node type is looked up, so not a @registry-lookup
/**
 * When a Stripe subscription's plan is granted, and the grant itself.
 *
 * The plan (the paid tier, the plan's credits, the storage that comes with
 * it, and the move of the account's remaining balance into top-up) is given
 * once per subscription, only once it is paid for: at creation when it is
 * already `active` or `trialing`, otherwise by the first update that sees it
 * so. The subscription row's `plan_granted` marker (migration 650) is the
 * claim: an insert marked granted by the column's default, or the conditional
 * update of a row recorded unpaid. The webhook handlers that call this live
 * in provision-credits.ts.
 */

import { supabase } from "../../lib/supabase.js"
import { isMissingColumnError } from "../../lib/postgrest-errors.js"
import { TIER_CREDITS, TIER_STORAGE_LIMITS } from "./stripe-config.js"
import { tierColumns } from "./tier-columns.js"
import { notifyPaidConversion } from "../notifications/founder-notify.js"
import { CreditsService } from "./credits.js"
import { invalidateBalanceCache } from "./balance-cache.js"
import { StripeEventRetryError } from "./stripe-event-retry.js"

/**
 * Stripe creates a Checkout subscription `incomplete` while its first payment
 * is not done (a payment that needs the customer's action, a declined card)
 * and moves it to `active` once that invoice is paid, or to
 * `incomplete_expired` after 23 hours unpaid. Only an `active` or `trialing`
 * subscription is granted its plan: the paid tier (and the watermark-free
 * output and storage that follow it), the plan's credits, and the move of
 * the remaining balance into top-up. Any other status grants nothing.
 */
export const GRANTING_STATUSES: ReadonlySet<string> = new Set(["active", "trialing"])

/**
 * The statuses under which an update keeps writing the plan's paid tier on a
 * granted account: the granting ones, and `past_due` (a renewal payment being
 * retried), as before. Under any other status an update leaves the account's
 * tier as it is.
 */
export const PAID_TIER_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due"])

/**
 * The statuses a subscription never leaves: Stripe's two terminal ones
 * (`canceled`, `incomplete_expired`) and `expired`, which the hourly expiry
 * gives a cancelled subscription past its period. An event that says such a
 * subscription is live again is a late one: it neither grants the plan nor
 * moves the stored status.
 */
export const ENDED_STATUSES: readonly string[] = ["canceled", "expired", "incomplete_expired"]

export function isEndedStatus(status: string | null | undefined): boolean {
  return status != null && ENDED_STATUSES.includes(status)
}

/** `ENDED_STATUSES` as a PostgREST list, for `.not("status", "in", …)`. */
export const ENDED_STATUS_LIST = `(${ENDED_STATUSES.join(",")})`

/**
 * Whether a subscription row's plan was granted. `plan_granted` is false only
 * on a row the created handler recorded unpaid; a row from before the column
 * existed, or from a writer that does not name it, reads as granted (the
 * column's default), and so does a row read without the column at all (a
 * database the column has not reached yet, where every row was granted at
 * creation).
 */
export function planGranted(row: GrantMarker): boolean {
  return row.plan_granted !== false
}

export interface GrantMarker {
  /** Absent when the row was read from a database without the column yet. */
  readonly plan_granted?: boolean | null
}

/** What handleSubscriptionUpdated reads of the stored subscription. */
export const SUBSCRIPTION_UPDATE_COLUMNS = "id, status, stripe_price_id, tier, current_period_start, current_period_end, cancel_at_period_end"

export interface StoredSubscription {
  readonly id: string
  readonly status: string
  readonly stripe_price_id: string | null
  readonly tier: string
  readonly current_period_start: string | null
  readonly current_period_end: string | null
  readonly cancel_at_period_end: boolean | null
}

/**
 * A subscription row with its grant marker. A database without the marker yet
 * (staging runs ahead of main on the shared database) is read without it.
 */
export async function readSubscriptionRow<T extends object>(subscriptionId: string, columns: string): Promise<(T & GrantMarker) | null> {
  const withMarker = await supabase
    .from("subscriptions")
    .select(`${columns}, plan_granted`)
    .eq("stripe_subscription_id", subscriptionId)
    .single()
  if (!isMissingColumnError(withMarker.error)) return (withMarker.data ?? null) as unknown as (T & GrantMarker) | null
  const { data } = await supabase
    .from("subscriptions")
    .select(columns)
    .eq("stripe_subscription_id", subscriptionId)
    .single()
  return (data ?? null) as unknown as (T & GrantMarker) | null
}

export interface SubscriptionRecord {
  readonly subscriptionId: string
  readonly priceId: string
  readonly status: string
  readonly currentPeriodStart: string | null
  readonly currentPeriodEnd: string | null
  readonly transactionId?: string
  readonly amountUsd?: number
}

/**
 * Record a subscription that is not paid for yet, marked not granted. Answers
 * "marker-missing" when the database has no marker column yet: the caller
 * then grants at creation, as before the column existed.
 */
export async function recordUnpaidSubscription(
  userId: string,
  tier: string,
  data: SubscriptionRecord,
): Promise<"recorded" | "failed" | "marker-missing"> {
  const { error } = await supabase
    .from("subscriptions")
    .insert({
      user_id: userId,
      stripe_subscription_id: data.subscriptionId,
      stripe_price_id: data.priceId,
      tier,
      status: data.status,
      current_period_start: data.currentPeriodStart,
      current_period_end: data.currentPeriodEnd,
      plan_granted: false,
    })
  if (!error) {
    console.log(
      `[stripe] subscription.created: ${data.status}, nothing granted until it is paid: user=${userId} sub=${data.subscriptionId}`,
    )
    return "recorded"
  }
  if (isMissingColumnError(error)) {
    console.warn("[stripe] subscription.created: plan_granted is not in the database yet, granting at creation", data.subscriptionId)
    return "marker-missing"
  }
  console.error("[stripe] subscription.created: insert failed:", error.message)
  return "failed"
}

/**
 * Record a paid subscription and grant its plan. The insert is the claim: the
 * subscription id is unique, and the row is marked granted by the column's
 * default, so of two events recording the same subscription only the one
 * whose insert lands grants it. Answers whether it did. `duplicateExpected`:
 * the caller (an update that may have outrun created) reads a row that is
 * already there as the normal race, not as a failure.
 */
export async function recordAndGrantSubscription(
  userId: string,
  tier: string,
  data: SubscriptionRecord,
  event: string,
  duplicateExpected = false,
): Promise<boolean> {
  const preProfile = await readPreSubscribeProfile(userId)

  // Insert subscription record
  const { error: subError } = await supabase
    .from("subscriptions")
    .insert({
      user_id: userId,
      stripe_subscription_id: data.subscriptionId,
      stripe_price_id: data.priceId,
      tier,
      status: data.status,
      current_period_start: data.currentPeriodStart,
      current_period_end: data.currentPeriodEnd,
    })

  if (subError) {
    if (duplicateExpected && subError.code === "23505") {
      console.log(`[stripe] ${event}: already recorded by its created event, the claim decides: sub=${data.subscriptionId}`)
    } else {
      console.error(`[stripe] ${event}: insert failed:`, subError.message)
    }
    return false
  }

  await grantSubscriptionPlan(userId, tier, data, preProfile, event)
  return true
}

/**
 * Move a recorded, not-yet-granted subscription to granted. A conditional
 * update: of every event that tries it at once or later, exactly one gets the
 * row back, and only that one grants. A subscription that has ended (its
 * stored status one of ENDED_STATUSES, say cancelled before a late paid
 * update arrived) is never claimed. A database error throws
 * StripeEventRetryError before anything is written, so Stripe redelivers the
 * event and the claim is tried again.
 */
export async function claimSubscriptionGrant(subscriptionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("subscriptions")
    .update({ plan_granted: true })
    .eq("stripe_subscription_id", subscriptionId)
    .eq("plan_granted", false)
    .not("status", "in", ENDED_STATUS_LIST)
    .select("id")
  if (error) {
    console.error("[stripe] subscription.updated: claiming the plan grant failed:", subscriptionId, error.message)
    throw new StripeEventRetryError(`claiming the plan grant of ${subscriptionId} failed: ${error.message}`)
  }
  return Array.isArray(data) && data.length > 0
}

export interface PreSubscribeProfile {
  readonly subscription_credits?: number | null
  readonly topup_credits?: number | null
  readonly subscription_tier?: string | null
}

/**
 * Snapshot the pre-subscribe balance BEFORE the tier grant overwrites it.
 * The free signup grant (or a prior post-cancel capped balance) lives in
 * subscription_credits, and the grant's SET would silently destroy it —
 * subscribing must never reduce a user's total credits. The remainder is
 * preserved by moving it into the topup pool (which survives renewals and
 * cancellation) after the profile update succeeds.
 */
export async function readPreSubscribeProfile(userId: string): Promise<PreSubscribeProfile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("subscription_credits, topup_credits, subscription_tier")
    .eq("id", userId)
    .single()
  return data
}

/**
 * The plan grant, given once per subscription by whichever event claimed it:
 * the paid tier, the plan's credits, its storage, the period end, and the
 * pre-subscribe balance moved into top-up.
 */
export async function grantSubscriptionPlan(
  userId: string,
  tier: string,
  data: SubscriptionRecord,
  preProfile: PreSubscribeProfile | null,
  event: string,
): Promise<void> {
  const credits = TIER_CREDITS[tier] ?? TIER_CREDITS.free
  const storageLimit = TIER_STORAGE_LIMITS[tier] ?? TIER_STORAGE_LIMITS.free
  const carryover = Math.max(0, preProfile?.subscription_credits ?? 0)
  const priorTier = preProfile?.subscription_tier ?? "free"

  // Update user profile
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      ...tierColumns(tier),
      subscription_credits: credits,
      credits_reset_at: new Date().toISOString(),
      storage_limit_bytes: storageLimit,
      subscription_ended_at: null,
      current_period_end: data.currentPeriodEnd,
    })
    .eq("id", userId)

  if (profileError) {
    console.error(`[stripe] ${event}: profile update failed:`, profileError.message)
  }

  // Carry the pre-subscribe remainder into topup AFTER the grant SET succeeded
  // (if the profile update failed, subscription_credits still holds the old
  // balance — granting the carryover on top would double it). The atomic RPC
  // increments topup_credits; a redelivered event can't re-run this because
  // the grant was claimed first (the insert, or claimSubscriptionGrant).
  if (!profileError && carryover > 0) {
    const { error: carryError } = await supabase.rpc("add_topup_credits", {
      p_user_id: userId,
      p_credits: carryover,
    })
    if (carryError) {
      console.error(`[stripe] ${event}: balance carryover failed:`, carryError.message)
    } else {
      await CreditsService.logTransaction({
        userId,
        amount: carryover,
        creditType: "topup",
        source: "subscription_created",
        description: `Pre-subscription balance preserved: ${carryover} credits moved to top-up`,
        balanceAfter: (preProfile?.topup_credits ?? 0) + carryover,
      })
    }
  }

  invalidateBalanceCache(userId)

  // Insert transaction record (if transaction info provided)
  if (data.transactionId) {
    await insertTransaction({
      userId,
      stripeTransactionId: data.transactionId,
      type: "subscription",
      amountUsd: data.amountUsd ?? 0,
      creditsGranted: credits,
      tier,
    })
  }

  // Audit log: subscription creation
  await CreditsService.logTransaction({
    userId,
    amount: credits,
    creditType: "subscription",
    source: "subscription_created",
    description: `Subscription created: ${tier} tier (${credits} credits)`,
    balanceAfter: credits,
  })

  console.log(`[stripe] ${event}: user=${userId} tier=${tier} credits=${credits}`)

  // Internal founder milestone alert (fire-and-forget; a notification failure
  // must never affect billing). Fires only on a real free→paid transition.
  void notifyPaidConversion(userId, priorTier, tier)
}

// ── Insert Transaction Record ────────────────────────────────────

interface InsertTransactionParams {
  readonly userId: string
  readonly stripeTransactionId: string
  readonly type: "subscription" | "topup"
  readonly amountUsd: number
  readonly creditsGranted: number
  readonly tier?: string
}

export async function insertTransaction(params: InsertTransactionParams): Promise<void> {
  const { error } = await supabase
    .from("transactions")
    .upsert(
      {
        user_id: params.userId,
        stripe_transaction_id: params.stripeTransactionId,
        type: params.type,
        amount_usd: params.amountUsd,
        credits_granted: params.creditsGranted,
        tier: params.tier ?? null,
      },
      { onConflict: "stripe_transaction_id" }
    )

  if (error) {
    console.error("[stripe] insertTransaction failed:", error.message)
  }
}
