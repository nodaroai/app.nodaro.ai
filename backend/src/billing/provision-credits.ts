/**
 * Stripe Credit Provisioning Service
 *
 * Helper functions called by the Stripe webhook handler to manage
 * subscriptions, tiers, and credit allocations.
 * All DB operations use the Supabase service-role client.
 */

import { supabase } from "../lib/supabase.js"
import {
  getTierFromPriceId,
  getTopupCredits,
  TIER_CREDITS,
  TIER_STORAGE_LIMITS,
} from "./stripe-config.js"
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
      tier,
      subscription_credits: credits,
      credits_reset_at: new Date().toISOString(),
      storage_limit_bytes: storageLimit,
      subscription_ended_at: null,
    })
    .eq("id", userId)

  if (profileError) {
    console.error("[stripe] subscription.created: profile update failed:", profileError.message)
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
}

// ── Subscription Updated ─────────────────────────────────────────

interface SubscriptionUpdatedData {
  readonly subscriptionId: string
  readonly stripeCustomerId: string
  readonly priceId: string
  readonly status: string
  readonly currentPeriodStart: string | null
  readonly currentPeriodEnd: string | null
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
    .select("id, stripe_price_id, tier, current_period_start")
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

  // Check if this is a renewal (billing period changed)
  const isRenewal = existing.current_period_start !== data.currentPeriodStart

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
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", data.subscriptionId)

  if (subError) {
    console.error("[stripe] subscription.updated: update failed:", subError.message)
  }

  // Update profile tier and storage
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      tier: newTier,
      storage_limit_bytes: storageLimit,
    })
    .eq("id", userId)

  if (profileError) {
    console.error("[stripe] subscription.updated: profile update failed:", profileError.message)
  }

  invalidateBalanceCache(userId)
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

  // Get current subscription credits to cap at free tier limit
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_credits")
    .eq("id", userId)
    .single()

  const currentSubCredits = profile?.subscription_credits ?? 0
  const freeCredits = TIER_CREDITS.free ?? 0
  const cappedCredits = Math.min(currentSubCredits, freeCredits)

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      tier: "free",
      subscription_credits: cappedCredits,
      storage_limit_bytes: TIER_STORAGE_LIMITS.free,
      subscription_ended_at: now,
    })
    .eq("id", userId)

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

  // Idempotency: check if this transaction already exists
  const { data: existing } = await supabase
    .from("transactions")
    .select("id")
    .eq("stripe_transaction_id", data.transactionId)
    .single()

  if (existing) {
    console.log("[stripe] transaction.completed: already processed, skipping", data.transactionId)
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

  // Grant top-up credits
  const { error: rpcError } = await supabase.rpc("add_topup_credits", {
    p_user_id: userId,
    p_credits: totalCredits,
  })

  if (rpcError) {
    console.error("[stripe] transaction.completed: add_topup_credits failed:", rpcError.message)
    return
  }

  // Record transaction
  await insertTransaction({
    userId,
    stripeTransactionId: data.transactionId,
    type: "topup",
    amountUsd: data.totalAmount / 100, // Stripe amounts in cents
    creditsGranted: totalCredits,
  })

  invalidateBalanceCache(userId)

  console.log(`[stripe] transaction.completed: user=${userId} topup +${totalCredits} credits`)
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
