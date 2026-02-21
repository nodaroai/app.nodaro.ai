/**
 * Paddle Credit Provisioning Service
 *
 * Helper functions called by the Paddle webhook handler to manage
 * subscriptions, tiers, and credit allocations.
 * All DB operations use the Supabase service-role client.
 */

import { supabase } from "../lib/supabase.js"
import {
  getTierFromPriceId,
  getTopupCredits,
  TIER_CREDITS,
  TIER_STORAGE_LIMITS,
} from "./paddle-config.js"
import { invalidateBalanceCache } from "../routes/credits.js"

// ── Paddle Customer Mapping ──────────────────────────────────────

export async function getUserIdFromPaddleCustomer(
  paddleCustomerId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("paddle_customers")
    .select("user_id")
    .eq("paddle_customer_id", paddleCustomerId)
    .single()
  return data?.user_id ?? null
}

export async function ensurePaddleCustomer(
  paddleCustomerId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("paddle_customers")
    .upsert(
      { paddle_customer_id: paddleCustomerId, user_id: userId },
      { onConflict: "paddle_customer_id" }
    )
  if (error) {
    console.error("[paddle] Failed to upsert paddle_customers:", error.message)
  }
}

// ── Resolve userId from event (customer lookup + custom_data fallback) ──

export async function resolveUserId(
  paddleCustomerId: string,
  customData: Record<string, unknown> | null
): Promise<string | null> {
  const userId = await getUserIdFromPaddleCustomer(paddleCustomerId)
  if (userId) return userId

  const fallbackUserId = customData?.userId as string | undefined
  if (fallbackUserId) {
    await ensurePaddleCustomer(paddleCustomerId, fallbackUserId)
    return fallbackUserId
  }

  return null
}

// ── Subscription Created ─────────────────────────────────────────

interface SubscriptionCreatedData {
  readonly subscriptionId: string
  readonly paddleCustomerId: string
  readonly priceId: string
  readonly status: string
  readonly currentPeriodStart: string | null
  readonly currentPeriodEnd: string | null
  readonly customData: Record<string, unknown> | null
  readonly transactionId?: string
  readonly amountUsd?: number
}

export async function handleSubscriptionCreated(
  data: SubscriptionCreatedData
): Promise<void> {
  const userId = await resolveUserId(data.paddleCustomerId, data.customData)
  if (!userId) {
    console.error("[paddle] subscription.created: cannot resolve userId for customer", data.paddleCustomerId)
    return
  }

  const tier = getTierFromPriceId(data.priceId)
  const credits = TIER_CREDITS[tier] ?? 50
  const storageLimit = TIER_STORAGE_LIMITS[tier] ?? TIER_STORAGE_LIMITS.free

  // Idempotent: skip if subscription already exists
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("paddle_subscription_id", data.subscriptionId)
    .single()

  if (existing) {
    console.log("[paddle] subscription.created: already exists, skipping", data.subscriptionId)
    return
  }

  // Insert subscription record
  const { error: subError } = await supabase
    .from("subscriptions")
    .insert({
      user_id: userId,
      paddle_subscription_id: data.subscriptionId,
      paddle_price_id: data.priceId,
      tier,
      status: data.status,
      current_period_start: data.currentPeriodStart,
      current_period_end: data.currentPeriodEnd,
    })

  if (subError) {
    console.error("[paddle] subscription.created: insert failed:", subError.message)
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
    console.error("[paddle] subscription.created: profile update failed:", profileError.message)
  }

  invalidateBalanceCache(userId)

  // Insert transaction record (if transaction info provided)
  if (data.transactionId) {
    await insertTransaction({
      userId,
      paddleTransactionId: data.transactionId,
      type: "subscription",
      amountUsd: data.amountUsd ?? 0,
      creditsGranted: credits,
      tier,
    })
  }

  console.log(`[paddle] subscription.created: user=${userId} tier=${tier} credits=${credits}`)
}

// ── Subscription Updated ─────────────────────────────────────────

interface SubscriptionUpdatedData {
  readonly subscriptionId: string
  readonly paddleCustomerId: string
  readonly priceId: string
  readonly status: string
  readonly currentPeriodStart: string | null
  readonly currentPeriodEnd: string | null
  readonly customData: Record<string, unknown> | null
}

export async function handleSubscriptionUpdated(
  data: SubscriptionUpdatedData
): Promise<void> {
  const userId = await resolveUserId(data.paddleCustomerId, data.customData)
  if (!userId) {
    console.error("[paddle] subscription.updated: cannot resolve userId for customer", data.paddleCustomerId)
    return
  }

  // Look up existing subscription
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id, paddle_price_id, tier, current_period_start")
    .eq("paddle_subscription_id", data.subscriptionId)
    .single()

  if (!existing) {
    console.warn("[paddle] subscription.updated: subscription not found", data.subscriptionId)
    return
  }

  const newTier = getTierFromPriceId(data.priceId)
  const oldTier = existing.tier
  const newCredits = TIER_CREDITS[newTier] ?? 50
  const oldCredits = TIER_CREDITS[oldTier] ?? 50
  const storageLimit = TIER_STORAGE_LIMITS[newTier] ?? TIER_STORAGE_LIMITS.free

  // Check if this is a tier change (upgrade/downgrade)
  const tierChanged = existing.paddle_price_id !== data.priceId

  // Check if this is a renewal (billing period changed)
  const isRenewal = existing.current_period_start !== data.currentPeriodStart

  if (tierChanged) {
    // Idempotent SET (not ADD) — safe if change-plan endpoint already updated credits
    const isUpgrade = newCredits > oldCredits
    const { error: creditError } = await supabase
      .from("profiles")
      .update({ subscription_credits: newCredits })
      .eq("id", userId)

    if (creditError) {
      console.error("[paddle] subscription.updated: credit SET failed:", creditError.message)
    }

    if (isUpgrade) {
      console.log(`[paddle] subscription.updated: upgrade ${oldTier}->${newTier}, set credits to ${newCredits}`)
    } else {
      console.log(`[paddle] subscription.updated: downgrade ${oldTier}->${newTier}, set credits to ${newCredits}`)
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
      console.error("[paddle] subscription.updated: credit reset failed:", resetError.message)
    } else {
      console.log(`[paddle] subscription.updated: renewal, reset credits to ${newCredits}`)
    }
  }

  // Update subscription record
  const { error: subError } = await supabase
    .from("subscriptions")
    .update({
      paddle_price_id: data.priceId,
      tier: newTier,
      status: data.status,
      current_period_start: data.currentPeriodStart,
      current_period_end: data.currentPeriodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq("paddle_subscription_id", data.subscriptionId)

  if (subError) {
    console.error("[paddle] subscription.updated: update failed:", subError.message)
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
    console.error("[paddle] subscription.updated: profile update failed:", profileError.message)
  }

  invalidateBalanceCache(userId)
}

// ── Subscription Canceled ────────────────────────────────────────

interface SubscriptionCanceledData {
  readonly subscriptionId: string
  readonly paddleCustomerId: string
  readonly currentPeriodEnd: string | null
  readonly customData: Record<string, unknown> | null
}

export async function handleSubscriptionCanceled(
  data: SubscriptionCanceledData
): Promise<void> {
  const userId = await resolveUserId(data.paddleCustomerId, data.customData)
  const now = new Date().toISOString()

  // Update subscription status
  const { error: subError } = await supabase
    .from("subscriptions")
    .update({
      status: "canceled",
      canceled_at: now,
      updated_at: now,
    })
    .eq("paddle_subscription_id", data.subscriptionId)

  if (subError) {
    console.error("[paddle] subscription.canceled: update failed:", subError.message)
  }

  if (!userId) {
    console.error("[paddle] subscription.canceled: cannot resolve userId for customer", data.paddleCustomerId)
    return
  }

  // When subscription.canceled fires, the subscription is definitively over:
  // - Immediate cancellations: Paddle fires this right away
  // - End-of-period cancellations: Paddle fires this when the period ends
  // In both cases, downgrade the user to free tier now.

  // Get current subscription credits to cap at free tier limit
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_credits")
    .eq("id", userId)
    .single()

  const currentSubCredits = profile?.subscription_credits ?? 0
  const freeCredits = TIER_CREDITS.free ?? 50
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
    console.error("[paddle] subscription.canceled: profile downgrade failed:", profileError.message)
  }

  invalidateBalanceCache(userId)

  console.log(
    `[paddle] subscription.canceled: sub=${data.subscriptionId} user=${userId} downgraded to free (credits: ${cappedCredits})`
  )
}

// ── Subscription Status Updates (past_due, paused, resumed) ──────

export async function updateSubscriptionStatus(
  subscriptionId: string,
  status: string
): Promise<void> {
  const { error } = await supabase
    .from("subscriptions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("paddle_subscription_id", subscriptionId)

  if (error) {
    console.error(`[paddle] subscription.${status}: update failed:`, error.message)
  } else {
    console.log(`[paddle] subscription.${status}: sub=${subscriptionId}`)
  }
}

// ── Transaction Completed (top-ups) ──────────────────────────────

interface TransactionCompletedData {
  readonly transactionId: string
  readonly paddleCustomerId: string | null
  readonly subscriptionId: string | null
  readonly items: ReadonlyArray<{ priceId: string }>
  readonly totalAmount: number
  readonly customData: Record<string, unknown> | null
}

export async function handleTransactionCompleted(
  data: TransactionCompletedData
): Promise<void> {
  // Skip subscription-related transactions (handled by subscription events)
  if (data.subscriptionId) {
    console.log("[paddle] transaction.completed: subscription tx, skipping", data.transactionId)
    return
  }

  // Idempotency: check if this transaction already exists
  const { data: existing } = await supabase
    .from("transactions")
    .select("id")
    .eq("paddle_transaction_id", data.transactionId)
    .single()

  if (existing) {
    console.log("[paddle] transaction.completed: already processed, skipping", data.transactionId)
    return
  }

  // Find top-up price in items
  let totalCredits = 0
  for (const item of data.items) {
    const credits = getTopupCredits(item.priceId)
    if (credits) {
      totalCredits += credits
    }
  }

  if (totalCredits === 0) {
    console.log("[paddle] transaction.completed: no top-up items found", data.transactionId)
    return
  }

  // Resolve user
  const userId = data.paddleCustomerId
    ? await resolveUserId(data.paddleCustomerId, data.customData)
    : (data.customData?.userId as string | undefined) ?? null

  if (!userId) {
    console.error("[paddle] transaction.completed: cannot resolve userId for tx", data.transactionId)
    return
  }

  // Grant top-up credits
  const { error: rpcError } = await supabase.rpc("add_topup_credits", {
    p_user_id: userId,
    p_credits: totalCredits,
  })

  if (rpcError) {
    console.error("[paddle] transaction.completed: add_topup_credits failed:", rpcError.message)
    return
  }

  // Record transaction
  await insertTransaction({
    userId,
    paddleTransactionId: data.transactionId,
    type: "topup",
    amountUsd: data.totalAmount / 100, // Paddle amounts in cents
    creditsGranted: totalCredits,
  })

  invalidateBalanceCache(userId)

  console.log(`[paddle] transaction.completed: user=${userId} topup +${totalCredits} credits`)
}

// ── Shared: Insert Transaction Record ────────────────────────────

interface InsertTransactionParams {
  readonly userId: string
  readonly paddleTransactionId: string
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
        paddle_transaction_id: params.paddleTransactionId,
        type: params.type,
        amount_usd: params.amountUsd,
        credits_granted: params.creditsGranted,
        tier: params.tier ?? null,
      },
      { onConflict: "paddle_transaction_id" }
    )

  if (error) {
    console.error("[paddle] insertTransaction failed:", error.message)
  }
}
