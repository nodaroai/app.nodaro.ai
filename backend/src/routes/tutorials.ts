import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { toTutorialResponse } from "../lib/tutorials-shared.js"

export async function tutorialsRoutes(app: FastifyInstance) {
  // GET /v1/tutorials — public, returns enabled tutorials
  app.get("/v1/tutorials", async (req, reply) => {
    const { category } = req.query as { category?: string }

    let query = supabase
      .from("tutorials")
      .select("*")
      .eq("is_enabled", true)
      .order("sort_order")

    if (category) {
      query = query.eq("category", category)
    }

    const { data, error } = await query

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: (data ?? []).map(toTutorialResponse) }
  })
}
