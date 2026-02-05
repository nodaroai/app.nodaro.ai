import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"

interface StatsResponse {
  totalExecutions: number
  successful: number
  failed: number
  failureRate: number
  avgImageTime: number | null
  avgVideoTime: number | null
}

export async function statsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { scope?: string; userId?: string } }>("/v1/stats", async (req, reply) => {
    const { scope = "user", userId } = req.query

    try {
      // Filtering logic:
      // - scope="user": ALWAYS filter by userId (required for personal stats)
      // - scope="platform": no filter (shows all jobs, admin-only feature)

      // For user scope, userId is required
      if (scope !== "platform" && !userId) {
        return {
          data: {
            totalExecutions: 0,
            successful: 0,
            failed: 0,
            failureRate: 0,
            avgImageTime: null,
            avgVideoTime: null,
          },
        }
      }

      // Call the get_stats RPC function (uses SECURITY DEFINER to bypass RLS)
      const { data, error } = scope === "platform"
        ? await supabase.rpc("get_stats")
        : await supabase.rpc("get_stats", { p_user_id: userId })

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      // The RPC function returns the stats directly
      const stats: StatsResponse = {
        totalExecutions: data?.totalExecutions ?? 0,
        successful: data?.successful ?? 0,
        failed: data?.failed ?? 0,
        failureRate: data?.failureRate ?? 0,
        avgImageTime: data?.avgImageTime ?? null,
        avgVideoTime: data?.avgVideoTime ?? null,
      }

      return { data: stats }
    } catch (err) {
      console.error("[stats] Error fetching stats:", err)
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to fetch stats" },
      })
    }
  })
}
