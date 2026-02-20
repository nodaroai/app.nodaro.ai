/**
 * Billing Routes
 *
 * GET  /v1/billing/subscription?userId=...      - Get current subscription
 * GET  /v1/billing/transactions?userId=...      - Get transaction history
 * POST /v1/billing/manage-subscription          - Get Paddle portal URL
 * POST /v1/billing/change-plan                  - Change subscription tier
 */

import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { paddle } from "../billing/paddle-client.js"
import { PRICE_TO_TIER, getTierFromPriceId, TIER_CREDITS, TIER_STORAGE_LIMITS } from "../billing/paddle-config.js"

export async function billingRoutes(app: FastifyInstance) {
  // Get current subscription for a user
  app.get("/v1/billing/subscription", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: "Authentication required" })
    }

    const { data, error } = await supabase
      .from("subscriptions")
      .select(
        "id, paddle_subscription_id, tier, status, paddle_price_id, current_period_start, current_period_end, canceled_at"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (error || !data) {
      return reply.status(200).send({ data: null })
    }

    return reply.send({ data })
  })

  // Get transaction history for a user
  app.get("/v1/billing/transactions", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: "Authentication required" })
    }

    const { data, error } = await supabase
      .from("transactions")
      .select(
        "id, paddle_transaction_id, type, amount_usd, credits_granted, tier, created_at"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) {
      console.error("[billing] Failed to fetch transactions:", error.message)
      return reply.status(500).send({ error: "Failed to fetch transactions" })
    }

    return reply.send({ data: data ?? [] })
  })

  // Create a Paddle customer portal session for subscription management
  app.post("/v1/billing/manage-subscription", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: "Authentication required" })
    }

    // Look up Paddle customer ID
    const { data: customer } = await supabase
      .from("paddle_customers")
      .select("paddle_customer_id")
      .eq("user_id", userId)
      .single()

    if (!customer) {
      return reply.status(404).send({ error: "No Paddle customer found for this user" })
    }

    // Get active subscription IDs for this customer
    const { data: subs } = await supabase
      .from("subscriptions")
      .select("paddle_subscription_id")
      .eq("user_id", userId)
      .in("status", ["active", "past_due", "paused"])

    const subscriptionIds = (subs ?? []).map((s) => s.paddle_subscription_id)

    try {
      const portalSession = await paddle.customerPortalSessions.create(
        customer.paddle_customer_id,
        subscriptionIds,
      )

      return reply.send({ data: { url: portalSession.urls.general.overview } })
    } catch (err) {
      console.error("[billing] Failed to create portal session:", (err as Error).message)
      return reply.status(500).send({ error: "Failed to create portal session" })
    }
  })

  // Change subscription plan (upgrade/downgrade via Paddle API)
  app.post("/v1/billing/change-plan", async (req, reply) => {
    const userId = req.userId
    const { newPriceId } = req.body as {
      newPriceId?: string
    }

    if (!userId || !newPriceId) {
      return reply.status(400).send({ error: "Authentication and newPriceId are required" })
    }

    // Only allow known subscription price IDs (reject topup IDs)
    if (!PRICE_TO_TIER[newPriceId]) {
      return reply.status(400).send({ error: "Invalid price ID" })
    }

    // Find active subscription
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("paddle_subscription_id, paddle_price_id, status")
      .eq("user_id", userId)
      .in("status", ["active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (!sub) {
      return reply.status(404).send({ error: "No active subscription found" })
    }

    if (sub.paddle_price_id === newPriceId) {
      return reply.status(400).send({ error: "Already on this plan" })
    }

    try {
      const updated = await paddle.subscriptions.update(
        sub.paddle_subscription_id,
        {
          items: [{ priceId: newPriceId, quantity: 1 }],
          prorationBillingMode: "prorated_immediately",
        }
      )

      const newTier = getTierFromPriceId(newPriceId)
      const newCredits = TIER_CREDITS[newTier] ?? 50
      const newStorageLimit = TIER_STORAGE_LIMITS[newTier] ?? TIER_STORAGE_LIMITS.free

      // Immediate local DB update so users see changes right away
      // (webhook will reconcile later as a backup)
      const { error: subUpdateError, count: subCount } = await supabase
        .from("subscriptions")
        .update({
          paddle_price_id: newPriceId,
          tier: newTier,
        })
        .eq("paddle_subscription_id", sub.paddle_subscription_id)

      if (subUpdateError) {
        console.error("[billing] change-plan: subscriptions update failed:", subUpdateError.message)
      }
      console.log(`[billing] change-plan: subscriptions updated ${subCount ?? "unknown"} rows for paddle_sub=${sub.paddle_subscription_id}, newTier=${newTier}`)

      const { error: profileUpdateError } = await supabase
        .from("profiles")
        .update({
          tier: newTier,
          subscription_credits: newCredits,
          storage_limit_bytes: newStorageLimit,
        })
        .eq("id", userId)

      if (profileUpdateError) {
        console.error("[billing] change-plan: profiles update failed:", profileUpdateError.message)
      }
      console.log(`[billing] change-plan: profile updated for user=${userId}, tier=${newTier}, credits=${newCredits}, storage=${newStorageLimit}`)

      return reply.send({
        data: { subscriptionId: updated.id, tier: newTier },
      })
    } catch (err) {
      console.error("[billing] Failed to change plan:", (err as Error).message)
      return reply.status(500).send({ error: "Failed to change plan" })
    }
  })
}
