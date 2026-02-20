import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { checkIsAdmin } from "../lib/admin-check.js"

// ---- Zod Schemas ----

const reportIdParams = z.object({
  reportId: z.string().uuid(),
})

const updateReportBody = z.object({
  status: z.enum(["reviewed", "dismissed"]),
})

export async function adminGalleryReportsRoutes(app: FastifyInstance) {
  /**
   * GET /v1/admin/gallery-reports
   * List all gallery reports (newest first).
   *
   * Query params:
   *   status  - optional filter: "pending" | "reviewed" | "dismissed"
   *   page    - page number (default 1)
   *   limit   - items per page (default 50, max 100)
   *   userId  - admin user ID for auth
   */
  app.get("/v1/admin/gallery-reports", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const isAdmin = await checkIsAdmin(userId)
    if (!isAdmin) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Only admins can view gallery reports" },
      })
    }

    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "50", 10) || 50))
    const statusFilter = query.status as string | undefined
    const offset = (page - 1) * limit

    let dbQuery = supabase
      .from("gallery_reports")
      .select("*, jobs:job_id(id, job_type, input_data, output_data)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (statusFilter && ["pending", "reviewed", "dismissed"].includes(statusFilter)) {
      dbQuery = dbQuery.eq("status", statusFilter)
    }

    const { data: reports, count, error } = await dbQuery

    if (error) {
      console.error("[admin-gallery-reports] Query failed:", error)
      return reply.status(500).send({ error: "Failed to fetch reports" })
    }

    return reply.send({
      data: reports ?? [],
      total: count ?? 0,
      page,
      limit,
    })
  })

  /**
   * GET /v1/admin/gallery-reports/count
   * Returns the count of pending gallery reports.
   *
   * Query params:
   *   userId - admin user ID for auth
   */
  app.get("/v1/admin/gallery-reports/count", async (req, reply) => {
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const isAdmin = await checkIsAdmin(userId)
    if (!isAdmin) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Only admins can view report counts" },
      })
    }

    const { count, error } = await supabase
      .from("gallery_reports")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")

    if (error) {
      console.error("[admin-gallery-reports] Count query failed:", error)
      return reply.status(500).send({ error: "Failed to fetch report count" })
    }

    return reply.send({ count: count ?? 0 })
  })

  /**
   * PATCH /v1/admin/gallery-reports/:reportId
   * Update report status (reviewed / dismissed).
   *
   * Body: { userId, status }
   */
  app.patch<{ Params: { reportId: string } }>("/v1/admin/gallery-reports/:reportId", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const isAdmin = await checkIsAdmin(userId)
    if (!isAdmin) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Only admins can update report status" },
      })
    }

    const paramsResult = reportIdParams.safeParse(req.params)
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsResult.error.issues[0]?.message ?? "Invalid report ID",
        },
      })
    }

    const bodyResult = updateReportBody.safeParse(req.body)
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyResult.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { reportId } = paramsResult.data
    const { status } = bodyResult.data

    const { data, error } = await supabase
      .from("gallery_reports")
      .update({ status })
      .eq("id", reportId)
      .select()
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Report not found" },
        })
      }
      console.error("[admin-gallery-reports] Update failed:", error)
      return reply.status(500).send({ error: "Failed to update report" })
    }

    return reply.send({ data })
  })
}
