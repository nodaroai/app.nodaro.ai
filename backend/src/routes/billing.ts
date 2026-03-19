/**
 * Billing Routes
 *
 * GET  /v1/billing/subscription          - Get current subscription
 * GET  /v1/billing/transactions           - Get transaction history
 * POST /v1/billing/create-checkout-session - Create Stripe Checkout session
 * POST /v1/billing/manage-subscription    - Get Stripe Customer Portal URL
 * POST /v1/billing/change-plan            - Change subscription tier
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { stripe } from "../billing/stripe-client.js"
import { PRICE_TO_PLAN, getTierFromPriceId, TIER_CREDITS, TIER_STORAGE_LIMITS, TOP_UPS } from "../billing/stripe-config.js"
import { ensureStripeCustomer } from "../billing/provision-credits.js"

/** Extract origin from request headers for redirect URLs. */
function getOrigin(req: { headers: Record<string, string | string[] | undefined> }): string {
  const origin = req.headers.origin
  const referer = req.headers.referer
  if (typeof origin === "string" && origin) return origin
  if (typeof referer === "string" && referer) {
    try { return new URL(referer).origin } catch { /* fall through */ }
  }
  return ""
}

const checkoutSessionSchema = z.object({
  priceId: z.string(),
  mode: z.enum(["subscription", "payment"]).optional(),
})

const changePlanSchema = z.object({
  newPriceId: z.string(),
})

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
        "id, stripe_subscription_id, tier, status, stripe_price_id, current_period_start, current_period_end, canceled_at"
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
        "id, stripe_transaction_id, type, amount_usd, credits_granted, tier, created_at"
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

  // Create a Stripe Checkout session for subscriptions or top-ups
  app.post("/v1/billing/create-checkout-session", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: "Authentication required" })
    }

    const parsed = checkoutSessionSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: "priceId is required" })
    }

    const { priceId, mode } = parsed.data
    const checkoutMode = mode ?? (PRICE_TO_PLAN[priceId] ? "subscription" : "payment")

    // Validate price ID
    if (checkoutMode === "subscription" && !PRICE_TO_PLAN[priceId]) {
      return reply.status(400).send({ error: "Invalid subscription price ID" })
    }
    if (checkoutMode === "payment" && !TOP_UPS[priceId]) {
      return reply.status(400).send({ error: "Invalid top-up price ID" })
    }

    try {
      // Ensure Stripe customer exists
      let stripeCustomerId: string | null = null

      const { data: existingCustomer } = await supabase
        .from("stripe_customers")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .single()

      if (existingCustomer) {
        stripeCustomerId = existingCustomer.stripe_customer_id
      } else {
        // Get user email from profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", userId)
          .single()

        const customer = await stripe.customers.create({
          email: profile?.email ?? undefined,
          metadata: { userId },
        })
        stripeCustomerId = customer.id
        await ensureStripeCustomer(customer.id, userId)
      }

      const baseUrl = getOrigin(req)
      const successUrl = checkoutMode === "payment"
        ? `${baseUrl}/billing?topup=true`
        : `${baseUrl}/billing?success=true`

      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId ?? undefined,
        mode: checkoutMode,
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: { userId },
        subscription_data: checkoutMode === "subscription" ? { metadata: { userId } } : undefined,
        allow_promotion_codes: true,
        success_url: successUrl,
        cancel_url: `${baseUrl}/pricing`,
      })

      return reply.send({ data: { url: session.url } })
    } catch (err) {
      console.error("[billing] Failed to create checkout session:", (err as Error).message)
      return reply.status(500).send({ error: "Failed to create checkout session" })
    }
  })

  // Create a Stripe Customer Portal session for subscription management
  app.post("/v1/billing/manage-subscription", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: "Authentication required" })
    }

    // Look up Stripe customer ID
    const { data: customer } = await supabase
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .single()

    if (!customer) {
      return reply.status(404).send({ error: "No Stripe customer found for this user" })
    }

    try {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customer.stripe_customer_id,
        return_url: `${getOrigin(req)}/billing`,
      })

      return reply.send({ data: { url: portalSession.url } })
    } catch (err) {
      console.error("[billing] Failed to create portal session:", (err as Error).message)
      return reply.status(500).send({ error: "Failed to create portal session" })
    }
  })

  // Change subscription plan (upgrade/downgrade via Stripe API)
  app.post("/v1/billing/change-plan", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(400).send({ error: "Authentication and newPriceId are required" })
    }

    const parsed = changePlanSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: "Authentication and newPriceId are required" })
    }

    const { newPriceId } = parsed.data

    // Only allow known subscription price IDs (reject topup IDs)
    if (!PRICE_TO_PLAN[newPriceId]) {
      return reply.status(400).send({ error: "Invalid price ID" })
    }

    // Find active subscription
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id, stripe_price_id, status")
      .eq("user_id", userId)
      .in("status", ["active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (!sub) {
      return reply.status(404).send({ error: "No active subscription found" })
    }

    if (sub.stripe_price_id === newPriceId) {
      return reply.status(400).send({ error: "Already on this plan" })
    }

    try {
      // Get the subscription to find the item ID
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id)
      const itemId = stripeSub.items.data[0]?.id
      if (!itemId) {
        return reply.status(500).send({ error: "Could not find subscription item" })
      }

      const updated = await stripe.subscriptions.update(
        sub.stripe_subscription_id,
        {
          items: [{ id: itemId, price: newPriceId }],
          proration_behavior: "create_prorations",
        }
      )

      const newTier = getTierFromPriceId(newPriceId)
      const newCredits = TIER_CREDITS[newTier] ?? 0
      const newStorageLimit = TIER_STORAGE_LIMITS[newTier] ?? TIER_STORAGE_LIMITS.free

      // Immediate local DB update so users see changes right away
      // (webhook will reconcile later as a backup)
      const { error: subUpdateError } = await supabase
        .from("subscriptions")
        .update({
          stripe_price_id: newPriceId,
          tier: newTier,
        })
        .eq("stripe_subscription_id", sub.stripe_subscription_id)

      if (subUpdateError) {
        console.error("[billing] change-plan: subscriptions update failed:", subUpdateError.message)
      }

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
      console.log(`[billing] change-plan: profile updated for user=${userId}, tier=${newTier}, credits=${newCredits}`)

      return reply.send({
        data: { subscriptionId: updated.id, tier: newTier },
      })
    } catch (err) {
      console.error("[billing] Failed to change plan:", (err as Error).message)
      return reply.status(500).send({ error: "Failed to change plan" })
    }
  })
}
