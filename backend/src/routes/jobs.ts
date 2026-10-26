import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { requireScope } from "../lib/scopes.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { CHILD_JOB_COLUMN, TRASHED_JOB_COLUMN, TREND_RUN_MARKER_SELECT, maskTrendRunError, maskTrendRunErrors, redactPrivateJobData } from "../lib/public-job-data.js"
import { registerJobTrashRoutes } from "./job-trash.js"
// OpenAPI entries (module side effect, like every route file's registerPath).
import "./jobs-docs.js"
import { liveSessionsOfJobs } from "../lib/job-sessions.js"
import { ORDER_QUALITY_COLUMNS, fillJobRenderQuality, fillJobsRenderQuality } from "../lib/render-label-fill.js"
import type { ErrorHint } from "../lib/safety-block.js"
import { creditStatusMapFor, creditStatusOf, creditsChargedOf } from "../lib/job-credit-status.js"
import { sideHoldChargesFor } from "../lib/job-step-charge.js"
import { jobOwnerStateFor, ownerStateFields, type JobOwnerStateMap } from "../lib/job-owner-state.js"
import { applyJobListFilters, jobListFilterSelect, parseJobListQuery, ratingsNotAvailable, withoutFilterEmbeds } from "../lib/job-list-filters.js"

const batchStatusBody = z.object({
  jobIds: z.array(z.string().min(1)).min(1).max(100),
})

// GET /v1/jobs/status?ids=a,b,c — light batch poll for studio UIs.
// Returns at most 100 jobs (DoS cap). Cross-user / non-existent ids
// are silently omitted (caller reconciles locally).
const batchStatusQuery = z.object({
  ids: z
    .string()
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
})

// Job type from database
export interface JobRecord {
  id: string
  status: string
  progress: number
  input_data: unknown
  output_data: unknown
  error_message: string | null
  /** W0: redacted raw provider error. Admin-only — see sanitizeJobForPublic. */
  error_detail?: string | null
  /** Migration 376: a user-safe, machine-readable failure verdict written by
   *  the worker on a final content-policy block. User-safe by construction —
   *  `sanitizeJobForPublic` passes it through to non-admins. */
  error_hint?: ErrorHint | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  user_id: string
  provider: string | null
  provider_cost: number | null
  display_cost: number | null
  credits: number | null
  credits_actual: number | null
  job_type: string | null
  /** Provenance — which kind of caller created the job (lib/job-source.ts).
   *  Owner-visible by design: it is the caller's own origin, not a cost or
   *  provider internal, so `sanitizeJobForPublic` passes it through. */
  source?: string | null
  source_detail?: string | null
  /** The generation session this job was born in (migration 518), or null.
   *  The caller's own session id — owner-visible like `source`. */
  session_id?: string | null
  /** In the Trash since then (migration 561); null = live. Only a Trash read
   *  selects it: every other read leaves a trashed job out. */
  deleted_at?: string | null
}

/** Every key a NON-admin caller may see. An ALLOWLIST (W0, 2026-09-01):
 *  `jobs` gains columns over time (error_detail, cost columns, reconcile
 *  counters) and a denylist made each one owner-visible by default. Adding a
 *  column now requires adding it here on purpose. `recovering` is derived. */
export const PUBLIC_JOB_KEYS = [
  "id", "status", "progress", "input_data", "output_data", "error_message",
  "error_hint", "created_at", "started_at", "completed_at", "user_id", "credits",
  "job_type", "source", "source_detail", "session_id",
] as const

/** Keys admins see in addition — provider internals, USD costs, the raw
 *  provider error, the reconcile counter. */
export const ADMIN_ONLY_JOB_KEYS = [
  "provider", "provider_cost", "display_cost", "credits_actual", "error_detail", "reconcile_attempts",
] as const

export type PublicJob = Pick<JobRecord, Extract<(typeof PUBLIC_JOB_KEYS)[number], keyof JobRecord>> & { recovering?: true }

/** A row of `GET /v1/jobs`'s list query: the job, plus what the route reads before sanitizing it. */
type ListedJobRow = JobRecord & {
  usage_log_id?: string | null
  workflow_execution_id: string | null
  workflow_executions?: unknown
}

function pickKeys(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in row) out[k] = row[k]
  return out
}

/**
 * Sanitize job data for public API response.
 *
 * Non-admin callers get exactly PUBLIC_JOB_KEYS (credits, never USD; never the
 * provider id, never the raw provider error). Admins get PUBLIC + ADMIN_ONLY.
 * Nobody gets a key outside those two lists, and the private Recast remux
 * base is redacted for every caller (redactPrivateJobData). A non-admin reads
 * a trend run's failure as `TREND_RUN_FAILURE_MESSAGE` (maskTrendRunError).
 */
export function sanitizeJobForPublic(job: JobRecord, isAdmin: boolean): JobRecord | PublicJob {
  // A trend run's failure text is replaced for a non-admin (maskTrendRunError).
  const redacted = maskTrendRunError(redactPrivateJobData(job), isAdmin) as unknown as Record<string, unknown>
  const picked = pickKeys(redacted, isAdmin ? [...PUBLIC_JOB_KEYS, ...ADMIN_ONLY_JOB_KEYS] : PUBLIC_JOB_KEYS)

  // Recovery visibility (audit UX): a processing row the reconcile system has
  // touched is self-healing, not just slow — expose a boolean, never the counter.
  const attempts = (redacted.reconcile_attempts as number | null | undefined) ?? 0
  if (!isAdmin && redacted.status === "processing" && attempts > 0) picked.recovering = true

  // Strip internal fields from input_data (the orchestrator stores the full
  // payload). NON-ADMIN ONLY — parity with the pre-allowlist sanitizer, whose
  // admin branch returned before this block: `input_data.provider` is the model
  // id on character/entity jobs and admins read it for forensics.
  if (!isAdmin && picked.input_data && typeof picked.input_data === "object") {
    const cleaned = { ...(picked.input_data as Record<string, unknown>) }
    delete cleaned.userId
    delete cleaned.jobId
    delete cleaned.usageLogId
    delete cleaned.force_private
    delete cleaned.provider
    picked.input_data = cleaned
  }

  return picked as unknown as JobRecord | PublicJob
}

/**
 * The cost-summary twin of sanitizeJobForPublic (SAI-7 / A2).
 *
 * POST /v1/jobs/cost-summary was the one money route that skipped this
 * convention: `total_cost_usd` — top-level and per breakdown row — went to
 * every authenticated caller, while the same USD (`display_cost` /
 * `provider_cost`, which is what the nodaro-cloud provider reports as the
 * charge's `secondaryAmount`) is stripped from every job row above. The
 * frontend's admin-only "$" toggle was the only thing between a user and our
 * provider economics, i.e. one character of client config.
 *
 * Non-admins get the key ABSENT — not `null`. `null` already means "the
 * authority could not price this" (§5.2 rule 1) and must keep meaning that;
 * absence means "not yours to see". Credits and every count are untouched.
 * Admins keep the full shape. Lives here, not in workflow-costs.ts, so the
 * next money route finds the convention where sanitizeJobForPublic is.
 */
export function sanitizeCostSummaryForPublic<
  T extends { total_cost_usd?: number | null; breakdown: readonly { total_cost_usd?: number | null }[] },
>(summary: T, isAdmin: boolean): T {
  if (isAdmin) return summary
  const { total_cost_usd: _usd, ...rest } = summary
  // Same shape minus one optional key on each level; TS cannot prove that for
  // an arbitrary T, hence the unknown hop — the redaction test pins it.
  return {
    ...rest,
    breakdown: summary.breakdown.map(({ total_cost_usd: _rowUsd, ...row }) => row),
  } as unknown as T
}

export async function jobRoutes(app: FastifyInstance) {
  // Light batch-status endpoint for studio polling (every ~2s).
  // Declared BEFORE /v1/jobs/:id so the literal `status` segment wins
  // over the parametric route in Fastify's radix tree.
  app.get("/v1/jobs/status", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "jobs:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }

    const parsed = batchStatusQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "invalid_query", message: "Missing or invalid `ids` query parameter" },
      })
    }

    const { ids } = parsed.data
    if (ids.length === 0) return { jobs: [] }
    if (ids.length > 100) {
      return reply.status(400).send({
        error: { code: "too_many_ids", message: "At most 100 ids per request" },
      })
    }

    // `progress` and `error_message` match what GET /v1/jobs/:id/status
    // returns: a batch poller needs the same two answers a single poller does
    // — how far along is it, and if it failed, why. Without them a caller
    // watching N jobs can only see which have finished, not which are moving,
    // and every failure reads as a generic one.
    //
    // Same ownership filter as before, and the same fields the lean per-job
    // status route already exposes, so this widens no boundary. error_hint
    // (migration 376) and usage_log_id (credit_status, PR9) piggyback for the
    // same reason.
    // A child job is left out for a non-admin, as an id that does not exist
    // (CHILD_JOB_COLUMN); the marker tells a trend run, whose failure text a
    // non-admin never reads (maskTrendRunError removes the marker).
    const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"
    let query = supabase
      .from("jobs")
      .select(`id, status, progress, output_data, error_message, error_hint, usage_log_id, ${ORDER_QUALITY_COLUMNS}, ${TREND_RUN_MARKER_SELECT}`)
      .in("id", ids)
      .eq("user_id", req.userId)
      // A job in the Trash is left out like an id that does not exist.
      .is(TRASHED_JOB_COLUMN, null)
    if (!isAdmin) query = query.is(CHILD_JOB_COLUMN, null)
    const { data, error } = await query

    if (error) {
      return sendInternalError(reply, req, error, "Failed to fetch job statuses")
    }

    // An old render carries no stored Preview label: fill it from the order
    // (read-time only, never written; the lean answer stays lean).
    const rows = fillJobsRenderQuality(
      maskTrendRunErrors((data ?? []) as unknown as (Record<string, unknown> & { usage_log_id?: string | null })[], isAdmin),
      { dropJobType: true },
    )
    const creditMap = await creditStatusMapFor(rows.map((r) => r.usage_log_id))
    const withCreditStatus = rows.map(({ usage_log_id: usageLogId, ...rest }) => ({
      ...rest,
      credit_status: creditStatusOf(usageLogId, creditMap),
    }))

    return { jobs: redactPrivateJobData(withCreditStatus) }
  })

  app.get<{ Params: { id: string } }>("/v1/jobs/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "jobs:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }

    const { id } = req.params
    const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"

    let query = supabase
      .from("jobs")
      .select("id, status, progress, input_data, output_data, error_message, error_detail, error_hint, created_at, started_at, completed_at, user_id, provider, provider_cost, display_cost, credits, credits_actual, job_type, reconcile_attempts, source, source_detail, session_id, usage_log_id")
      .eq("id", id)
      // A job in the Trash answers, for every caller, as one that does not exist.
      .is(TRASHED_JOB_COLUMN, null)

    // A non-admin reads only their own jobs, and never a child job: it answers
    // exactly as a job that does not exist (CHILD_JOB_COLUMN).
    if (!isAdmin) {
      query = query.eq("user_id", req.userId).is(CHILD_JOB_COLUMN, null)
    }

    const { data: job, error } = await query.single()

    if (error || !job) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Job not found" },
      })
    }

    const usageLogId = (job as { usage_log_id?: string | null }).usage_log_id ?? null
    const creditMap = await creditStatusMapFor([usageLogId])
    const sideCharges = await sideHoldChargesFor([job.id])
    // The owner's favorite and rating of it — the owner's, also when an admin
    // reads it. Pollers read this route: a failed read leaves the two fields
    // out (unknown) and the job still answers.
    let ownerState: JobOwnerStateMap | null = null
    try {
      ownerState = await jobOwnerStateFor(job.user_id, [job.id])
    } catch (err) {
      req.log.warn({ err, jobId: job.id }, "job owner state unavailable: favorited / rating omitted")
    }

    return {
      data: {
        // An old render has no stored Preview label: fill it from the order
        // (read-time only; the Executions tab reads this job).
        ...sanitizeJobForPublic(fillJobRenderQuality(job) as unknown as JobRecord, isAdmin),
        credit_status: creditStatusOf(usageLogId, creditMap),
        // What was charged once the hold settled; `credits` stays the hold.
        credits_charged: creditsChargedOf(usageLogId, creditMap, job.id, sideCharges),
        ...ownerStateFields(job.id, ownerState),
      },
    }
  })

  // Lean status poll for the per-node 3s poll path. Same auth + ownership
  // semantics as GET /v1/jobs/:id (admins read any job, non-admins only
  // their own) but selects only the fields a poller needs. No cost/provider
  // columns are returned. Server-only JSON fields are still redacted below.
  app.get<{ Params: { id: string } }>("/v1/jobs/:id/status", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "jobs:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }

    const { id } = req.params
    const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"

    let query = supabase
      .from("jobs")
      .select(`id, status, progress, output_data, error_message, error_hint, completed_at, reconcile_attempts, usage_log_id, ${ORDER_QUALITY_COLUMNS}, ${TREND_RUN_MARKER_SELECT}`)
      .eq("id", id)
      .is(TRASHED_JOB_COLUMN, null)

    // As GET /v1/jobs/:id: a non-admin never reads a child job (CHILD_JOB_COLUMN).
    if (!isAdmin) {
      query = query.eq("user_id", req.userId).is(CHILD_JOB_COLUMN, null)
    }

    const { data: job, error } = await query.single()

    if (error || !job) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Job not found" },
      })
    }

    // Recovery visibility (audit UX): a processing row the reconcile system
    // has touched is being self-healed, not just slow — let pollers say so.
    // An old render carries no stored Preview label: a reopened workflow, a
    // finishing background job and the completed-job check all restore from
    // this read, so it fills the label from the order (never written back).
    const {
      reconcile_attempts: attempts,
      usage_log_id: usageLogId,
      ...rest
    } = fillJobRenderQuality(maskTrendRunError(job as unknown as Record<string, unknown>, isAdmin), { dropJobType: true }) as Record<string, unknown> & { usage_log_id?: string | null }
    const creditMap = await creditStatusMapFor([usageLogId])
    return redactPrivateJobData({
      data: {
        ...rest,
        credit_status: creditStatusOf(usageLogId, creditMap),
        ...(job.status === "processing" && ((attempts as number | null) ?? 0) > 0
          ? { recovering: true }
          : {}),
      },
    })
  })

  app.get<{
    Querystring: {
      userId?: string
      limit?: string
      cursor?: string
      attachToCharacterId?: string
      // The filters (lib/job-list-filters.ts): a list is repeated or comma-separated.
      status?: string | string[]
      type?: string | string[]
      origin?: string
      source?: string | string[]
      favorited?: string
      rating?: string
      // One generate-image batch (`count` / `models`), by its `batchId`.
      batchId?: string
      // Where the job is now (lib/job-list-filters.ts), and whether to say so.
      projectId?: string
      inSession?: string
      withSessions?: string
    }
  }>("/v1/jobs", async (req, reply) => {
    const { userId: queryUserId, limit = "50", cursor, attachToCharacterId, batchId, withSessions } = req.query
    if (withSessions !== undefined && withSessions !== "true" && withSessions !== "false") {
      return reply.status(400).send({ error: { code: "validation_error", message: "withSessions must be true or false" } })
    }
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100)
    const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"
    const currentUserId = req.userId

    if (!currentUserId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "jobs:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }

    const parsedFilters = parseJobListQuery(req.query)
    if (!parsedFilters.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsedFilters.error) },
      })
    }
    const filters = parsedFilters.data

    // Non-admins always see only their own jobs; admins can optionally filter by userId
    const filterUserId = isAdmin && queryUserId ? queryUserId : currentUserId

    // The component-execution exclusion is applied IN CODE, below — not here.
    // It used to ride a top-level
    //   .or("workflow_execution_id.is.null,workflow_executions.is_component_execution.neq.true")
    // which PostgREST cannot parse: inside `or()` a field is a bare column
    // (plus an optional `->`/`->>` path) and the dot is the SEPARATOR, so the
    // embedded path tokenized as field `workflow_executions` + operator
    // `is_component_execution` and the whole request came back PGRST100/400.
    // The route then swallowed that error, so from #1174 until the commit
    // before this one it answered an empty list to every caller.
    //
    // Nor is it expressible as a PostgREST FILTER. PostgREST computes an embed
    // as a lateral subquery in the SELECT list, so the top-level WHERE that
    // `or()` lands in has nothing to reference; filtering a PARENT row by an
    // embedded column needs `!inner`, which would drop exactly the
    // `workflow_execution_id IS NULL` rows the first disjunct exists to keep.
    // (A computed column or a view could do it query-side — not worth a
    // migration for a page of at most 100 rows.)
    //
    // `workflow_execution_id` is selected only to decide the null case. It is
    // in neither key allowlist, so `sanitizeJobForPublic` still strips it.
    //
    // The embed NAMES the key it follows (`!workflow_execution_id`): since
    // `workflow_executions.wrapper_job_id` also references `jobs`, an embed
    // between the two tables with no key is ambiguous and PostgREST refuses
    // the whole select (PGRST201) — the list answered 500.
    // `jobs-execution-embed-sites.test.ts` holds every such embed to a key.
    let query = supabase
      // trash-read: applyJobListFilters below leaves the Trash out.
      .from("jobs")
      .select("id, status, progress, input_data, output_data, error_message, error_hint, created_at, started_at, completed_at, user_id, provider, provider_cost, display_cost, credits, credits_actual, job_type, source, source_detail, session_id, usage_log_id, workflow_execution_id, workflow_executions!workflow_execution_id(is_component_execution, trigger_type)" + jobListFilterSelect(filters))
      .order("created_at", { ascending: false })
      .limit(limitNum)

    query = query.eq("user_id", filterUserId)

    // Durable per-character listing. `characters.previousCandidates` is a
    // 7-day / 5-item PORTRAIT-CANDIDATE strip, not an archive — and images
    // from `skipPortraitAttach` runs attach to no characters JSONB bucket at
    // all, so the jobs row is their only home. This filter makes every image
    // ever generated FOR a character reachable for as long as the job row
    // lives, with the list endpoint's own pagination.
    //
    // Scene renders are INCLUDED here on purpose (that is the gap this
    // closes), and are marked per-item below so a client can render them
    // without offering "promote to portrait" — the promotion path stays
    // closed by the characters-route predicate.
    if (attachToCharacterId) {
      query = query.filter("input_data->>attachToCharacterId", "eq", attachToCharacterId)
    }

    // Client-app run lists (Nodaro Studio's Director): every row carries
    // `input_data.type` (buildJobInputData stamps it on insert) and, when a
    // client app created it, `input_data.origin`. Deliberately NOT the
    // `job_type` column — that column is NULL on every row a synchronous route
    // inserted, and on the rows that DO have one the video worker OVERWRITES it
    // with the BullMQ queue name at pickup (the `job_type: job.name` line in
    // `workers/video-worker.ts`), so a `job_type` filter would both hide the
    // synchronous history this list exists to show and answer in a different
    // vocabulary than the caller asked in. `input_data.type` is written once,
    // at insert, and never rewritten — that is why it is the filter here.
    //
    // Those two, `status` and the owner's `favorited` / `rating` are applied by
    // the one filter module MCP `list_jobs` shares (lib/job-list-filters.ts),
    // all in the query, so the keyset cursor below stays correct.
    query = applyJobListFilters(query, filters, filterUserId)
    // One generate-image batch (`count` / `models`): every job of it carries
    // the same `input_data.batchId`, written once at insert.
    if (typeof batchId === "string" && batchId) {
      query = query.filter("input_data->>batchId", "eq", batchId)
    }

    // Cursor-based pagination (use created_at as cursor)
    if (cursor) {
      query = query.lt("created_at", cursor)
    }

    const { data, error: listError } = await query
    // The select carries the filters' embeds, so it is not one literal string
    // and supabase-js cannot infer the row: name it here.
    const jobs = data as unknown as ListedJobRow[] | null

    // A swallowed error here reads as "no jobs": the query fails, `jobs` is
    // undefined, and the caller gets a 200 with an empty list instead of a
    // failure it can see. Surface it, like every other query in this file.
    if (listError) {
      if (ratingsNotAvailable(filters, listError)) {
        return reply.status(503).send({
          error: { code: "not_available", message: "Ratings are not available on this server yet." },
        })
      }
      return sendInternalError(reply, req, listError, "Failed to list jobs")
    }

    // The inner-run exclusion (see the query above): keep a job that belongs
    // to no execution at all, or whose execution is not an inner run. A to-one embed arrives as an object — that is how every other
    // reader in this repo takes it (app-analytics.ts, app-runner.ts) — but an
    // unverified assumption about PostgREST's response shape is what produced
    // this bug, so accept a one-element array rather than bet the list again.
    const visibleJobs = (jobs ?? []).filter((job) => {
      if (job.workflow_execution_id == null) return true
      const embed = (job as { workflow_executions?: unknown }).workflow_executions
      const execution = (Array.isArray(embed) ? embed[0] : embed) as
        | { is_component_execution?: boolean | null; trigger_type?: string | null }
        | null
        | undefined
      // An inner run is shown only through the node that started it: a
      // component's inner jobs and a use-case node's hidden run.
      return execution?.is_component_execution !== true && execution?.trigger_type !== "use_case"
    })

    // Strip the joined workflow_executions data and the filters' embeds (only used for filtering)
    const cleanedJobs = visibleJobs.map(({ workflow_executions: _we, ...job }) => withoutFilterEmbeds(job))
    // One usage_logs read for the whole page: each job's billing lifecycle and
    // settled charge. `usage_log_id` is in neither key allowlist, so the
    // sanitizer below strips it.
    const creditMap = await creditStatusMapFor(
      cleanedJobs.map((job) => (job as { usage_log_id?: string | null }).usage_log_id),
    )
    // R53: each job's settled metered side holds, in one read for the page.
    const sideCharges = await sideHoldChargesFor(cleanedJobs.map((job) => job.id as string))
    // And one read per table for the owner's favorite and rating of each job;
    // as on GET /v1/jobs/:id, a failed read leaves the two fields out.
    let ownerState: JobOwnerStateMap | null = null
    try {
      ownerState = await jobOwnerStateFor(filterUserId, cleanedJobs.map((job) => job.id))
    } catch (err) {
      req.log.warn({ err }, "job owner state unavailable: favorited / rating omitted")
    }
    const sanitizedJobs = cleanedJobs.map((job) => {
      const usageLogId = (job as { usage_log_id?: string | null }).usage_log_id ?? null
      // An old render has no stored Preview label: fill it from the order.
      const sanitized = {
        ...sanitizeJobForPublic(fillJobRenderQuality(job) as JobRecord, isAdmin),
        credit_status: creditStatusOf(usageLogId, creditMap),
        credits_charged: creditsChargedOf(usageLogId, creditMap, job.id as string, sideCharges),
        ...ownerStateFields(job.id, ownerState),
      }
      if (!attachToCharacterId) return sanitized
      // Derived, not stored. The raw flag does reach the client inside
      // input_data today, but that blob is a free-form payload whose keys
      // `sanitizeJobForPublic` already prunes — an explicit boolean is the
      // contract a client should bind to.
      const input = (job as { input_data?: unknown }).input_data
      const skip =
        !!input && typeof input === "object" &&
        (input as Record<string, unknown>).skipPortraitAttach === true
      return { ...sanitized, isSceneRender: skip }
    })

    // Determine next cursor — from the RAW page the DB returned, never the
    // filtered one. The cursor is a `created_at` keyset, so paging off the last
    // VISIBLE row would re-read every excluded row after it on the next call;
    // a page shortened by the exclusion above is still a full page as far as
    // pagination is concerned, and must advance past the rows it dropped.
    const nextCursor = jobs && jobs.length === limitNum ? jobs[jobs.length - 1]?.created_at : null

    // The sessions each job is in now, in one read for the page — the owner's.
    let withLinks: typeof sanitizedJobs = sanitizedJobs
    if (withSessions === "true") {
      const links = await liveSessionsOfJobs(filterUserId, sanitizedJobs.map((job) => job.id as string))
      if (links.error) return sendInternalError(reply, req, links.error, "Failed to list jobs")
      withLinks = sanitizedJobs.map((job) => ({ ...job, sessions: links.data.get(job.id as string) ?? [] }))
    }

    return {
      data: withLinks,
      next: nextCursor,
      previous: null, // Not implementing backwards pagination for now
    }
  })

  // NOTE: Cancel route moved to cancel-jobs.ts (has ownership verification + BullMQ integration)

  // Batch fetch job statuses by IDs (for workflow sync)
  app.post("/v1/jobs/batch-status", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "jobs:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }

    const parsed = batchStatusBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { jobIds } = parsed.data
    const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"

    let query = supabase
      .from("jobs")
      .select(`id, status, output_data, error_message, error_hint, ${ORDER_QUALITY_COLUMNS}, ${TREND_RUN_MARKER_SELECT}`)
      .in("id", jobIds)
      .is(TRASHED_JOB_COLUMN, null)

    // A child job is left out for a non-admin, as an id that does not exist
    // (CHILD_JOB_COLUMN).
    if (!isAdmin) {
      query = query.eq("user_id", req.userId).is(CHILD_JOB_COLUMN, null)
    }

    const { data: jobs, error } = await query

    if (error) {
      return sendInternalError(reply, req, error, "Failed to fetch job statuses")
    }

    // The reopen restore reads this: an old render's Preview label comes from
    // the order (read-time only; the answer stays lean).
    return {
      data: redactPrivateJobData(
        fillJobsRenderQuality(maskTrendRunErrors((jobs ?? []) as unknown as Record<string, unknown>[], isAdmin), { dropJobType: true }),
      ),
    }
  })

  // DELETE /v1/jobs/:id (to the Trash, or `?forever=true`) and
  // POST /v1/jobs/:id/restore.
  registerJobTrashRoutes(app)
}
