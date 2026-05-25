import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"

// ============================================================
// Admin Stuck Pipelines
// ============================================================
//
// Surfaces pipelines that are silently stuck so an admin can intervene
// before users notice. Diagnostic on 2026-05-25 found 10+ pipelines sitting
// hours-to-days at `status=running` with no DB activity — invisible to both
// users (no UI signal) and admins (no alert). This route is the alert
// surface: render it on a dashboard card or page so the team can spot stalled
// runs and either cancel-refund, fork, or fix the underlying issue.
//
// Definition of "stuck": status='running' AND updated_at older than the
// `olderThanMinutes` cutoff (default 30). Pipelines correctly paused at a
// user-approval gate (`awaiting_approval`) ALSO count when they've sat past
// the cutoff — that's its own UX problem ("Your turn" banner ships alongside
// this), but admins still want visibility.

const stuckQuery = z.object({
  olderThanMinutes: z.coerce.number().int().min(1).max(10_080).default(30),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

interface StuckPipeline {
  pipelineId: string
  userId: string
  status: string
  currentStage: string | null
  mode: string | null
  reservedCredits: number
  spentCredits: number
  createdAt: string
  updatedAt: string
  stuckForMinutes: number
  failureReason: string | null
}

export async function adminStuckPipelinesRoutes(app: FastifyInstance) {
  /**
   * GET /v1/admin/stuck-pipelines?olderThanMinutes=30&limit=100
   * Lists running pipelines whose updated_at is older than the cutoff.
   * Sorted oldest-first so the worst offenders surface up top.
   */
  app.get(
    "/v1/admin/stuck-pipelines",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = stuckQuery.safeParse(req.query)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid query",
          },
        })
      }
      const { olderThanMinutes, limit } = parsed.data
      const cutoffIso = new Date(Date.now() - olderThanMinutes * 60_000).toISOString()

      const { data, error } = await supabase
        .from("pipelines")
        .select(
          "id, user_id, status, current_stage, mode, reserved_credits, spent_credits, created_at, updated_at, failure_reason",
        )
        .eq("status", "running")
        .lt("updated_at", cutoffIso)
        .order("updated_at", { ascending: true })
        .limit(limit)

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const now = Date.now()
      const result: StuckPipeline[] = (data ?? []).map((row) => ({
        pipelineId: row.id as string,
        userId: row.user_id as string,
        status: row.status as string,
        currentStage: (row.current_stage as string | null) ?? null,
        mode: (row.mode as string | null) ?? null,
        reservedCredits: Number(row.reserved_credits ?? 0),
        spentCredits: Number(row.spent_credits ?? 0),
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        stuckForMinutes: Math.floor(
          (now - new Date(row.updated_at as string).getTime()) / 60_000,
        ),
        failureReason: (row.failure_reason as string | null) ?? null,
      }))

      return {
        data: result,
        total: result.length,
        cutoffIso,
        olderThanMinutes,
      }
    },
  )
}
