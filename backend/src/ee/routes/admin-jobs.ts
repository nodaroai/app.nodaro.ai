import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { JOB_STATUSES } from "../../lib/job-status.js"
import { runCreditsFor, runCreditsOf, type RunCreditFigures } from "../../lib/job-credit-status.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { isMissingFunctionError } from "../../lib/postgrest-errors.js"

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
 * Every filter runs on the server: `public.admin_job_page` (migration 575)
 * returns the ids of one filtered page, newest first, and the rows are read by
 * id and put back in that order. A text search (`q`) always runs inside a date
 * range -- with no `from`, the 7 days before the range's end (`to`, else
 * today); a `q` that is a uuid is a job id, matched exactly over every date
 * (`from` / `to` are ignored). Until migration 575 is in the database the page
 * falls back to the pre-575 read (status / user / excluded accounts only) and
 * answers `filtersUnavailable: true` when a newer filter went unapplied.
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

/** A type, model or platform key as the list filters take it — sources may carry a host (`web:localhost:3000`). */
const LIST_ITEM = /^[a-z0-9:._@-]{1,120}$/i
/** Any Postgres uuid spelling (not only v4): a search that is one matches `jobs.id` exactly. */
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000
/** A search with no `from` looks this far back from the range's end: a text search never scans the whole table. */
export const SEARCH_DEFAULT_WINDOW_MS = 7 * DAY_MS
/** The largest Postgres `integer`: `p_min_credits` and `p_offset` are int4. */
const INT4_MAX = 2147483647
/** How far back `GET /v1/admin/jobs/sources` counts. */
export const SOURCES_WINDOW_MS = 90 * DAY_MS

/** The UTC start of a `YYYY-MM-DD` day, or null for a day the calendar does not have (`2026-02-30`). */
function utcDayStart(day: string): Date | null {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t : null
}

const dayParam = z
  .string()
  .regex(DAY_TEXT, "Expected a YYYY-MM-DD day")
  .refine((v) => utcDayStart(v) !== null, "Not a calendar day")
  .transform((v) => utcDayStart(v)!)
  .optional()

/** A comma-separated list; an absent or empty one is no filter. */
const listParam = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []))
  .pipe(z.array(z.string().regex(LIST_ITEM, "Invalid list item")).max(200))

const listQuery = z.object({
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  // Derived from the canonical vocabulary, not re-typed: this hand-rolled copy
  // made `/admin/jobs?status=pending_review` a 400 the day the job-policy hook
  // shipped — i.e. the admin could not filter for exactly the jobs waiting on
  // them (spec 2026-09-03-job-policy-hook-design §6.3).
  status: z.enum(JOB_STATUSES).optional(),
  userId: z.string().uuid().optional(),
  /** The account's address, matched case-insensitively and exactly; wins over `userId`. */
  userEmail: z.string().trim().toLowerCase().pipe(z.email()).optional(),
  /**
   * Comma-separated UUIDs -- the admin "hide internal accounts" filter. Parsed
   * and UUID-validated HERE rather than trusted: the browser interpolated these
   * straight into a PostgREST `not.in.(...)` list and its own comment conceded
   * that was safe only because the source happened to emit UUIDs. (A null in
   * the RPC's list would exclude every row.)
   */
  excludeUserIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(z.string().uuid()).max(1000)),
  types: listParam,
  models: listParam,
  sources: listParam,
  // `?minCredits=` is no filter, not 0: the minimum costs a subquery per row.
  minCredits: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(0).max(INT4_MAX).optional()),
  from: dayParam,
  /** Inclusive: the jobs of that whole day are kept. */
  to: dayParam,
  q: z.string().max(200).optional(),
}).refine((v) => v.page * v.pageSize <= INT4_MAX, { message: "Page is past the last row the list can reach", path: ["page"] })

/**
 * `name` ITSELF is not in the database yet (migration 575 not applied) — not
 * merely any "missing function" error, which would let a real defect after
 * the release quietly serve the unfiltered fallback:
 * - PostgREST's `PGRST202` ("Could not find the function public.<name>(…) in
 *   the schema cache") also answers a call whose arguments match no signature
 *   of an EXISTING function; then its hint offers that same function
 *   ("Perhaps you meant to call the function public.<name>(…)").
 * - Postgres' `42883` is also raised inside an existing body (an operator or a
 *   function it calls); only "function public.<name>(…) does not exist" counts.
 */
function functionNotInDatabase(err: { code?: string; message?: string; hint?: string | null }, name: string): boolean {
  if (!isMissingFunctionError(err)) return false
  const named = new RegExp(`\\b(?:public\\.)?${name}\\(`)
  const message = err.message ?? ""
  if (!named.test(message)) return false
  if (err.code === "42883" && !new RegExp(`^function (?:public\\.)?${name}\\(.*\\) does not exist$`).test(message)) return false
  return !named.test(err.hint ?? "")
}

/** `profiles.email` as a LIKE pattern that matches only itself (case aside). */
function exactIlikePattern(email: string): string {
  return email.replace(/[\\%_]/g, (c) => `\\${c}`)
}

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
    const { page, pageSize, status, userEmail, excludeUserIds, types, models, sources, minCredits, from, to } = parsed.data
    let userId = parsed.data.userId ?? null

    if (userEmail) {
      // `ilike` with the LIKE wildcards escaped, then the same address exactly:
      // the pattern only narrows, the comparison decides.
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email")
        .ilike("email", exactIlikePattern(userEmail))
        .limit(5)
      if (error) return sendInternalError(reply, req, error, "Lookup failed")
      const match = ((data ?? []) as Array<{ id: string; email: string | null }>).find(
        (p) => (p.email ?? "").trim().toLowerCase() === userEmail,
      )
      if (!match) return reply.send({ data: [], userNotFound: true })
      userId = match.id
    }

    const q = parsed.data.q?.trim() || null
    const qIsId = q !== null && UUID_TEXT.test(q)
    // A job id covers every date, whatever range is set. A text search always
    // runs inside one: with no `from`, the 7 days before the range's end (the
    // start of `to`, else of today, UTC) — the window the editor shows.
    const today = new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS)
    const fromAt = qIsId ? null : from ?? (q !== null ? new Date((to ?? today).getTime() - SEARCH_DEFAULT_WINDOW_MS) : null)
    const toAt = qIsId || !to ? null : new Date(to.getTime() + DAY_MS)

    const { data: pageIds, error: pageError } = await supabase.rpc("admin_job_page", {
      p_offset: page * pageSize,
      p_limit: pageSize,
      p_status: status ?? null,
      p_user_id: userId,
      p_exclude_user_ids: excludeUserIds.length > 0 ? excludeUserIds : null,
      p_types: types.length > 0 ? types : null,
      p_models: models.length > 0 ? models : null,
      p_sources: sources.length > 0 ? sources : null,
      p_min_credits: minCredits ?? null,
      p_from: fromAt?.toISOString() ?? null,
      p_to: toAt?.toISOString() ?? null,
      p_q: q,
      // Only for a real uuid: the RPC casts the search when this is set.
      p_q_is_id: q === null ? null : qIsId,
    })
    type Row = Record<string, unknown> & { id: string; usage_log_id?: string | null; credits?: number | null }
    let rows: Row[]
    let filtersUnavailable = false
    if (pageError && functionNotInDatabase(pageError, "admin_job_page")) {
      // Migration 575 creates admin_job_page, and migrations reach the shared
      // database only on a push to main, so staging runs this code before the
      // function exists. Until then the page is served the way it was before
      // 575: newest first, offset paged, filtered by status, user and the
      // excluded accounts only — and says so when a newer filter was asked
      // for. Once 575 is applied the RPC exists and this branch never runs.
      req.log.warn({ err: pageError }, "admin_job_page is not in the database yet (migration 575) — serving the pre-575 page")
      let query = supabase
        .from("jobs")
        .select(ADMIN_JOB_COLUMNS)
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (status) query = query.eq("status", status)
      if (userId) query = query.eq("user_id", userId)
      // A URL-borne `not.in` list (up to 200 ids) is acceptable only in this temporary fallback.
      if (excludeUserIds.length > 0) query = query.not("user_id", "in", `(${excludeUserIds.join(",")})`)
      const { data, error } = await query
      if (error) return sendInternalError(reply, req, error, "Lookup failed")
      rows = (data ?? []) as unknown as Row[]
      filtersUnavailable = types.length > 0 || models.length > 0 || sources.length > 0 ||
        minCredits !== undefined || from !== undefined || to !== undefined || q !== null
    } else {
      if (pageError) return sendInternalError(reply, req, pageError, "Lookup failed")
      const ids = ((pageIds ?? []) as Array<{ id: string }>).map((r) => r.id)
      if (ids.length === 0) return reply.send({ data: [] })

      const { data, error } = await supabase.from("jobs").select(ADMIN_JOB_COLUMNS).in("id", ids)
      if (error) return sendInternalError(reply, req, error, "Lookup failed")
      const byId = new Map(((data ?? []) as unknown as Row[]).map((r) => [r.id, r]))
      // The page's order is the RPC's; a job deleted between the two reads drops out.
      rows = ids.flatMap((id) => byId.get(id) ?? [])
    }
    const unapplied = filtersUnavailable ? { filtersUnavailable: true as const } : {}
    if (rows.length === 0) return reply.send({ data: [], ...unapplied })
    // One read per table for the page: each job's own figures and, for a
    // parent, its run's (its steps included).
    const credits = await runCreditsFor(rows, [...new Set(rows.map((r) => r.user_id as string))])
    return reply.send({
      data: rows.map(({ usage_log_id: _log, ...row }) => ({ ...row, credit: adminJobCredit(runCreditsOf(row.id, credits)) })),
      ...unapplied,
    })
  })

  /**
   * GET /v1/admin/jobs/sources -- the platform filter's choices: every
   * platform key with jobs in the last 90 days, its count, and one
   * representative source / source_detail. `app:<id>` keys are labelled by
   * the browser, which already reads developer_apps.
   */
  app.get("/v1/admin/jobs/sources", { preHandler: requireAdmin }, async (req, reply) => {
    const { data, error } = await supabase.rpc("admin_job_sources", {
      p_since: new Date(Date.now() - SOURCES_WINDOW_MS).toISOString(),
    })
    // Before migration 575 reaches the database the function is missing: no choices yet, not a failed page.
    if (error && functionNotInDatabase(error, "admin_job_sources")) {
      req.log.warn({ err: error }, "admin_job_sources is not in the database yet (migration 575) — serving no choices")
      return reply.send({ data: [] })
    }
    if (error) return sendInternalError(reply, req, error, "Lookup failed")
    const rows = (data ?? []) as Array<{ key: string; source: string | null; source_detail: string | null; count: number | string }>
    return reply.send({
      data: rows.map((r) => ({ key: r.key, source: r.source, sourceDetail: r.source_detail, count: Number(r.count) })),
    })
  })
}
