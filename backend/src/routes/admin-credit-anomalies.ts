import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"

export async function adminCreditAnomalyRoutes(app: FastifyInstance): Promise<void> {
  // List anomalies with pagination + filters
  app.get("/v1/admin/credit-anomalies", { preHandler: requireAdmin }, async (req, reply) => {
    const { offset = "0", limit = "50", status, anomalyType, model } = req.query as {
      offset?: string; limit?: string; status?: string; anomalyType?: string; model?: string
    }
    const from = parseInt(offset, 10)
    const size = Math.min(parseInt(limit, 10) || 50, 100)

    let query = supabase
      .from("credit_anomalies" as "assets")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + size - 1) as unknown as ReturnType<typeof supabase.from>

    if (status) query = (query as any).eq("status", status)
    if (anomalyType) query = (query as any).eq("anomaly_type", anomalyType)
    if (model) query = (query as any).ilike("model_identifier", `%${model}%`)

    const { data, error, count } = await (query as any)
    if (error) return reply.status(500).send({ error: { message: error.message } })

    // Fetch user emails for the anomalies
    const userIds = [...new Set((data ?? []).map((a: any) => a.user_id))]
    const { data: users } = userIds.length > 0
      ? await supabase.from("profiles").select("id, email").in("id", userIds)
      : { data: [] }
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u.email]))

    return reply.send({
      data: (data ?? []).map((a: any) => ({ ...a, user_email: userMap.get(a.user_id) ?? "Unknown" })),
      total: count ?? 0,
    })
  })

  // Summary stats — uses parallel count queries to avoid fetching all rows
  app.get("/v1/admin/credit-anomalies/summary", { preHandler: requireAdmin }, async (_req, reply) => {
    const table = "credit_anomalies" as "assets"
    const [totalRes, pendingRes, overchargeRes, underchargeRes] = await Promise.all([
      supabase.from(table).select("id", { count: "exact", head: true }) as any,
      (supabase.from(table).select("id", { count: "exact", head: true }) as any).eq("status", "pending"),
      supabase.from(table).select("diff").eq("anomaly_type", "overcharge") as any,
      supabase.from(table).select("diff").eq("anomaly_type", "undercharge") as any,
    ])

    if (totalRes.error) return reply.status(500).send({ error: { message: totalRes.error.message } })

    const totalOvercharge = (overchargeRes.data ?? []).reduce((sum: number, r: { diff: number }) => sum + Math.abs(r.diff), 0)
    const totalUndercharge = (underchargeRes.data ?? []).reduce((sum: number, r: { diff: number }) => sum + r.diff, 0)

    return reply.send({
      pending: pendingRes.count ?? 0,
      totalOvercharge,
      totalUndercharge,
      total: totalRes.count ?? 0,
    })
  })

  // Update status + notes
  app.patch("/v1/admin/credit-anomalies/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { status, adminNotes } = req.body as { status?: string; adminNotes?: string }

    const updates: Record<string, unknown> = {}
    if (status) {
      updates.status = status
      if (status !== "pending") {
        updates.resolved_by = req.userId
        updates.resolved_at = new Date().toISOString()
      }
    }
    if (adminNotes !== undefined) updates.admin_notes = adminNotes

    const { error } = await (supabase
      .from("credit_anomalies" as "assets")
      .update(updates)
      .eq("id", id) as any)

    if (error) return reply.status(500).send({ error: { message: error.message } })
    return reply.send({ ok: true })
  })

  // Delete single anomaly
  app.delete("/v1/admin/credit-anomalies/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { error } = await (supabase
      .from("credit_anomalies" as "assets")
      .delete()
      .eq("id", id) as any)

    if (error) return reply.status(500).send({ error: { message: error.message } })
    return reply.send({ ok: true })
  })
}
