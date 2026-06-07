import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { getStripe } from "../billing/stripe-client.js"
import { getTierFromPriceId } from "../billing/stripe-config.js"

// ============================================================
// Admin Subscription Health Routes
// ============================================================

interface SubscriptionIssue {
  userId: string
  email: string | null
  tier: string
  issueType: "stale_period" | "missing_subscription" | "orphan_subscription" | "tier_mismatch"
  description: string
  dbPeriodEnd: string | null
  stripePeriodEnd: string | null
  stripeSubscriptionId: string | null
}

export async function adminSubscriptionHealthRoutes(app: FastifyInstance) {
  /**
   * GET /v1/admin/subscription-health
   * Scan for subscription sync issues between DB and Stripe
   */
  app.get("/v1/admin/subscription-health", { preHandler: requireAdmin }, async (_req, reply) => {
    try {
      const issues: SubscriptionIssue[] = []

      // 1. Find paid users with stale or missing period_end
      const { data: paidProfiles, error: profileErr } = await supabase
        .from("profiles")
        .select("id, email, tier")
        .neq("tier", "free")

      if (profileErr) {
        return reply.status(500).send({ error: { message: "Failed to load profiles" } })
      }

      // 2. Load all active DB subscriptions
      const { data: dbSubs } = await supabase
        .from("subscriptions")
        .select("user_id, stripe_subscription_id, tier, status, current_period_end")
        .eq("status", "active")

      const dbSubsByUser = new Map<string, typeof dbSubs extends (infer T)[] | null ? T : never>()
      for (const sub of dbSubs ?? []) {
        dbSubsByUser.set(sub.user_id, sub)
      }

      // 3. Load stripe customer mappings for paid users
      const paidUserIds = (paidProfiles ?? []).map((p) => p.id)
      const { data: custRows } = await supabase
        .from("stripe_customers")
        .select("user_id, stripe_customer_id")
        .in("user_id", paidUserIds)

      const custByUser = new Map<string, string>()
      for (const row of custRows ?? []) {
        custByUser.set(row.user_id, row.stripe_customer_id)
      }

      const now = Date.now()

      for (const profile of paidProfiles ?? []) {
        const dbSub = dbSubsByUser.get(profile.id)
        const stripeCustomerId = custByUser.get(profile.id)

        // Missing DB subscription
        if (!dbSub) {
          const isStripeCustomer = stripeCustomerId?.startsWith("cus_")
          issues.push({
            userId: profile.id,
            email: profile.email,
            tier: profile.tier,
            issueType: "missing_subscription",
            description: isStripeCustomer
              ? "Paid user with Stripe customer but no active subscription in DB"
              : !stripeCustomerId
                ? "Paid user with no payment provider linked"
                : `Paid user with non-Stripe customer (${stripeCustomerId?.slice(0, 8)}...)`,
            dbPeriodEnd: null,
            stripePeriodEnd: null,
            stripeSubscriptionId: null,
          })
          continue
        }

        // Stale period end
        const dbEnd = dbSub.current_period_end
        if (dbEnd && new Date(dbEnd).getTime() < now) {
          issues.push({
            userId: profile.id,
            email: profile.email,
            tier: profile.tier,
            issueType: "stale_period",
            description: `DB period ended ${dbEnd}`,
            dbPeriodEnd: dbEnd,
            stripePeriodEnd: null,
            stripeSubscriptionId: dbSub.stripe_subscription_id,
          })
        }

        // Tier mismatch
        if (dbSub.tier !== profile.tier) {
          issues.push({
            userId: profile.id,
            email: profile.email,
            tier: profile.tier,
            issueType: "tier_mismatch",
            description: `Profile tier "${profile.tier}" ≠ subscription tier "${dbSub.tier}"`,
            dbPeriodEnd: dbEnd,
            stripePeriodEnd: null,
            stripeSubscriptionId: dbSub.stripe_subscription_id,
          })
        }
      }

      return { data: { issues, scannedUsers: paidProfiles?.length ?? 0 } }
    } catch (err) {
      console.error("[admin] subscription-health scan failed:", err)
      return reply.status(500).send({ error: { message: "Health check failed" } })
    }
  })

  /**
   * POST /v1/admin/subscription-health/sync
   * Sync a user's subscription from Stripe (self-heal)
   */
  const syncBody = z.object({ userId: z.string().uuid() })

  app.post("/v1/admin/subscription-health/sync", { preHandler: requireAdmin }, async (req, reply) => {
    const parsedBody = syncBody.safeParse(req.body)
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten().fieldErrors })
    }
    const { userId } = parsedBody.data

    // Look up Stripe customer
    const { data: custRow } = await supabase
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .single()

    if (!custRow?.stripe_customer_id) {
      return reply.status(404).send({ error: { message: "No payment provider linked to this user" } })
    }

    // Validate it's a Stripe customer ID (not Paddle or other provider)
    if (!custRow.stripe_customer_id.startsWith("cus_")) {
      return reply.status(400).send({
        error: { message: `Not a Stripe customer (${custRow.stripe_customer_id.slice(0, 12)}...). Cannot sync from Stripe.` },
      })
    }

    // Fetch active subscription from Stripe
    let subs
    try {
      subs = await getStripe().subscriptions.list({
        customer: custRow.stripe_customer_id,
        status: "active",
        limit: 1,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stripe API error"
      return reply.status(502).send({ error: { message: `Stripe API failed: ${msg}` } })
    }

    const activeSub = subs.data[0]
    if (!activeSub) {
      return reply.status(404).send({ error: { message: "No active Stripe subscription found" } })
    }

    const item = activeSub.items.data[0]
    if (!item) {
      return reply.status(404).send({ error: { message: "Subscription has no line items" } })
    }

    const freshStart = new Date(item.current_period_start * 1000).toISOString()
    const freshEnd = new Date(item.current_period_end * 1000).toISOString()
    const tier = getTierFromPriceId(item.price.id)

    // Upsert subscription
    await supabase
      .from("subscriptions")
      .upsert({
        user_id: userId,
        stripe_subscription_id: activeSub.id,
        stripe_price_id: item.price.id,
        tier,
        status: "active",
        current_period_start: freshStart,
        current_period_end: freshEnd,
      }, { onConflict: "stripe_subscription_id" })

    // Update profile
    await supabase
      .from("profiles")
      .update({ current_period_end: freshEnd, tier })
      .eq("id", userId)

    return {
      data: {
        synced: true,
        stripeSubscriptionId: activeSub.id,
        tier,
        periodStart: freshStart,
        periodEnd: freshEnd,
      },
    }
  })
}
