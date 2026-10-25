/**
 * Putting trends and their test runs away (decided 2026-10-25). Registered by
 * `adminTrendsRoutes` (admin-trends.ts), so it shares its `requireAdmin` door
 * and its edition gate; every route here is admin-only.
 *
 *   POST   /v1/admin/trends/:id/archive              off the catalog, kept (migration 559)
 *   POST   /v1/admin/trends/:id/restore              archived → unpublished (or draft)
 *   DELETE /v1/admin/trends/:id/test-runs/:jobId     delete an admin's test run and its media
 *
 * Archive, not delete, is the only way to remove a trend: a user's run history
 * names the trend, and nothing in the database links a run to its trend, so a
 * deleted trend would orphan every run of it. Each action writes an
 * `admin_actions` row.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { supabase } from "../../lib/supabase.js"
import { checkIsAdmin } from "../../lib/admin-check.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { archive, getTrendById, restore } from "../lib/trends/store.js"
import { TrendRunInFlightError, deleteTrendTestRun } from "../lib/trends/run-delete.js"
import { unavailableOrInternal, type RunJobRow } from "../lib/trends/run-helpers.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface TrendLifecycleDeps {
  /** A trend run of trend `trendId` (any owner), with its owner, or null. */
  findTrendRun: (jobId: string, trendId?: string) => Promise<(RunJobRow & { user_id: string }) | null>
}

function err(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } })
}

/** Best-effort audit: a failed write is logged, never turned into a failed action. */
export async function audit(req: FastifyRequest, action: string, targetType: string, targetId: string, payload: Record<string, unknown>) {
  const { error } = await supabase.from("admin_actions").insert({
    admin_user_id: req.userId,
    action,
    target_type: targetType,
    target_id: targetId,
    payload,
  })
  if (error) req.log.warn({ action, targetId, error: error.message }, "admin_actions write failed")
}

export function registerTrendLifecycleRoutes(app: FastifyInstance, deps: TrendLifecycleDeps): void {
  // One handler for both moves; each route is registered on its literal path.
  const statusMove = (action: "archive" | "restore", move: (id: string) => Promise<void>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string }
      if (!UUID_RE.test(id)) return err(reply, 404, "not_found", "Trend not found")
      try {
        const before = await getTrendById(id)
        if (!before) return err(reply, 404, "not_found", "Trend not found")
        await move(id)
        const trend = await getTrendById(id)
        if (!trend) return err(reply, 404, "not_found", "Trend not found")
        if (trend.status !== before.status) {
          await audit(req, `${action}_trend`, "trend", id, { slug: trend.slug, from: before.status, to: trend.status })
        }
        return { data: trend }
      } catch (e) {
        return unavailableOrInternal(reply, req, e, `Failed to ${action} the trend`)
      }
    }
  app.post("/v1/admin/trends/:id/archive", { preHandler: requireAdmin }, statusMove("archive", archive))
  app.post("/v1/admin/trends/:id/restore", { preHandler: requireAdmin }, statusMove("restore", restore))

  app.delete("/v1/admin/trends/:id/test-runs/:jobId", { preHandler: requireAdmin }, async (req, reply) => {
    const { id, jobId } = req.params as { id: string; jobId: string }
    if (!UUID_RE.test(id)) return err(reply, 404, "not_found", "Trend not found")
    try {
      const run = await deps.findTrendRun(jobId, id)
      if (!run) return err(reply, 404, "not_found", "Run not found")
      // The trend screen lists admin accounts' runs only; a user's own run is theirs to delete.
      if (!(await checkIsAdmin(run.user_id))) {
        return err(reply, 409, "not_admin_run", "Only a test run made by an admin account can be deleted here.")
      }
      const result = await deleteTrendTestRun({ runId: run.id, ownerId: run.user_id, actorUserId: req.userId!, logger: req.log })
      if (!result.deleted) return err(reply, 404, "not_found", "Run not found")
      await audit(req, "delete_trend_test_run", "job", run.id, { trendId: id, ownerId: run.user_id, ...result })
      return { data: result }
    } catch (e) {
      if (e instanceof TrendRunInFlightError) {
        return err(reply, 409, "run_in_progress", "This run is still running. Wait for it to finish, then delete it.")
      }
      return unavailableOrInternal(reply, req, e, "Failed to delete the run")
    }
  })
}
