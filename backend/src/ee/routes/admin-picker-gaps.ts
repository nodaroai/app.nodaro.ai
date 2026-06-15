import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"

const updateGapBody = z.object({
  status: z.enum(["new", "reviewed", "added", "dismissed"]),
})

const gapIdParams = z.object({ id: z.string().uuid() })

export async function adminPickerGapsRoutes(app: FastifyInstance): Promise<void> {
  // List gaps ranked by occurrence count, with filters + pagination.
  app.get("/v1/admin/picker-gaps", { preHandler: requireAdmin }, async (req, reply) => {
    const { offset = "0", limit = "50", picker, gapType, status } = req.query as {
      offset?: string; limit?: string; picker?: string; gapType?: string; status?: string
    }
    const from = parseInt(offset, 10)
    const size = Math.min(parseInt(limit, 10) || 50, 100)

    let query = supabase
      .from("picker_catalog_gaps" as "assets")
      .select("*", { count: "exact" })
      .order("count", { ascending: false })
      .order("last_seen", { ascending: false })
      .range(from, from + size - 1) as unknown as ReturnType<typeof supabase.from>

    if (picker) query = (query as any).eq("picker_type", picker)
    if (gapType) query = (query as any).eq("gap_type", gapType)
    if (status) query = (query as any).eq("status", status)

    const { data, error, count } = await (query as any)
    if (error) return reply.status(500).send({ error: { message: error.message } })
    return reply.send({ data: data ?? [], total: count ?? 0 })
  })

  // Update a gap's review status.
  app.patch("/v1/admin/picker-gaps/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const paramsResult = gapIdParams.safeParse(req.params)
    if (!paramsResult.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: paramsResult.error.issues[0]?.message ?? "Invalid id" } })
    }
    const bodyResult = updateGapBody.safeParse(req.body ?? {})
    if (!bodyResult.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: bodyResult.error.issues[0]?.message ?? "Invalid request" } })
    }
    const { error } = await (supabase
      .from("picker_catalog_gaps" as "assets")
      .update({ status: bodyResult.data.status })
      .eq("id", paramsResult.data.id) as any)
    if (error) return reply.status(500).send({ error: { message: error.message } })
    return reply.send({ ok: true })
  })
}
