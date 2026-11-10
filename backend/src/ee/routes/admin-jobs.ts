import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { JOB_STATUSES } from "../../lib/job-status.js"
import { runCreditsFor, runCreditsOf, type RunCreditFigures } from "../../lib/job-credit-status.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { isMissingFunctionError } from "../../lib/postgrest-errors.js"
import { CHILD_JOB_COLUMN } from "../../lib/public-job-data.js"
import { adminChildJobs } from "./admin-job-children.js"

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
 * Every filter runs on the server, and one call reads the page:
 * `public.admin_job_list` (migration 584) returns the rows of the page
 * `public.admin_job_page` (migration 575) picks, newest first. Its rows are
 * LIGHTER than a job: `input_data` is the job's `type` only and `output_data`
 * a preview — the output's web addresses where they sit, and the start of its
 * text (`admin_job_output_preview`) — which is everything the table and the
 * gallery tiles read. The detail view loads the whole job,
 * `GET /v1/admin/jobs/:jobId`, when it opens; the job page (`/admin/job/:id`)
 * reads the same, and its child jobs from `GET /v1/admin/jobs/:jobId/children`.
 *
 * A text search (`q`) always runs inside a date
 * range -- with no `from`, the 7 days before the range's end (`to`, else
 * today); a `q` that is a uuid is a job id, matched exactly over every date
 * (`from` / `to` are ignored).
 *
 * Migrations reach the database only on a push to main, so the server can run
 * ahead of them. Until migration 584 is in the database the page is read the
 * pre-584 way — the ids from `admin_job_page`, then the whole rows by id — and
 * until migration 575 is, the pre-575 way (status / user / excluded accounts
 * only), answering `filtersUnavailable: true` when a newer filter went
 * unapplied. Either fallback is logged.
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
 * The response carries a `Server-Timing` header: how long the request waited
 * before the handler (`auth`: the key or session, then the admin check) and
 * each read it made, in ms, with `total`: `user` (an address filter), `list`
 * (the page and its rows, one call) — or, before migration 584, `page` and
 * `rows` after it — then `runCreditsFor`'s `steps` and its `logs` and `side`
 * (those two run at the same time, so the request waits for the longer, not
 * their sum). Admin-only like the route itself; it is how the page's load time
 * is measured on the deployed server.
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

/**
 * The columns of a job the admin Jobs page renders (`usage_log_id` is read for
 * the charge only and not returned). The list (`admin_job_list`) returns these
 * with `input_data` / `output_data` reduced; the pre-584 page and the one-job
 * read return them whole.
 */
const ADMIN_JOB_COLUMNS = [
  "id", "status", "job_type", "credits", "provider", "provider_cost", "display_cost",
  "error_message", "input_data", "output_data", "created_at", "started_at",
  "completed_at", "user_id", "workflow_id", "workflow_execution_id", "source",
  "source_detail", "provider_kind", "provider_task_id", "reconcile_attempts",
  "reconcile_last_error", "provider_call_started_at", "usage_log_id",
].join(", ")

/**
 * The one-job reads': every column the page renders, the job's parent, and the
 * provider's own words about a failure (`error_detail`, redacted where they
 * were written). The list's rows leave the words out: they are read for the
 * one job an admin opens, never for a page of jobs.
 */
const ONE_JOB_COLUMNS = `${ADMIN_JOB_COLUMNS}, parent_job_id, error_detail`

/** How many child jobs a job has (its owner's only, like every walk down `parent_job_id`); null when the count fails. */
async function countChildJobs(row: { id: string; user_id: string }): Promise<number | null> {
  // Admin read: a child in the Trash still counts as a step of the run.
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", row.user_id)
    .eq(CHILD_JOB_COLUMN, row.id)
  return error ? null : count ?? 0
}

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

/** Each request's `Server-Timing` entries, in the order they were measured. */
const timingsOf = new WeakMap<FastifyRequest, string[]>()

function recordTiming(req: FastifyRequest, name: string, ms: number): void {
  const list = timingsOf.get(req) ?? []
  list.push(`${name};dur=${ms.toFixed(1)}`)
  timingsOf.set(req, list)
}

async function timed<T>(req: FastifyRequest, name: string, run: () => PromiseLike<T>): Promise<T> {
  const start = performance.now()
  try {
    return await run()
  } finally {
    recordTiming(req, name, performance.now() - start)
  }
}

async function sendServerTiming(req: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<unknown> {
  const list = timingsOf.get(req)
  if (list) reply.header("Server-Timing", [...list, `total;dur=${reply.elapsedTime.toFixed(1)}`].join(", "))
  return payload
}

/** `profiles.email` as a LIKE pattern that matches only itself (case aside). */
function exactIlikePattern(email: string): string {
  return email.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** A job row as the routes read it. */
type Row = Record<string, unknown> & { id: string; usage_log_id?: string | null; credits?: number | null }

/** `admin_job_list`'s and `admin_job_page`'s arguments (the two take the same). */
interface PageArgs {
  p_offset: number
  p_limit: number
  p_status: string | null
  p_user_id: string | null
  p_exclude_user_ids: string[] | null
  p_types: string[] | null
  p_models: string[] | null
  p_sources: string[] | null
  p_min_credits: number | null
  p_from: string | null
  p_to: string | null
  p_q: string | null
  p_q_is_id: boolean | null
}

/**
 * The page as it was read before migration 584: `admin_job_page`'s ids, then
 * the whole rows by id, put back in the page's order — and, before migration
 * 575, one read filtered by status, user and the excluded accounts only.
 * Removable once 584 is in the database.
 */
async function pageThenRows(
  req: FastifyRequest,
  args: PageArgs,
  pre575: { status: string | undefined; userId: string | null; excludeUserIds: string[]; newerFilter: boolean },
): Promise<{ rows: Row[]; filtersUnavailable: boolean } | { error: unknown }> {
  const { data: pageIds, error: pageError } = await timed(req, "page", () => supabase.rpc("admin_job_page", args))
  if (pageError && functionNotInDatabase(pageError, "admin_job_page")) {
    // Migration 575 creates admin_job_page. Until it is in the database the
    // page is served the way it was before 575: newest first, offset paged,
    // filtered by status, user and the excluded accounts only — and says so
    // when a newer filter was asked for.
    req.log.warn({ err: pageError }, "admin_job_page is not in the database yet (migration 575) — serving the pre-575 page")
    const { status, userId, excludeUserIds } = pre575
    let query = supabase
      .from("jobs")
      .select(ADMIN_JOB_COLUMNS)
      .order("created_at", { ascending: false })
      .range(args.p_offset, args.p_offset + args.p_limit - 1)
    if (status) query = query.eq("status", status)
    if (userId) query = query.eq("user_id", userId)
    // A URL-borne `not.in` list (up to 200 ids) is acceptable only in this temporary fallback.
    if (excludeUserIds.length > 0) query = query.not("user_id", "in", `(${excludeUserIds.join(",")})`)
    const { data, error } = await query
    if (error) return { error }
    return { rows: (data ?? []) as unknown as Row[], filtersUnavailable: pre575.newerFilter }
  }
  if (pageError) return { error: pageError }
  const ids = ((pageIds ?? []) as Array<{ id: string }>).map((r) => r.id)
  if (ids.length === 0) return { rows: [], filtersUnavailable: false }

  const { data, error } = await timed(req, "rows", () => supabase.from("jobs").select(ADMIN_JOB_COLUMNS).in("id", ids))
  if (error) return { error }
  const byId = new Map(((data ?? []) as unknown as Row[]).map((r) => [r.id, r]))
  // The page's order is the RPC's; a job deleted between the two reads drops out.
  return { rows: ids.flatMap((id) => byId.get(id) ?? []), filtersUnavailable: false }
}

export async function adminJobsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/jobs", { preHandler: requireAdmin, onSend: sendServerTiming }, async (req, reply) => {
    recordTiming(req, "auth", reply.elapsedTime)
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
    let userId: string | null = parsed.data.userId ?? null

    if (userEmail) {
      // `ilike` with the LIKE wildcards escaped, then the same address exactly:
      // the pattern only narrows, the comparison decides.
      const { data, error } = await timed(req, "user", () => supabase
        .from("profiles")
        .select("id, email")
        .ilike("email", exactIlikePattern(userEmail))
        .limit(5))
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

    const args: PageArgs = {
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
    }

    const { data: listed, error: listError } = await timed(req, "list", () => supabase.rpc("admin_job_list", args))
    let rows: Row[]
    let filtersUnavailable = false
    if (listError && functionNotInDatabase(listError, "admin_job_list")) {
      // Migration 584 creates admin_job_list; until it reaches the database the
      // page is read as before it: the ids, then the whole rows by id. Once 584
      // is applied the function exists and this branch never runs.
      req.log.warn({ err: listError }, "admin_job_list is not in the database yet (migration 584) — reading the page, then its rows")
      const read = await pageThenRows(req, args, {
        status, userId, excludeUserIds,
        newerFilter: types.length > 0 || models.length > 0 || sources.length > 0 ||
          minCredits !== undefined || from !== undefined || to !== undefined || q !== null,
      })
      if ("error" in read) return sendInternalError(reply, req, read.error, "Lookup failed")
      rows = read.rows
      filtersUnavailable = read.filtersUnavailable
    } else {
      if (listError) return sendInternalError(reply, req, listError, "Lookup failed")
      rows = (listed ?? []) as unknown as Row[]
    }
    const unapplied = filtersUnavailable ? { filtersUnavailable: true as const } : {}
    if (rows.length === 0) return reply.send({ data: [], ...unapplied })
    // Each job's own figures and, for a parent, its run's (its steps
    // included): one read per table for the whole page, never one per job.
    const credits = await runCreditsFor(rows, [...new Set(rows.map((r) => r.user_id as string))], (read, ms) => recordTiming(req, read, ms))
    return reply.send({
      data: rows.map(({ usage_log_id: _log, ...row }) => ({ ...row, credit: adminJobCredit(runCreditsOf(row.id, credits)) })),
      ...unapplied,
    })
  })

  /**
   * GET /v1/admin/jobs/:jobId -- one job, whole: what the list's lighter rows
   * leave out (`input_data` and `output_data` in full, and `error_detail`, the
   * provider's own words about a failure), for the detail dialog and the job
   * page (`/admin/job/:id`). Any job, the ones in the Trash
   * included, like the list. The page opens from a link with no list row
   * behind it, so the job comes with its charge (`credit`, read like the
   * list's), its `parent_job_id` and how many child jobs it has
   * (`child_count`, null when the count failed).
   */
  app.get<{ Params: { jobId: string } }>(
    "/v1/admin/jobs/:jobId",
    { preHandler: requireAdmin, onSend: sendServerTiming },
    async (req, reply) => {
      recordTiming(req, "auth", reply.elapsedTime)
      const jobId = req.params.jobId
      if (!UUID_TEXT.test(jobId)) {
        return reply.status(400).send({ error: { code: "validation_error", message: "Expected a job id" } })
      }
      const { data, error } = await timed(req, "job", () => supabase
        .from("jobs")
        .select(ONE_JOB_COLUMNS)
        .eq("id", jobId)
        .maybeSingle())
      if (error) return sendInternalError(reply, req, error, "Lookup failed")
      if (!data) return reply.status(404).send({ error: { code: "not_found", message: "Job not found" } })
      const row = data as unknown as Row & { user_id: string }
      const [credits, childCount] = await Promise.all([
        runCreditsFor([row], [row.user_id], (read, ms) => recordTiming(req, read, ms)),
        timed(req, "children", () => countChildJobs(row)),
      ])
      const { usage_log_id: _log, ...job } = row
      return reply.send({ data: { ...job, credit: adminJobCredit(runCreditsOf(row.id, credits)), child_count: childCount } })
    },
  )

  /**
   * GET /v1/admin/jobs/:jobId/children -- every job below one (its steps,
   * theirs, …) in flow order, each whole (its `error_detail` included, like
   * the one-job read) and with its own charge and its `depth` below the job
   * (`admin-job-children.ts`). `truncated` when the tree is bigger than the
   * page lists.
   */
  app.get<{ Params: { jobId: string } }>(
    "/v1/admin/jobs/:jobId/children",
    { preHandler: requireAdmin, onSend: sendServerTiming },
    async (req, reply) => {
      recordTiming(req, "auth", reply.elapsedTime)
      const jobId = req.params.jobId
      if (!UUID_TEXT.test(jobId)) {
        return reply.status(400).send({ error: { code: "validation_error", message: "Expected a job id" } })
      }
      const { data, error } = await timed(req, "job", () => supabase
        .from("jobs")
        .select("id, user_id")
        .eq("id", jobId)
        .maybeSingle())
      if (error) return sendInternalError(reply, req, error, "Lookup failed")
      if (!data) return reply.status(404).send({ error: { code: "not_found", message: "Job not found" } })
      const root = data as unknown as { id: string; user_id: string }
      let children: Awaited<ReturnType<typeof adminChildJobs>>
      try {
        children = await timed(req, "tree", () => adminChildJobs(root, ONE_JOB_COLUMNS))
      } catch (err) {
        return sendInternalError(reply, req, err, "Lookup failed")
      }
      const rows = children.rows as unknown as Array<Row & { depth: number }>
      const credits = await runCreditsFor(rows, [root.user_id], (read, ms) => recordTiming(req, read, ms))
      return reply.send({
        data: rows.map(({ usage_log_id: _log, ...row }) => ({ ...row, credit: adminJobCredit(runCreditsOf(row.id, credits)) })),
        truncated: children.truncated,
      })
    },
  )

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
