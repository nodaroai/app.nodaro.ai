import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { CreditsService, invalidateModelPricingCache } from "../billing/credits.js"
import { invalidateBalanceCache } from "./credits.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { TIER_CREDITS } from "../billing/paddle-config.js"

export async function adminCreditsRoutes(app: FastifyInstance) {
  // GET /v1/admin/users - List all users with credit info (paginated)
  app.get("/v1/admin/users", { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10) || 50))
    const offset = Math.max(0, parseInt(query.offset ?? "0", 10) || 0)
    const search = query.search?.trim() ?? null

    let dbQuery = supabase
      .from("profiles")
      .select("id, display_name, avatar_url, subscription_tier, subscription_credits, topup_credits, daily_spent_credits, storage_used_bytes, storage_limit_bytes, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (search) {
      // Sanitize special PostgREST filter characters to prevent filter injection
      const sanitized = search.replace(/[%_,().\\]/g, "")
      if (sanitized.length > 0) {
        dbQuery = dbQuery.or(`display_name.ilike.%${sanitized}%,email.ilike.%${sanitized}%`)
      }
    }

    const { data, count, error } = await dbQuery

    if (error) return reply.code(500).send({ error: error.message })

    const users = (data ?? []).map((u) => ({
      ...u,
      total_credits: (u.subscription_credits ?? 0) + (u.topup_credits ?? 0),
    }))

    return { data: users, total: count ?? 0, limit, offset }
  })

  // GET /v1/admin/users/:id/balance - Get detailed balance for a user
  app.get("/v1/admin/users/:id/balance", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const balance = await CreditsService.getBalance(id)
      return balance
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message })
    }
  })

  // POST /v1/admin/users/:id/credits - Admin adjust credits
  app.post("/v1/admin/users/:id/credits", { preHandler: requireAdmin }, async (request, reply) => {
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
      invalidateBalanceCache(id)
      return result
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message })
    }
  })

  // GET /v1/admin/users/:id/transactions - Credit transaction history
  app.get("/v1/admin/users/:id/transactions", { preHandler: requireAdmin }, async (request, reply) => {
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

  // PUT /v1/admin/users/:id/tier - Admin change user tier
  app.put("/v1/admin/users/:id/tier", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { tier, adminUserId } = request.body as {
      tier: string
      adminUserId: string
    }

    const VALID_TIERS = ["free", "basic", "standard", "pro", "business"]
    if (!tier || !VALID_TIERS.includes(tier)) {
      return reply.code(400).send({ error: `Invalid tier. Must be one of: ${VALID_TIERS.join(", ")}` })
    }
    if (!adminUserId) {
      return reply.code(400).send({ error: "Missing required field: adminUserId" })
    }

    // Fetch current profile
    const { data: profile, error: fetchError } = await supabase
      .from("profiles")
      .select("subscription_tier, subscription_credits, topup_credits")
      .eq("id", id)
      .single()

    if (fetchError || !profile) {
      return reply.code(404).send({ error: "User not found" })
    }

    const oldTier = profile.subscription_tier ?? "free"
    if (oldTier === tier) {
      return reply.code(200).send({ message: "Tier unchanged", tier })
    }

    const newCredits = TIER_CREDITS[tier] ?? 50

    // Update tier + reset subscription credits
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        subscription_tier: tier,
        tier,
        subscription_credits: newCredits,
      })
      .eq("id", id)

    if (updateError) {
      return reply.code(500).send({ error: updateError.message })
    }

    // Log transaction for the credit reset
    const totalAfter = newCredits + (profile.topup_credits ?? 0)
    const creditDelta = newCredits - (profile.subscription_credits ?? 0)

    try {
      await CreditsService.adminAdjustCredits({
        userId: id,
        amount: 0,
        creditType: "subscription",
        description: `Tier changed from ${oldTier} to ${tier} (credits reset to ${newCredits})`,
        adminUserId,
      })
    } catch {
      // Transaction log failure is non-critical; tier already updated
    }

    invalidateBalanceCache(id)
    return { tier, subscription_credits: newCredits, total_credits: totalAfter, credit_delta: creditDelta }
  })

  // PUT /v1/admin/users/:id/storage - Admin change user storage limit
  app.put("/v1/admin/users/:id/storage", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { storageLimitBytes, adminUserId } = request.body as {
      storageLimitBytes: number
      adminUserId: string
    }

    if (!storageLimitBytes || storageLimitBytes <= 0) {
      return reply.code(400).send({ error: "storageLimitBytes must be a positive number" })
    }
    if (!adminUserId) {
      return reply.code(400).send({ error: "Missing required field: adminUserId" })
    }

    // Fetch current limit
    const { data: profile, error: fetchError } = await supabase
      .from("profiles")
      .select("storage_limit_bytes")
      .eq("id", id)
      .single()

    if (fetchError || !profile) {
      return reply.code(404).send({ error: "User not found" })
    }

    const previousLimit = profile.storage_limit_bytes ?? 0

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ storage_limit_bytes: storageLimitBytes })
      .eq("id", id)

    if (updateError) {
      return reply.code(500).send({ error: updateError.message })
    }

    return { storage_limit_bytes: storageLimitBytes, previous_limit: previousLimit }
  })

  // PUT /v1/admin/users/:id/role - Admin change user role (super_admin only)
  app.put("/v1/admin/users/:id/role", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { role } = request.body as {
      role: string
    }

    const VALID_ROLES = ["user", "admin", "super_admin"]
    if (!role || !VALID_ROLES.includes(role)) {
      return reply.code(400).send({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` })
    }

    // Verify requesting user is super_admin
    const { data: adminProfile, error: adminError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", request.userId!)
      .single()

    if (adminError || !adminProfile) {
      return reply.code(403).send({ error: "Admin user not found" })
    }
    if (adminProfile.role !== "super_admin") {
      return reply.code(403).send({ error: "Only super_admin can change user roles" })
    }

    // Prevent self-demotion
    if (request.userId === id) {
      return reply.code(400).send({ error: "Cannot change your own role" })
    }

    // Protect the original super_admin (owner)
    const OWNER_EMAIL = "[email removed]"
    const { data: targetProfile, error: targetError } = await supabase
      .from("profiles")
      .select("email, role")
      .eq("id", id)
      .single()

    if (targetError || !targetProfile) {
      return reply.code(404).send({ error: "User not found" })
    }
    if (targetProfile.email === OWNER_EMAIL) {
      return reply.code(403).send({ error: "Cannot change the role of the platform owner" })
    }

    const previousRole = targetProfile.role ?? "user"
    if (previousRole === role) {
      return reply.code(200).send({ message: "Role unchanged", role })
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", id)

    if (updateError) {
      return reply.code(500).send({ error: updateError.message })
    }

    return { role, previous_role: previousRole }
  })

  // GET /v1/admin/models - List all models with pricing
  app.get("/v1/admin/models", { preHandler: requireAdmin }, async (request, reply) => {
    const { data, error } = await supabase
      .from("model_pricing")
      .select("*")
      .order("credit_cost", { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // PUT /v1/admin/models/:identifier/pricing - Update model pricing
  app.put("/v1/admin/models/:identifier/pricing", { preHandler: requireAdmin }, async (request, reply) => {
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
    invalidateModelPricingCache()
    return data
  })

  // GET /v1/admin/credits/summary - Platform-wide credit stats
  app.get("/v1/admin/credits/summary", { preHandler: requireAdmin }, async (request, reply) => {
    // Use SQL aggregate RPC instead of fetching ALL profiles
    const { data, error } = await supabase.rpc("get_credit_summary")

    if (error || !data) {
      console.error("[admin-credits] get_credit_summary RPC failed:", error?.message)
      return { totalUsers: 0, totalCreditsOutstanding: 0, tierBreakdown: {}, totalTransactions: 0 }
    }

    const result = data as Record<string, unknown>
    return {
      totalUsers: result.totalUsers ?? 0,
      totalCreditsOutstanding: result.totalCreditsOutstanding ?? 0,
      tierBreakdown: (result.tierBreakdown as Record<string, number>) ?? {},
      totalTransactions: result.totalTransactions ?? 0,
    }
  })
}
