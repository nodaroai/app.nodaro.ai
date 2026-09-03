import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { JOB_STATUSES } from "../../lib/job-status.js"

/**
 * GET /v1/admin/jobs -- the admin Jobs table's data source.
 *
 * Exists because migration 347 revoked table-level SELECT on `public.jobs` from
 * `authenticated` down to the four columns Realtime needs. The admin Jobs page
 * used to read the 23 columns it renders -- provider_cost and display_cost
 * among them -- straight over PostgREST with the browser anon client, and it
 * CANNOT keep doing that under any variant of the fix: column privileges attach
 * to the Postgres ROLE, and an admin's JWT is the role `authenticated` like
 * everyone else's. `is_admin()` is an RLS predicate and cannot hand back a
 * column privilege. PostgREST also answers 401 42501 for a `select` naming an
 * ungranted column rather than dropping it, so there is no degrade path.
 *
 * Core `GET /v1/jobs` could not be reused: it always narrows to one user
 * (routes/jobs.ts), pages by created_at cursor rather than offset, has no
 * status/exclude filters, and its select omits fields the admin table and
 * detail dialog render.
 *
 * Enrichment (profiles / workflow_executions / developer_apps / workflows)
 * deliberately stays in the browser: those tables have admin RLS policies
 * (migration 325) and are untouched by 347, so moving them would widen this PR
 * for no security gain.
 *
 * Cost fields ARE returned here on purpose -- this route is `requireAdmin`, the
 * same stance `sanitizeJobForPublic` (routes/jobs.ts) already takes for admins
 * on the public jobs route.
 */

/** Exactly the columns the admin Jobs table + JobDetailDialog render. */
const ADMIN_JOB_COLUMNS = [
  "id", "status", "job_type", "credits", "provider", "provider_cost", "display_cost",
  "error_message", "input_data", "output_data", "created_at", "started_at",
  "completed_at", "user_id", "workflow_id", "workflow_execution_id", "source",
  "source_detail", "provider_kind", "provider_task_id", "reconcile_attempts",
  "reconcile_last_error", "provider_call_started_at",
].join(", ")

const listQuery = z.object({
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  // Derived from the canonical vocabulary, not re-typed: this hand-rolled copy
  // made `/admin/jobs?status=pending_review` a 400 the day the job-policy hook
  // shipped — i.e. the admin could not filter for exactly the jobs waiting on
  // them (spec 2026-09-03-job-policy-hook-design §6.3).
  status: z.enum(JOB_STATUSES).optional(),
  userId: z.string().uuid().optional(),
  /**
   * Comma-separated UUIDs -- the admin "hide internal accounts" filter. Parsed
   * and UUID-validated HERE rather than trusted: the browser interpolated these
   * straight into a PostgREST `not.in.(...)` list and its own comment conceded
   * that was safe only because the source happened to emit UUIDs.
   */
  excludeUserIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(z.string().uuid()).max(1000)),
})

export async function adminJobsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/jobs", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid query",
        },
      })
    }
    const { page, pageSize, status, userId, excludeUserIds } = parsed.data

    let query = supabase
      .from("jobs")
      .select(ADMIN_JOB_COLUMNS)
      .order("created_at", { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)
    if (status) query = query.eq("status", status)
    if (userId) query = query.eq("user_id", userId)
    if (excludeUserIds.length > 0) {
      query = query.not("user_id", "in", `(${excludeUserIds.join(",")})`)
    }

    const { data, error } = await query
    if (error) {
      req.log.error({ err: error }, "admin/jobs lookup failed")
      return reply.status(500).send({
        error: { code: "internal_error", message: "Lookup failed" },
      })
    }
    return reply.send({ data: data ?? [] })
  })
}
