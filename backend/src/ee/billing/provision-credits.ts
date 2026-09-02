/**
 * Stripe Credit Provisioning Service
 *
 * Helper functions called by the Stripe webhook handler to manage
 * subscriptions, tiers, and credit allocations.
 * All DB operations use the Supabase service-role client.
 */

import { supabase } from "../../lib/supabase.js"
import {
  getTierFromPriceId,
  getTopupCredits,
  TIER_CREDITS,
  TIER_STORAGE_LIMITS,
} from "./stripe-config.js"
import { tierColumns } from "./tier-columns.js"
import { notifyPaidConversion, notifyCancellation } from "../notifications/founder-notify.js"
import { getStripe } from "./stripe-client.js"
import { downgradeToEffectiveFloor, raiseStorageFloorOnActivation, reapplyStorageFloorAfterClawback } from "./downgrade-floor.js"
import { creditsForLoadUsd } from "./load-rate.js"
import { CreditsService } from "./credits.js"
import { invalidateBalanceCache } from "../routes/credits.js"

// ── Stripe Customer Mapping ──────────────────────────────────────

export async function getUserIdFromStripeCustomer(
  stripeCustomerId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("stripe_customers")
    .select("user_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .single()
  return data?.user_id ?? null
}

export async function ensureStripeCustomer(
  stripeCustomerId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("stripe_customers")
    .upsert(
      { stripe_customer_id: stripeCustomerId, user_id: userId },
      { onConflict: "stripe_customer_id" }
    )
  if (error) {
    console.error("[stripe] Failed to upsert stripe_customers:", error.message)
  }
}

// ── Resolve userId from event (customer lookup + metadata fallback) ──

export async function resolveUserId(
  stripeCustomerId: string,
  metadata: Record<string, string> | null
): Promise<string | null> {
  const userId = await getUserIdFromStripeCustomer(stripeCustomerId)
  if (userId) return userId

  const fallbackUserId = metadata?.userId
  if (fallbackUserId) {
    await ensureStripeCustomer(stripeCustomerId, fallbackUserId)
    return fallbackUserId
  }

  return null
}

// ── Subscription Created ─────────────────────────────────────────

interface SubscriptionCreatedData {
  readonly subscriptionId: string
  readonly stripeCustomerId: string
  readonly priceId: string
  readonly status: string
  readonly currentPeriodStart: string | null
  readonly currentPeriodEnd: string | null
  readonly metadata: Record<string, string> | null
  readonly transactionId?: string
  readonly amountUsd?: number
}

export async function handleSubscriptionCreated(
  data: SubscriptionCreatedData
): Promise<void> {
  const userId = await resolveUserId(data.stripeCustomerId, data.metadata)
  if (!userId) {
    console.error("[stripe] subscription.created: cannot resolve userId for customer", data.stripeCustomerId)
    return
  }

  const tier = getTierFromPriceId(data.priceId)
  const credits = TIER_CREDITS[tier] ?? TIER_CREDITS.free
  const storageLimit = TIER_STORAGE_LIMITS[tier] ?? TIER_STORAGE_LIMITS.free

  // Idempotent: skip if subscription already exists
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("stripe_subscription_id", data.subscriptionId)
    .single()

  if (existing) {
    console.log("[stripe] subscription.created: already exists, skipping", data.subscriptionId)
    return
  }

  // Snapshot the pre-subscribe balance BEFORE the tier grant overwrites it.
  // The free signup grant (or a prior post-cancel capped balance) lives in
  // subscription_credits, and the SET below would silently destroy it —
  // subscribing must never reduce a user's total credits. The remainder is
  // preserved by moving it into the topup pool (which survives renewals and
  // cancellation) after the profile update succeeds.
  const { data: preProfile } = await supabase
    .from("profiles")
    .select("subscription_credits, topup_credits, subscription_tier")
    .eq("id", userId)
    .single()
  const carryover = Math.max(0, preProfile?.subscription_credits ?? 0)
  const priorTier = preProfile?.subscription_tier ?? "free"

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
    console.error("[stripe] subscription.created: insert failed:", subError.message)
    return
  }

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
    console.error("[stripe] subscription.created: profile update failed:", profileError.message)
  }

  // Carry the pre-subscribe remainder into topup AFTER the grant SET succeeded
  // (if the profile update failed, subscription_credits still holds the old
  // balance — granting the carryover on top would double it). The atomic RPC
  // increments topup_credits; a redelivered created-event can't re-run this
  // because the subscription-exists check above short-circuits first.
  if (!profileError && carryover > 0) {
    const { error: carryError } = await supabase.rpc("add_topup_credits", {
      p_user_id: userId,
      p_credits: carryover,
    })
    if (carryError) {
      console.error("[stripe] subscription.created: balance carryover failed:", carryError.message)
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

  console.log(`[stripe] subscription.created: user=${userId} tier=${tier} credits=${credits}`)

  // Internal founder milestone alert (fire-and-forget; a notification failure
  // must never affect billing). Fires only on a real free→paid transition.
  void notifyPaidConversion(userId, priorTier, tier)
}

/**
 * True only when both period starts are present, parseable, and denote
 * different instants. Nulls/garbage never count as a renewal — a renewal
 * grants a full month of credits, so the safe default is "no grant".
 */
function billingPeriodMoved(stored: string | null, incoming: string | null): boolean {
  if (!stored || !incoming) return false
  const a = new Date(stored).getTime()
  const b = new Date(incoming).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  return a !== b
}

// ── Subscription Updated ─────────────────────────────────────────

interface SubscriptionUpdatedData {
  readonly subscriptionId: string
  readonly stripeCustomerId: string
  readonly priceId: string
  readonly status: string
  readonly currentPeriodStart: string | null
  readonly currentPeriodEnd: string | null
  /**
   * Scheduled-cancellation state, synced verbatim from the Stripe event so a
   * portal "cancel at period end" is visible in the DB the moment it happens
   * (status stays "active" until the period-end deleted event — these columns
   * are the ONLY trace). Newer Stripe API versions express a portal cancel as
   * `cancel_at` (timestamp) with `cancel_at_period_end` still false, so
   * consumers must treat "scheduled" as `cancelAtPeriodEnd || cancelAt != null`.
   * Cleared (false/null) when the user reactivates.
   */
  readonly cancelAtPeriodEnd: boolean
  readonly cancelAt: string | null
  readonly canceledAt: string | null
  readonly metadata: Record<string, string> | null
}

export async function handleSubscriptionUpdated(
  data: SubscriptionUpdatedData
): Promise<void> {
  const userId = await resolveUserId(data.stripeCustomerId, data.metadata)
  if (!userId) {
    console.error("[stripe] subscription.updated: cannot resolve userId for customer", data.stripeCustomerId)
    return
  }

  // Look up existing subscription
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id, stripe_price_id, tier, current_period_start, cancel_at_period_end")
    .eq("stripe_subscription_id", data.subscriptionId)
    .single()

  if (!existing) {
    console.warn("[stripe] subscription.updated: subscription not found", data.subscriptionId)
    return
  }

  const newTier = getTierFromPriceId(data.priceId)
  const oldTier = existing.tier
  const newCredits = TIER_CREDITS[newTier] ?? 0
  const oldCredits = TIER_CREDITS[oldTier] ?? 0
  const storageLimit = TIER_STORAGE_LIMITS[newTier] ?? TIER_STORAGE_LIMITS.free

  // Check if this is a tier change (upgrade/downgrade)
  const tierChanged = existing.stripe_price_id !== data.priceId

  // Check if this is a renewal (billing period actually moved). MUST compare
  // as epochs, not strings — Postgres returns "+00:00" while the webhook
  // computes toISOString()'s ".000Z", so a string compare flags EVERY
  // subscription.updated (portal cancel request, payment-method change,
  // Stripe redelivery) as a renewal and refills subscription_credits for free.
  const isRenewal = billingPeriodMoved(existing.current_period_start, data.currentPeriodStart)

  if (tierChanged) {
    const isUpgrade = newCredits > oldCredits

    if (isUpgrade) {
      // Idempotent SET (not ADD) — safe if change-plan endpoint already updated credits
      const { error: creditError } = await supabase
        .from("profiles")
        .update({ subscription_credits: newCredits })
        .eq("id", userId)

      if (creditError) {
        console.error("[stripe] subscription.updated: credit SET failed:", creditError.message)
      }

      // Audit log: upgrade
      await CreditsService.logTransaction({
        userId,
        amount: newCredits,
        creditType: "subscription",
        source: "subscription_renewal",
        description: `Tier upgrade: ${oldTier} → ${newTier} (credits set to ${newCredits})`,
        balanceAfter: newCredits,
      })

      console.log(`[stripe] subscription.updated: upgrade ${oldTier}->${newTier}, set credits to ${newCredits}`)
    } else {
      // Downgrade: don't reduce credits immediately — let user keep current credits until next renewal
      await CreditsService.logTransaction({
        userId,
        amount: newCredits,
        creditType: "subscription",
        source: "subscription_renewal",
        description: `Tier downgrade: ${oldTier} → ${newTier} (credits unchanged until renewal)`,
        balanceAfter: newCredits,
      })

      console.log(`[stripe] subscription.updated: downgrade ${oldTier}->${newTier}, credits unchanged until renewal`)
    }
  }

  if (isRenewal) {
    // Reset subscription credits on renewal
    const { error: resetError } = await supabase
      .from("profiles")
      .update({
        subscription_credits: newCredits,
        credits_reset_at: new Date().toISOString(),
      })
      .eq("id", userId)

    if (resetError) {
      console.error("[stripe] subscription.updated: credit reset failed:", resetError.message)
    } else {
      // Audit log: renewal
      await CreditsService.logTransaction({
        userId,
        amount: newCredits,
        creditType: "subscription",
        source: "subscription_renewal",
        description: `Subscription renewal: ${newTier} tier (credits reset to ${newCredits})`,
        balanceAfter: newCredits,
      })
      console.log(`[stripe] subscription.updated: renewal, reset credits to ${newCredits}`)
    }
  }

  // Update subscription record
  const { error: subError } = await supabase
    .from("subscriptions")
    .update({
      stripe_price_id: data.priceId,
      tier: newTier,
      status: data.status,
      current_period_start: data.currentPeriodStart,
      current_period_end: data.currentPeriodEnd,
      cancel_at_period_end: data.cancelAtPeriodEnd,
      cancel_at: data.cancelAt,
      canceled_at: data.canceledAt,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", data.subscriptionId)

  if (subError) {
    console.error("[stripe] subscription.updated: update failed:", subError.message)
  }

  // Update profile tier, storage, and period end
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      ...tierColumns(newTier),
      storage_limit_bytes: storageLimit,
      current_period_end: data.currentPeriodEnd,
      // Clear any stale cancellation marker — an updated/active subscription is
      // NOT "ended". Leaving this set let the canceled-user media reaper
      // (cleanup-service.ts) match a reactivated paying customer and delete
      // their entire media library 60 days later.
      subscription_ended_at: null,
    })
    .eq("id", userId)

  if (profileError) {
    console.error("[stripe] subscription.updated: profile update failed:", profileError.message)
  }

  invalidateBalanceCache(userId)

  // Internal founder milestone alerts (fire-and-forget). Conversion fires only
  // on a genuine free→paid transition. The churn alert fires the moment the
  // user SCHEDULES cancellation (cancel_at_period_end false→true) — the
  // founder-relevant signal — not 30 days later at period end; keying on the
  // flip means a later unrelated `updated` (e.g. a payment-method change while
  // already scheduled) won't re-fire it. The immediate-cancel case is covered
  // by handleSubscriptionCanceled below (which skips anything already flagged).
  void notifyPaidConversion(userId, oldTier, newTier)
  if (!existing.cancel_at_period_end && data.cancelAtPeriodEnd === true) {
    void notifyCancellation(userId, oldTier, true)
  }
}

// ── Subscription Canceled ────────────────────────────────────────

interface SubscriptionCanceledData {
  readonly subscriptionId: string
  readonly stripeCustomerId: string
  readonly currentPeriodEnd: string | null
  readonly metadata: Record<string, string> | null
}

export async function handleSubscriptionCanceled(
  data: SubscriptionCanceledData
): Promise<void> {
  const userId = await resolveUserId(data.stripeCustomerId, data.metadata)
  const now = new Date().toISOString()

  // Whether this cancellation was ALREADY announced to founders at schedule
  // time (the portal cancel_at_period_end flip, alerted from
  // subscription.updated). Read BEFORE the status overwrite below. A directly
  // deleted subscription (immediate cancel, no prior scheduled flip) has this
  // false/absent and IS announced at the end of this handler.
  const { data: preCancelSub } = await supabase
    .from("subscriptions")
    .select("cancel_at_period_end")
    .eq("stripe_subscription_id", data.subscriptionId)
    .single()
  const cancelAlreadyAnnounced = preCancelSub?.cancel_at_period_end === true

  // Update subscription status
  const { error: subError } = await supabase
    .from("subscriptions")
    .update({
      status: "canceled",
      canceled_at: now,
      updated_at: now,
    })
    .eq("stripe_subscription_id", data.subscriptionId)

  if (subError) {
    console.error("[stripe] subscription.canceled: update failed:", subError.message)
  }

  if (!userId) {
    console.error("[stripe] subscription.canceled: cannot resolve userId for customer", data.stripeCustomerId)
    return
  }

  // Get current subscription credits to cap at free tier limit (and the tier
  // before downgrade, for the internal founder cancellation alert).
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_credits, subscription_tier")
    .eq("id", userId)
    .single()
  const priorTier = profile?.subscription_tier ?? null

  const currentSubCredits = profile?.subscription_credits ?? 0
  const freeCredits = TIER_CREDITS.free ?? 0
  const cappedCredits = Math.min(currentSubCredits, freeCredits)

  // Effective floor: payg-landing users (net lifetime top-ups > 0) keep the
  // 10 GB floor; genuinely-free users drop to 1 GB. One shared helper across
  // all three downgrade writers (design §4.5).
  const { error: profileError } = (
    await downgradeToEffectiveFloor(userId, {
      subscription_credits: cappedCredits,
      subscription_ended_at: now,
    })
  )

  if (profileError) {
    console.error("[stripe] subscription.canceled: profile downgrade failed:", profileError.message)
  }

  invalidateBalanceCache(userId)

  // Audit log: cancellation
  await CreditsService.logTransaction({
    userId,
    amount: cappedCredits - currentSubCredits,
    creditType: "subscription",
    source: "expiry",
    description: `Subscription canceled: downgraded to free tier (credits capped at ${cappedCredits})`,
    balanceAfter: cappedCredits,
  })

  console.log(
    `[stripe] subscription.canceled: sub=${data.subscriptionId} user=${userId} downgraded to free (credits: ${cappedCredits})`
  )

  // Internal founder milestone alert (fire-and-forget). Fires only when the
  // user was actually on a paid tier before this cancellation AND it wasn't
  // already announced at schedule time (avoids a duplicate 30 days later).
  if (!cancelAlreadyAnnounced) void notifyCancellation(userId, priorTier)
}

// ── Invoice Paid (credit renewal for subscriptions) ──────────────

interface InvoicePaidData {
  readonly invoiceId: string
  readonly subscriptionId: string
  readonly stripeCustomerId: string
  readonly amountPaid: number
  readonly metadata: Record<string, string> | null
}

export async function handleInvoicePaid(
  data: InvoicePaidData
): Promise<void> {
  // Look up subscription to get tier info
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("tier, user_id")
    .eq("stripe_subscription_id", data.subscriptionId)
    .single()

  if (!sub) {
    console.log("[stripe] invoice.paid: subscription not found, skipping", data.subscriptionId)
    return
  }

  // Insert transaction record for tracking
  await insertTransaction({
    userId: sub.user_id,
    stripeTransactionId: data.invoiceId,
    type: "subscription",
    amountUsd: data.amountPaid / 100,
    creditsGranted: TIER_CREDITS[sub.tier] ?? 0,
    tier: sub.tier,
  })

  console.log(`[stripe] invoice.paid: user=${sub.user_id} tier=${sub.tier} invoice=${data.invoiceId}`)
}

// ── Transaction Completed (top-ups) ──────────────────────────────

interface TransactionCompletedData {
  readonly transactionId: string
  readonly stripeCustomerId: string | null
  readonly subscriptionId: string | null
  readonly lineItems: ReadonlyArray<{ priceId: string }>
  readonly totalAmount: number
  readonly metadata: Record<string, string> | null
}

export async function handleTransactionCompleted(
  data: TransactionCompletedData
): Promise<void> {
  // Skip subscription-related transactions (handled by subscription events)
  if (data.subscriptionId) {
    console.log("[stripe] transaction.completed: subscription tx, skipping", data.transactionId)
    return
  }

  // Find top-up price in line items
  let totalCredits = 0
  for (const item of data.lineItems) {
    const credits = getTopupCredits(item.priceId)
    if (credits) {
      totalCredits += credits
    }
  }

  // Fallback to the priceId seeded in checkout metadata. getSessionLineItems
  // swallows API errors (returns []), so a transient Stripe failure otherwise
  // granted the paying user ZERO credits with no retry (the webhook acks 200).
  // The idempotency claim below still prevents any double-grant.
  if (totalCredits === 0 && data.metadata?.topupPriceId) {
    totalCredits = getTopupCredits(data.metadata.topupPriceId) ?? 0
  }

  // Arbitrary-amount load (metadata kind="load"): size the grant from the
  // SETTLED amount through the rate function — metadata never sizes a grant,
  // and a tampered/mismatched amount fails loudly instead of granting.
  if (totalCredits === 0 && data.metadata?.kind === "load") {
    if (data.totalAmount > 0 && data.totalAmount % 100 === 0) {
      try {
        totalCredits = creditsForLoadUsd(data.totalAmount / 100)
      } catch (err) {
        console.error(
          "[stripe] transaction.completed: load amount rejected by rate function:",
          data.transactionId,
          err instanceof Error ? err.message : err
        )
      }
    } else {
      console.error(
        "[stripe] transaction.completed: load session with non-whole-dollar amount:",
        data.transactionId,
        data.totalAmount
      )
    }
  }

  if (totalCredits === 0) {
    console.log("[stripe] transaction.completed: no top-up items found", data.transactionId)
    return
  }

  // Resolve user
  const userId = data.stripeCustomerId
    ? await resolveUserId(data.stripeCustomerId, data.metadata)
    : data.metadata?.userId ?? null

  if (!userId) {
    console.error("[stripe] transaction.completed: cannot resolve userId for tx", data.transactionId)
    return
  }

  // Atomic idempotency + grant in ONE DB transaction (grant_topup_credits_idempotent,
  // migration 199). The transactions row (UNIQUE stripe_transaction_id) is the claim
  // AND add_topup_credits runs inside the same transaction, so:
  //   - a Stripe redelivery / manual replay can NEVER double-grant (ON CONFLICT
  //     short-circuits and the RPC returns false), and
  //   - a failure can NEVER leave a committed claim without the grant (both roll
  //     back together) — no permanent zero-credit, no compensating delete needed.
  // Returns true if it granted, false if the claim already existed (duplicate).
  const { data: granted, error: rpcError } = await supabase.rpc("grant_topup_credits_idempotent", {
    p_user_id: userId,
    p_credits: totalCredits,
    p_stripe_transaction_id: data.transactionId,
    p_amount_usd: data.totalAmount / 100, // Stripe amounts in cents
  })

  if (rpcError) {
    // Nothing committed (claim + grant are atomic) — safe to leave for a Stripe
    // redelivery/replay, which will grant exactly once.
    console.error(
      "[stripe] transaction.completed: grant_topup_credits_idempotent failed:",
      data.transactionId,
      rpcError.message,
    )
    return
  }

  if (granted === false) {
    console.log(
      "[stripe] transaction.completed: already processed (idempotent), skipping",
      data.transactionId,
    )
    return
  }

  invalidateBalanceCache(userId)

  // First-purchase payg activation: lift the storage floor to 10 GB
  // (GREATEST semantics — never lowers an admin-raised limit; no-op for
  // subscribers, whose floor is write-managed by the subscription paths).
  await raiseStorageFloorOnActivation(userId)

  // Receipt link for the in-app ledger (Billing-UX) — best-effort, after the
  // grant so a Stripe hiccup can never block provisioning.
  void captureReceiptUrl(data.transactionId)

  console.log(`[stripe] transaction.completed: user=${userId} topup +${totalCredits} credits`)
}

/**
 * Store the charge's hosted receipt_url on the transactions row, keyed by
 * the PI id the grant used. Post-grant UPDATE by design (migration 313):
 * the grant RPC stays untouched and a failure here costs only the link.
 */
export async function captureReceiptUrl(piId: string): Promise<void> {
  try {
    const pi = await getStripe().paymentIntents.retrieve(piId, { expand: ["latest_charge"] })
    const charge = pi.latest_charge
    const receiptUrl =
      charge && typeof charge === "object" ? (charge.receipt_url ?? null) : null
    if (!receiptUrl) return
    await supabase
      .from("transactions")
      .update({ receipt_url: receiptUrl })
      .eq("stripe_transaction_id", piId)
  } catch (err) {
    console.error("[stripe] receipt-url capture failed:", piId, (err as Error).message)
  }
}

// ── Shared: Insert Transaction Record ────────────────────────────

interface InsertTransactionParams {
  readonly userId: string
  readonly stripeTransactionId: string
  readonly type: "subscription" | "topup"
  readonly amountUsd: number
  readonly creditsGranted: number
  readonly tier?: string
}

async function insertTransaction(params: InsertTransactionParams): Promise<void> {
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

// ── Top-up Refund / Dispute Clawback (payg NET-lifetime, design §4.1a) ──

export interface TopupClawbackRefund {
  /** Stripe refund id (re_...) or dispute id (dp_...) — the idempotency key. */
  readonly refundId: string
  /** Refunded amount in cents for THIS refund/dispute (not cumulative). */
  readonly amountCents: number
}

export interface TopupClawbackData {
  /** The payment intent the original top-up claim was keyed by. */
  readonly paymentIntentId: string | null
  readonly refunds: readonly TopupClawbackRefund[]
}

/**
 * Claw back credits for a refunded/disputed top-up. Per refund/dispute id:
 * one idempotent `clawback_topup_credits` RPC call (claim row per id, both
 * pools clamped at zero — a fully-refunded user drops out of payg). Credits
 * are proportional to the refunded amount, so partial refunds claw partial
 * grants. Non-topup charges (subscription invoices) no-op here — the
 * transactions lookup only matches type='topup' claims.
 *
 * Admin comps are NOT reachable from this path: comps never write a
 * transactions claim, so there is nothing to claw and lifetime is untouched.
 */
export async function handleTopupClawback(data: TopupClawbackData): Promise<void> {
  if (!data.paymentIntentId || data.refunds.length === 0) return

  const { data: claim } = await supabase
    .from("transactions")
    .select("user_id, credits_granted, amount_usd")
    .eq("stripe_transaction_id", data.paymentIntentId)
    .eq("type", "topup")
    .single()

  if (!claim || !claim.user_id) {
    // Not a top-up we granted (e.g. a subscription invoice charge) — ignore.
    return
  }

  const grantedCredits = (claim.credits_granted as number) ?? 0
  const amountUsd = Number(claim.amount_usd ?? 0)
  if (grantedCredits <= 0 || amountUsd <= 0) return

  let clawedAny = false
  for (const refund of data.refunds) {
    const refundUsd = refund.amountCents / 100
    const credits = Math.min(
      grantedCredits,
      Math.max(1, Math.round((grantedCredits * refundUsd) / amountUsd))
    )
    const { data: clawed, error } = await supabase.rpc("clawback_topup_credits", {
      p_user_id: claim.user_id,
      p_refund_id: refund.refundId,
      p_credits: credits,
      p_amount_usd: refundUsd,
    })
    if (error) {
      console.error("[stripe] clawback_topup_credits failed:", refund.refundId, error.message)
      continue
    }
    if (clawed === true) {
      clawedAny = true
      console.log(
        `[stripe] clawback: user=${claim.user_id} refund=${refund.refundId} -${credits} credits`
      )
    }
  }

  if (clawedAny) {
    invalidateBalanceCache(claim.user_id as string)
    // NET lifetime may have hit zero — collapse the payg storage floor.
    await reapplyStorageFloorAfterClawback(claim.user_id as string)
  }
}

// ── Auto-Recharge PaymentIntent Handlers (design §5.2 step 4) ────

/**
 * payment_intent.succeeded for kind="auto_recharge" ONLY (checkout-created
 * PIs carry no such metadata and are granted by checkout.session.completed —
 * letting them in here would double-grant). The grant is sized from
 * `amount_received` through the load rate function — metadata never sizes a
 * grant — and claims idempotently by the PI id.
 */
export async function handleAutoRechargeSucceeded(data: {
  readonly piId: string
  readonly userId: string | null
  readonly amountReceivedCents: number
}): Promise<void> {
  if (!data.userId) {
    console.error("[stripe] auto-recharge succeeded without userId metadata:", data.piId)
    return
  }
  if (data.amountReceivedCents <= 0 || data.amountReceivedCents % 100 !== 0) {
    console.error("[stripe] auto-recharge with non-whole-dollar amount:", data.piId, data.amountReceivedCents)
    return
  }
  let credits: number
  try {
    credits = creditsForLoadUsd(data.amountReceivedCents / 100)
  } catch (err) {
    console.error("[stripe] auto-recharge amount rejected by rate function:", data.piId, (err as Error).message)
    return
  }

  const { data: granted, error } = await supabase.rpc("grant_topup_credits_idempotent", {
    p_user_id: data.userId,
    p_credits: credits,
    p_stripe_transaction_id: data.piId,
    p_amount_usd: data.amountReceivedCents / 100,
  })
  if (error) {
    console.error("[stripe] auto-recharge grant failed:", data.piId, error.message)
    return
  }
  if (granted === false) {
    console.log("[stripe] auto-recharge already granted (idempotent):", data.piId)
    return
  }

  // A successful charge proves the card works again — clear the failure
  // streak so one old transient decline can't push a healthy config to the
  // auto-disable threshold.
  await supabase
    .from("profiles")
    .update({ auto_recharge_failure_count: 0 })
    .eq("id", data.userId)

  invalidateBalanceCache(data.userId)
  await raiseStorageFloorOnActivation(data.userId)
  void captureReceiptUrl(data.piId)
  console.log(`[stripe] auto-recharge granted: user=${data.userId} +${credits} credits (${data.piId})`)
}

/** payment_intent.payment_failed for kind="auto_recharge": count the failure
 *  (auto-disables at 3 inside the RPC). The user-facing signal is the
 *  failure state on the billing page's auto-recharge card. */
export async function handleAutoRechargeFailed(data: {
  readonly userId: string | null
}): Promise<void> {
  if (!data.userId) return
  const { data: count, error } = await supabase.rpc("record_auto_recharge_failure", {
    p_user_id: data.userId,
  })
  if (error) {
    console.error("[stripe] auto-recharge failure recording failed:", data.userId, error.message)
    return
  }
  console.warn(`[stripe] auto-recharge payment failed: user=${data.userId} (failure #${count})`)
}
