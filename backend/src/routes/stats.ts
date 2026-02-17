import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"

interface StatsResponse {
  totalExecutions: number
  successful: number
  failed: number
  cancelled: number
  pending: number
  processing: number
  failureRate: number
  avgImageTime: number | null
  avgVideoTime: number | null
}

// In-memory cache: key = "user:<userId>" or "platform", value = { data, expiry }
const CACHE_TTL_MS = 30_000 // 30 seconds
const statsCache = new Map<string, { data: StatsResponse; expiry: number }>()

function getCachedStats(key: string): StatsResponse | null {
  const entry = statsCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiry) {
    statsCache.delete(key)
    return null
  }
  return entry.data
}

function setCachedStats(key: string, data: StatsResponse): void {
  statsCache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS })
  // Evict old entries if cache grows too large (unlikely but safe)
  if (statsCache.size > 10_000) {
    const now = Date.now()
    for (const [k, v] of statsCache) {
      if (now > v.expiry) statsCache.delete(k)
    }
  }
}

export async function statsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { scope?: string; userId?: string } }>("/v1/stats", async (req, reply) => {
    const { scope = "user", userId } = req.query

    try {
      // For user scope, userId is required
      if (scope !== "platform" && !userId) {
        return {
          data: {
            totalExecutions: 0,
            successful: 0,
            failed: 0,
            cancelled: 0,
            pending: 0,
            processing: 0,
            failureRate: 0,
            avgImageTime: null,
            avgVideoTime: null,
          },
        }
      }

      // Check cache first
      const cacheKey = scope === "platform" ? "platform" : `user:${userId}`
      const cached = getCachedStats(cacheKey)
      if (cached) {
        return { data: cached }
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
        cancelled: data?.cancelled ?? 0,
        pending: data?.pending ?? 0,
        processing: data?.processing ?? 0,
        failureRate: data?.failureRate ?? 0,
        avgImageTime: data?.avgImageTime ?? null,
        avgVideoTime: data?.avgVideoTime ?? null,
      }

      setCachedStats(cacheKey, stats)

      return { data: stats }
    } catch (err) {
      console.error("[stats] Error fetching stats:", err)
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to fetch stats" },
      })
    }
  })
}
