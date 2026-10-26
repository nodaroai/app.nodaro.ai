import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { JOB_STATUSES } from "../../lib/job-status.js"
import { runCreditsFor, runCreditsOf, type RunCreditFigures } from "../../lib/job-credit-status.js"

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
 *
 * `credits` is the job's HOLD. What it was charged comes beside it in
 * `credit` (`AdminJobCredit`), read off the usage logs through the one run
 * loader (lib/job-credit-status.ts `runCreditsFor`), never `jobs.credits_actual`.
 * An admin list shows a parent and its child jobs side by side, so each row's
 * figures are the job's OWN (a total over the rows counts every job once), and
 * a parent's run total (its steps included) rides in `credit.run`.
 */

/** A job's figures for the admin Jobs page. */
export interface AdminJobCredit {
  /** The job's own hold's lifecycle; null with no usage log. */
  status: RunCreditFigures["status"]
  /** The job's own settled charge (its side holds included); null while its hold is open. */
  charged: number | null
  /** The job's own hold (`jobs.credits`). */
  held: number | null
  /** What went back from the job's own hold once it settled. */
  released: number | null
  /** The job as a run with its steps (child jobs); null when it has none. */
  run: { steps: number; charged: number | null; held: number | null; released: number | null; settled: boolean } | null
}

export function adminJobCredit(figures: RunCreditFigures | null): AdminJobCredit | null {
  if (!figures) return null
  return {
    status: figures.status,
    charged: figures.ownCharged,
    held: figures.ownHeld,
    released: figures.ownReleased,
    run: figures.steps > 0
      ? { steps: figures.steps, charged: figures.charged, held: figures.held, released: figures.released, settled: figures.settled }
      : null,
  }
}

/** Exactly the columns the admin Jobs table + JobDetailDialog render (`usage_log_id` is read for the charge only and not returned). */
const ADMIN_JOB_COLUMNS = [
  "id", "status", "job_type", "credits", "provider", "provider_cost", "display_cost",
  "error_message", "input_data", "output_data", "created_at", "started_at",
  "completed_at", "user_id", "workflow_id", "workflow_execution_id", "source",
  "source_detail", "provider_kind", "provider_task_id", "reconcile_attempts",
  "reconcile_last_error", "provider_call_started_at", "usage_log_id",
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
    const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string; usage_log_id?: string | null; credits?: number | null }>
    // One read per table for the page: each job's own figures and, for a
    // parent, its run's (its steps included).
    const credits = await runCreditsFor(rows, [...new Set(rows.map((r) => r.user_id as string))])
    return reply.send({
      data: rows.map(({ usage_log_id: _log, ...row }) => ({ ...row, credit: adminJobCredit(runCreditsOf(row.id, credits)) })),
    })
  })
}
