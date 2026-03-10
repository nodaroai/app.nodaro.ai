import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"

export async function adminCreditAuditRoutes(app: FastifyInstance) {
  // GET /v1/admin/credit-audit - List recent audit entries
  // Query params: ?mismatch=true&model=kling-3.0&limit=50&offset=0
  app.get("/v1/admin/credit-audit", { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10) || 50))
    const offset = Math.max(0, parseInt(query.offset ?? "0", 10) || 0)
    const mismatchOnly = query.mismatch === "true"
    const modelFilter = query.model?.trim() ?? null

    let dbQuery = supabase
      .from("credit_cost_audit")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (mismatchOnly) {
      dbQuery = dbQuery.eq("mismatch", true)
    }
    if (modelFilter) {
      dbQuery = dbQuery.eq("model_key", modelFilter)
    }

    const { data, count, error } = await dbQuery
    if (error) return reply.code(500).send({ error: error.message })

    return { data: data ?? [], total: count ?? 0, limit, offset }
  })

  // GET /v1/admin/credit-audit/summary - Aggregated mismatch summary by model
  app.get("/v1/admin/credit-audit/summary", { preHandler: requireAdmin }, async (request, reply) => {
    // Get count of mismatches per model in the last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from("credit_cost_audit")
      .select("model_key, mismatch")
      .gte("created_at", thirtyDaysAgo)

    if (error) return reply.code(500).send({ error: error.message })

    // Aggregate in-memory (simpler than custom RPC for this admin-only endpoint)
    const summary: Record<string, { total: number; mismatches: number }> = {}
    for (const row of data ?? []) {
      if (!summary[row.model_key]) {
        summary[row.model_key] = { total: 0, mismatches: 0 }
      }
      summary[row.model_key].total++
      if (row.mismatch) summary[row.model_key].mismatches++
    }

    const models = Object.entries(summary)
      .map(([model, stats]) => ({
        model,
        total: stats.total,
        mismatches: stats.mismatches,
        mismatchRate: stats.total > 0 ? (stats.mismatches / stats.total * 100).toFixed(1) + "%" : "0%",
      }))
      .sort((a, b) => b.mismatches - a.mismatches)

    return { data: models, period: "30d" }
  })
}
