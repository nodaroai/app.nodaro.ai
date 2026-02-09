/**
 * Billing Routes
 *
 * GET  /v1/billing/subscription?userId=...      - Get current subscription
 * GET  /v1/billing/transactions?userId=...      - Get transaction history
 * POST /v1/billing/manage-subscription          - Get Paddle portal URL
 */

import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { paddle } from "../billing/paddle-client.js"

export async function billingRoutes(app: FastifyInstance) {
  // Get current subscription for a user
  app.get("/v1/billing/subscription", async (req, reply) => {
    const { userId } = req.query as { userId?: string }
    if (!userId) {
      return reply.status(400).send({ error: "userId is required" })
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
    const { userId } = req.query as { userId?: string }
    if (!userId) {
      return reply.status(400).send({ error: "userId is required" })
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
    const { userId } = req.body as { userId?: string }
    if (!userId) {
      return reply.status(400).send({ error: "userId is required" })
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
}
