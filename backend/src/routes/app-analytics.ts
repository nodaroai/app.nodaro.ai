/**
 * App Analytics routes — creator-facing analytics for published apps.
 * GET /v1/apps/:appId/analytics       — aggregated stats (today, 7d, 30d, all-time)
 * GET /v1/apps/:appId/analytics/runs  — paginated run list (metadata only)
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"

const appIdParams = z.object({
  appId: z.string().uuid(),
})

const runsQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
})

export async function appAnalyticsRoutes(app: FastifyInstance) {
  // --- Aggregated analytics ---
  app.get("/v1/apps/:appId/analytics", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = appIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid app ID" },
      })
    }

    const { appId } = parsed.data

    // Verify creator owns this app
    const { data: appRow, error: appError } = await supabase
      .from("published_apps")
      .select("id, creator_id")
      .eq("id", appId)
      .single()

    if (appError || !appRow) {
      return reply.status(404).send({
        error: { code: "not_found", message: "App not found" },
      })
    }
    if (appRow.creator_id !== req.userId) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Not your app" },
      })
    }

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split("T")[0]

    const d7 = new Date(today)
    d7.setUTCDate(d7.getUTCDate() - 7)
    const d7Str = d7.toISOString().split("T")[0]

    const d30 = new Date(today)
    d30.setUTCDate(d30.getUTCDate() - 30)
    const d30Str = d30.toISOString().split("T")[0]

    // Fetch all analytics rows for this app (sorted by date desc)
    const { data: rows, error: rowsError } = await supabase
      .from("app_analytics")
      .select("date, total_runs, unique_runners, total_credits, successful_runs, failed_runs")
      .eq("app_id", appId)
      .order("date", { ascending: false })

    if (rowsError) {
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to fetch analytics" },
      })
    }

    const allRows = rows ?? []

    function aggregate(filterFn: (date: string) => boolean) {
      const filtered = allRows.filter((r) => filterFn(r.date))
      return {
        totalRuns: filtered.reduce((s, r) => s + (r.total_runs ?? 0), 0),
        uniqueRunners: filtered.reduce((s, r) => s + (r.unique_runners ?? 0), 0),
        totalCredits: filtered.reduce((s, r) => s + (r.total_credits ?? 0), 0),
        successfulRuns: filtered.reduce((s, r) => s + (r.successful_runs ?? 0), 0),
        failedRuns: filtered.reduce((s, r) => s + (r.failed_runs ?? 0), 0),
      }
    }

    return reply.send({
      today: aggregate((d) => d >= todayStr),
      last7Days: aggregate((d) => d >= d7Str),
      last30Days: aggregate((d) => d >= d30Str),
      allTime: aggregate(() => true),
      daily: allRows.slice(0, 30).map((r) => ({
        date: r.date,
        totalRuns: r.total_runs,
        uniqueRunners: r.unique_runners,
        totalCredits: r.total_credits,
        successfulRuns: r.successful_runs,
        failedRuns: r.failed_runs,
      })),
    })
  })

  // --- Paginated run list (creator view) ---
  app.get("/v1/apps/:appId/analytics/runs", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = appIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid app ID" },
      })
    }

    const queryParsed = runsQuery.safeParse(req.query)
    if (!queryParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid query" },
      })
    }

    const { appId } = paramsParsed.data
    const { cursor, limit } = queryParsed.data

    // Verify creator owns this app
    const { data: appRow, error: appError } = await supabase
      .from("published_apps")
      .select("id, creator_id")
      .eq("id", appId)
      .single()

    if (appError || !appRow) {
      return reply.status(404).send({
        error: { code: "not_found", message: "App not found" },
      })
    }
    if (appRow.creator_id !== req.userId) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Not your app" },
      })
    }

    let query = supabase
      .from("app_runs")
      .select("id, runner_id, credits_used, created_at, workflow_executions(status, completed_nodes, total_nodes, completed_at)")
      .eq("app_id", appId)
      .order("created_at", { ascending: false })
      .limit(limit + 1)

    if (cursor) {
      const { data: cursorRow } = await supabase
        .from("app_runs")
        .select("created_at")
        .eq("id", cursor)
        .single()
      if (cursorRow) {
        query = query.lt("created_at", cursorRow.created_at)
      }
    }

    const { data: runs, error: runsError } = await query

    if (runsError) {
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to fetch runs" },
      })
    }

    const hasMore = (runs?.length ?? 0) > limit
    const items = (runs ?? []).slice(0, limit)
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null

    return reply.send({
      data: items.map((run) => {
        const exec = run.workflow_executions as unknown as {
          status: string
          completed_nodes: number | null
          total_nodes: number | null
          completed_at: string | null
        } | null

        return {
          id: run.id,
          runnerId: run.runner_id,
          creditsUsed: run.credits_used,
          createdAt: run.created_at,
          status: exec?.status ?? "unknown",
          completedNodes: exec?.completed_nodes ?? 0,
          totalNodes: exec?.total_nodes ?? 0,
          completedAt: exec?.completed_at ?? null,
        }
      }),
      nextCursor,
    })
  })
}
