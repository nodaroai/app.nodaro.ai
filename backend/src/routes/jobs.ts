import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"

export async function jobRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/v1/jobs/:id", async (req, reply) => {
    const { id } = req.params

    const { data: job, error } = await supabase
      .from("jobs")
      .select("id, status, progress, input_data, output_data, error_message, created_at, started_at, completed_at")
      .eq("id", id)
      .single()

    if (error || !job) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Job not found" },
      })
    }

    return { data: job }
  })

  app.get("/v1/jobs", async () => {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, status, progress, input_data, output_data, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(50)

    return { data: jobs ?? [] }
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
}
