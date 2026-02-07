import { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { CreditsService } from "../billing/credits.js"

export async function adminCreditsRoutes(app: FastifyInstance) {
  // GET /v1/admin/users - List all users with credit info
  app.get("/v1/admin/users", async (_request, reply) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url, subscription_tier, subscription_credits, topup_credits, daily_spent_credits, created_at")
      .order("created_at", { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })

    return (data ?? []).map((u) => ({
      ...u,
      total_credits: (u.subscription_credits ?? 0) + (u.topup_credits ?? 0),
    }))
  })

  // GET /v1/admin/users/:id/balance - Get detailed balance for a user
  app.get("/v1/admin/users/:id/balance", async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const balance = await CreditsService.getBalance(id)
      return balance
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message })
    }
  })

  // POST /v1/admin/users/:id/credits - Admin adjust credits
  app.post("/v1/admin/users/:id/credits", async (request, reply) => {
    const { id } = request.params as { id: string }
    const { amount, creditType, description, adminUserId } = request.body as {
      amount: number
      creditType: "subscription" | "topup"
      description: string
      adminUserId: string
    }

    if (!amount || !creditType || !description || !adminUserId) {
      return reply.code(400).send({ error: "Missing required fields: amount, creditType, description, adminUserId" })
    }

    try {
      const result = await CreditsService.adminAdjustCredits({
        userId: id,
        amount,
        creditType,
        description,
        adminUserId,
      })
      return result
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message })
    }
  })

  // GET /v1/admin/users/:id/transactions - Credit transaction history
  app.get("/v1/admin/users/:id/transactions", async (request, reply) => {
    const { id } = request.params as { id: string }
    const { limit = 50, offset = 0 } = request.query as { limit?: number; offset?: number }

    const { data, error } = await supabase
      .from("credit_transactions")
      .select("*")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /v1/admin/models - List all models with pricing
  app.get("/v1/admin/models", async (_request, reply) => {
    const { data, error } = await supabase
      .from("model_pricing")
      .select("*")
      .order("credit_cost", { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // PUT /v1/admin/models/:identifier/pricing - Update model pricing
  app.put("/v1/admin/models/:identifier/pricing", async (request, reply) => {
    const { identifier } = request.params as { identifier: string }
    const { creditCost, isEnabled, tierRestriction } = request.body as {
      creditCost?: number
      isEnabled?: boolean
      tierRestriction?: string | null
    }

    const updates: Record<string, unknown> = {}
    if (creditCost !== undefined) updates.credit_cost = creditCost
    if (isEnabled !== undefined) updates.is_enabled = isEnabled
    if (tierRestriction !== undefined) updates.tier_restriction = tierRestriction

    const { data, error } = await supabase
      .from("model_pricing")
      .update(updates)
      .eq("model_identifier", identifier)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /v1/admin/credits/summary - Platform-wide credit stats
  app.get("/v1/admin/credits/summary", async (_request, reply) => {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("subscription_credits, topup_credits, subscription_tier")

    if (!profiles) {
      return { totalUsers: 0, totalCreditsOutstanding: 0, tierBreakdown: {}, totalTransactions: 0 }
    }

    const totalCreditsOutstanding = profiles.reduce(
      (sum, p) => sum + (p.subscription_credits ?? 0) + (p.topup_credits ?? 0), 0
    )

    const tierBreakdown: Record<string, number> = {}
    for (const p of profiles) {
      const tier = p.subscription_tier ?? "free"
      tierBreakdown[tier] = (tierBreakdown[tier] ?? 0) + 1
    }

    const { count: totalTransactions } = await supabase
      .from("credit_transactions")
      .select("id", { count: "exact", head: true })

    return {
      totalUsers: profiles.length,
      totalCreditsOutstanding,
      tierBreakdown,
      totalTransactions: totalTransactions ?? 0,
    }
  })
}
