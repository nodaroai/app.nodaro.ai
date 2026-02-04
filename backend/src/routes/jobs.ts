import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"

export async function jobRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/v1/jobs/:id", async (req, reply) => {
    const { id } = req.params

    const { data: job, error } = await supabase
      .from("jobs")
      .select("id, status, progress, input_data, output_data, error_message, created_at, started_at, completed_at, user_id")
      .eq("id", id)
      .single()

    if (error || !job) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Job not found" },
      })
    }

    return { data: job }
  })

  app.get<{ Querystring: { userId?: string; limit?: string; cursor?: string } }>("/v1/jobs", async (req) => {
    const { userId, limit = "50", cursor } = req.query
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100)

    let query = supabase
      .from("jobs")
      .select("id, status, progress, input_data, output_data, error_message, created_at, started_at, completed_at, user_id")
      .order("created_at", { ascending: false })
      .limit(limitNum)

    // Filter by user_id if provided
    if (userId) {
      query = query.eq("user_id", userId)
    }

    // Cursor-based pagination (use created_at as cursor)
    if (cursor) {
      query = query.lt("created_at", cursor)
    }

    const { data: jobs } = await query

    // Determine next cursor
    const nextCursor = jobs && jobs.length === limitNum ? jobs[jobs.length - 1]?.created_at : null

    return {
      data: jobs ?? [],
      next: nextCursor,
      previous: null, // Not implementing backwards pagination for now
    }
  })

  app.post<{ Params: { id: string } }>("/v1/jobs/:id/cancel", async (req, reply) => {
    const { id } = req.params

    const { error } = await supabase
      .from("jobs")
      .update({ status: "cancelled" })
      .eq("id", id)
      .in("status", ["pending", "queued", "processing"])

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: { id, status: "cancelled" } }
  })

  app.delete<{ Params: { id: string } }>("/v1/jobs/:id", async (req, reply) => {
    const { id } = req.params

    const { error } = await supabase
      .from("jobs")
      .delete()
      .eq("id", id)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { success: true }
  })
}
