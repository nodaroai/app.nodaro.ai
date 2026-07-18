import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"

/** Admin surface for `app_reports` — the generic diagnostic inbox any node
 *  can write to (missing pickers, model rejections, …). List + triage only;
 *  writing happens through lib/app-reports.ts, never through this API. */

const updateReportBody = z.object({
  status: z.enum(["new", "reviewed", "resolved", "dismissed"]),
})

const reportIdParams = z.object({ id: z.string().uuid() })

export async function adminAppReportsRoutes(app: FastifyInstance): Promise<void> {
  // List reports, newest first, with filters + pagination.
  app.get("/v1/admin/app-reports", { preHandler: requireAdmin }, async (req, reply) => {
    const { offset = "0", limit = "50", kind, appSlug, node, status } = req.query as {
      offset?: string; limit?: string; kind?: string; appSlug?: string; node?: string; status?: string
    }
    const from = parseInt(offset, 10)
    const size = Math.min(parseInt(limit, 10) || 50, 100)

    let query = supabase
      .from("app_reports" as "assets")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + size - 1) as unknown as ReturnType<typeof supabase.from>

    if (kind) query = (query as any).eq("kind", kind)
    if (appSlug) query = (query as any).eq("app_slug", appSlug)
    if (node) query = (query as any).eq("node", node)
    if (status) query = (query as any).eq("status", status)

    const { data, error, count } = await (query as any)
    if (error) return reply.status(500).send({ error: { message: error.message } })
    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // Update a report's triage status.
  app.patch("/v1/admin/app-reports/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const paramsResult = reportIdParams.safeParse(req.params)
    if (!paramsResult.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: paramsResult.error.issues[0]?.message ?? "Invalid id" } })
    }
    const bodyResult = updateReportBody.safeParse(req.body ?? {})
    if (!bodyResult.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: bodyResult.error.issues[0]?.message ?? "Invalid request" } })
    }
    const { error } = await (supabase
      .from("app_reports" as "assets")
      .update({ status: bodyResult.data.status })
      .eq("id", paramsResult.data.id) as any)
    if (error) return reply.status(500).send({ error: { message: error.message } })
    return reply.send({ ok: true })
  })
}
