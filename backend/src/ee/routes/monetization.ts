/**
 * Monetization Routes — creator earnings + global defaults
 *
 * GET  /v1/user/monetization-defaults   — Read creator's global defaults
 * PUT  /v1/user/monetization-defaults   — Update creator's global defaults
 * GET  /v1/user/earnings                — Global earnings summary (billing page)
 * GET  /v1/apps/:appId/earnings         — Per-app earnings summary
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { hasCredits } from "../../lib/config.js"

const defaultsSchema = z.object({
  flatFee: z.number().int().min(0),
  percent: z.number().int().min(0).max(500),
})

const earningsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export async function monetizationRoutes(app: FastifyInstance) {
  // GET /v1/user/monetization-defaults
  app.get("/v1/user/monetization-defaults", async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    if (!hasCredits()) return reply.status(404).send({ error: { code: "not_available", message: "Not available in this edition" } })

    const { data: profile } = await supabase
      .from("profiles")
      .select("default_monetization_flat_fee, default_monetization_percent")
      .eq("id", req.userId)
      .single()

    return {
      flatFee: profile?.default_monetization_flat_fee ?? 0,
      percent: profile?.default_monetization_percent ?? 0,
    }
  })

  // PUT /v1/user/monetization-defaults
  app.put("/v1/user/monetization-defaults", async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    if (!hasCredits()) return reply.status(404).send({ error: { code: "not_available", message: "Not available in this edition" } })

    const parsed = defaultsSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "bad_request", message: "Invalid body: flatFee (int >= 0), percent (int 0-500)" } })
    }

    const { flatFee, percent } = parsed.data

    const { error } = await supabase
      .from("profiles")
      .update({
        default_monetization_flat_fee: flatFee,
        default_monetization_percent: percent,
      })
      .eq("id", req.userId)

    if (error) {
      return reply.status(500).send({ error: { code: "server_error", message: "Failed to update defaults" } })
    }

    return { flatFee, percent }
  })

  // GET /v1/user/earnings — global earnings summary for billing page
  app.get("/v1/user/earnings", async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    if (!hasCredits()) return reply.status(404).send({ error: { code: "not_available", message: "Not available in this edition" } })

    const queryParsed = earningsQuerySchema.safeParse(req.query)
    if (!queryParsed.success) {
      return reply.status(400).send({ error: { code: "bad_request", message: "Invalid query parameters" } })
    }
    const { cursor, limit } = queryParsed.data

    // Compute date boundaries
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // Fetch profile + last 30 days earnings in parallel (month is a subset of 30 days)
    const [profileResult, recentEarningsResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("total_earnings")
        .eq("id", req.userId)
        .single(),
      supabase
        .from("app_earnings")
        .select("total_earned, created_at")
        .eq("creator_id", req.userId)
        .gte("created_at", thirtyDaysAgo),
    ])

    const totalLifetime = profileResult.data?.total_earnings ?? 0

    // Partition 30-day earnings into this-month vs rest
    const recentRows = recentEarningsResult.data ?? []
    let thisMonth = 0
    let last30Days = 0
    for (const e of recentRows) {
      const earned = e.total_earned ?? 0
      last30Days += earned
      if (e.created_at >= monthStart) thisMonth += earned
    }

    // Paginated earnings log
    let query = supabase
      .from("app_earnings")
      .select("id, app_id, run_id, runner_id, base_cost, flat_fee, percent_fee, total_earned, total_charged, created_at, published_apps!app_id(name, publish_type)")
      .eq("creator_id", req.userId)
      .order("created_at", { ascending: false })
      .limit(limit + 1)

    if (cursor) {
      const { data: cursorRow } = await supabase
        .from("app_earnings")
        .select("created_at")
        .eq("id", cursor)
        .single()
      if (cursorRow) {
        query = query.lt("created_at", cursorRow.created_at)
      }
    }

    const { data: rows } = await query

    const hasMore = (rows?.length ?? 0) > limit
    const items = (rows ?? []).slice(0, limit).map((r: Record<string, unknown>) => ({
      id: r.id,
      appId: r.app_id,
      appName: (r.published_apps as Record<string, unknown> | null)?.name ?? "Unknown",
      publishType: (r.published_apps as Record<string, unknown> | null)?.publish_type ?? "app",
      runId: r.run_id,
      runnerId: r.runner_id,
      baseCost: r.base_cost,
      flatFee: r.flat_fee,
      percentFee: r.percent_fee,
      totalEarned: r.total_earned,
      totalCharged: r.total_charged,
      createdAt: r.created_at,
    }))

    return {
      totalLifetime,
      thisMonth,
      last30Days,
      items,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    }
  })

  // GET /v1/apps/:appId/earnings — per-app earnings for analytics
  app.get("/v1/apps/:appId/earnings", async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    if (!hasCredits()) return reply.status(404).send({ error: { code: "not_available", message: "Not available in this edition" } })

    const { appId } = req.params as { appId: string }

    // Verify creator owns this app
    const { data: appRow } = await supabase
      .from("published_apps")
      .select("creator_id")
      .eq("id", appId)
      .single()

    if (!appRow || appRow.creator_id !== req.userId) {
      return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
    }

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    // Single query fetches all earnings; partition by month in JS
    const { data: allEarnings } = await supabase
      .from("app_earnings")
      .select("total_earned, created_at")
      .eq("app_id", appId)

    const rows = allEarnings ?? []
    let totalEarned = 0
    let thisMonth = 0
    for (const e of rows) {
      const earned = e.total_earned ?? 0
      totalEarned += earned
      if (e.created_at >= monthStart) thisMonth += earned
    }
    const paidRuns = rows.length

    return { totalEarned, paidRuns, thisMonth }
  })
}
