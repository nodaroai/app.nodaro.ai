import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { requireScope } from "../lib/scopes.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { JOB_STATUSES } from "../lib/job-status.js"
import { redactPrivateJobData } from "../lib/public-job-data.js"
import { deleteJobWithPrivateMedia } from "../lib/workflow-delete.js"
import type { ErrorHint } from "../lib/safety-block.js"

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

const JobSummary = z
  .object({
    id: z.string().uuid(),
    status: z.enum(JOB_STATUSES),
    progress: z.number().min(0).max(100),
    user_id: z.string().uuid(),
    input_data: z.unknown(),
    output_data: z.unknown(),
    error_message: z.string().nullable(),
    cost: z.number().nullable(),
    credits: z.number().nullable(),
    job_type: z.string().nullable(),
    created_at: z.string(),
    started_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    recovering: z
      .boolean()
      .optional()
      .describe(
        "Present (true) while the platform's reconcile system is self-healing this job — it will complete or be refunded automatically.",
      ),
  })
  .openapi("Job")

// Lean status shape for the per-node poll path (every ~3s). Selects only the
// fields a poller needs (status + progress + output/error) — no input_data,
// cost, timestamps, or provider columns — to keep the hot-path payload small.
const JobStatus = z
  .object({
    id: z.string().uuid(),
    status: z.enum(JOB_STATUSES),
    progress: z.number().min(0).max(100),
    output_data: z.unknown(),
    error_message: z.string().nullable(),
    recovering: z
      .boolean()
      .optional()
      .describe(
        "Present (true) while the platform's reconcile system is self-healing this job — the worker abandoned it after the provider delivered; it will complete or be refunded automatically.",
      ),
  })
  .openapi("JobStatus")

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/jobs/{id}",
  description: "Get the status and result of a single job.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Job details",
      content: {
        "application/json": {
          schema: z.object({ data: JobSummary }),
        },
      },
    },
    401: { description: "Unauthorized" },
    404: { description: "Job not found" },
  },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/jobs/{id}/status",
  description:
    "Lightweight job status for polling. Returns only status, progress, output, and error — no input_data, cost, or timestamps.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Job status",
      content: {
        "application/json": {
          schema: z.object({ data: JobStatus }),
        },
      },
    },
    401: { description: "Unauthorized" },
    404: { description: "Job not found" },
  },
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
}

/** Every key a NON-admin caller may see. An ALLOWLIST (W0, 2026-09-01):
 *  `jobs` gains columns over time (error_detail, cost columns, reconcile
 *  counters) and a denylist made each one owner-visible by default. Adding a
 *  column now requires adding it here on purpose. `recovering` is derived. */
export const PUBLIC_JOB_KEYS = [
  "id", "status", "progress", "input_data", "output_data", "error_message",
  "error_hint", "created_at", "started_at", "completed_at", "user_id", "credits",
  "job_type", "source", "source_detail",
] as const

/** Keys admins see in addition — provider internals, USD costs, the raw
 *  provider error, the reconcile counter. */
export const ADMIN_ONLY_JOB_KEYS = [
  "provider", "provider_cost", "display_cost", "credits_actual", "error_detail", "reconcile_attempts",
] as const

export type PublicJob = Pick<JobRecord, Extract<(typeof PUBLIC_JOB_KEYS)[number], keyof JobRecord>> & { recovering?: true }

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
 * base is redacted for every caller (redactPrivateJobData).
 */
export function sanitizeJobForPublic(job: JobRecord, isAdmin: boolean): JobRecord | PublicJob {
  const redacted = redactPrivateJobData(job) as unknown as Record<string, unknown>
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

export type CreditStatus = "reserved" | "committed" | "refunded"

/**
 * The billing-lifecycle twin of a job's `credits` field (PR9, migration 376's
 * neighbor): `credits` is the amount reserved and never changes meaning once
 * set, but a caller polling a job has no way to tell whether that reservation
 * is still held, was committed on delivery, or was refunded on failure.
 * `usage_logs.status` is that answer — a real column (019/025 migrations),
 * not a metadata key.
 *
 * ONE query for every id in the response (never one per job): callers pass
 * every `usage_log_id` they have, including duplicates/nulls, and get back a
 * `Map` keyed by usage_log_id. A job with no usage log (nothing to reserve
 * against, e.g. a free/zero-cost run) is simply absent from the map —
 * `creditStatusOf` below is what turns that into the documented `null`.
 */
export async function creditStatusMapFor(
  usageLogIds: readonly (string | null | undefined)[],
): Promise<Map<string, CreditStatus>> {
  const ids = Array.from(new Set(usageLogIds.filter((id): id is string => Boolean(id))))
  const map = new Map<string, CreditStatus>()
  if (ids.length === 0) return map

  const { data } = await supabase.from("usage_logs").select("id, status").in("id", ids)
  for (const row of (data ?? []) as { id: string; status?: string | null }[]) {
    if (row.status === "reserved" || row.status === "committed" || row.status === "refunded") {
      map.set(row.id, row.status)
    }
  }
  return map
}

/** `null` for both "no usage log" and "usage log row missing/unrecognized
 *  status" — the caller never needs to distinguish those two, and `null`
 *  is already the documented "not available" spelling for this field. */
export function creditStatusOf(
  usageLogId: string | null | undefined,
  map: Map<string, CreditStatus>,
): CreditStatus | null {
  return usageLogId ? map.get(usageLogId) ?? null : null
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
    const { data, error } = await supabase
      .from("jobs")
      .select("id, status, progress, output_data, error_message, error_hint, usage_log_id")
      .in("id", ids)
      .eq("user_id", req.userId)

    if (error) {
      return sendInternalError(reply, req, error, "Failed to fetch job statuses")
    }

    const rows = (data ?? []) as (Record<string, unknown> & { usage_log_id?: string | null })[]
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
      .select("id, status, progress, input_data, output_data, error_message, error_detail, error_hint, created_at, started_at, completed_at, user_id, provider, provider_cost, display_cost, credits, credits_actual, job_type, reconcile_attempts, source, source_detail, usage_log_id")
      .eq("id", id)

    if (!isAdmin) {
      query = query.eq("user_id", req.userId)
    }

    const { data: job, error } = await query.single()

    if (error || !job) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Job not found" },
      })
    }

    const usageLogId = (job as { usage_log_id?: string | null }).usage_log_id ?? null
    const creditMap = await creditStatusMapFor([usageLogId])

    return {
      data: {
        ...sanitizeJobForPublic(job as unknown as JobRecord, isAdmin),
        credit_status: creditStatusOf(usageLogId, creditMap),
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
      .select("id, status, progress, output_data, error_message, error_hint, reconcile_attempts, usage_log_id")
      .eq("id", id)

    if (!isAdmin) {
      query = query.eq("user_id", req.userId)
    }

    const { data: job, error } = await query.single()

    if (error || !job) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Job not found" },
      })
    }

    // Recovery visibility (audit UX): a processing row the reconcile system
    // has touched is being self-healed, not just slow — let pollers say so.
    const {
      reconcile_attempts: attempts,
      usage_log_id: usageLogId,
      ...rest
    } = job as Record<string, unknown> & { usage_log_id?: string | null }
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
      type?: string
      origin?: string
    }
  }>("/v1/jobs", async (req, reply) => {
    const { userId: queryUserId, limit = "50", cursor, attachToCharacterId, type, origin } = req.query
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
    // It is not fixable in the query either. PostgREST computes an embed as a
    // lateral subquery in the SELECT list, so the top-level WHERE that `or()`
    // lands in has nothing to reference; filtering a PARENT row by an embedded
    // column needs `!inner`, which would drop exactly the
    // `workflow_execution_id IS NULL` rows the first disjunct exists to keep.
    //
    // `workflow_execution_id` is selected only to decide the null case. It is
    // in neither key allowlist, so `sanitizeJobForPublic` still strips it.
    let query = supabase
      .from("jobs")
      .select("id, status, progress, input_data, output_data, error_message, error_hint, created_at, started_at, completed_at, user_id, provider, provider_cost, display_cost, credits, credits_actual, job_type, source, source_detail, workflow_execution_id, workflow_executions!left(is_component_execution)")
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
    // `job_type` column — that is written by queue workers at pickup and is
    // NULL on every row a synchronous route inserted, so a column filter
    // would hide exactly the history a run list exists to show.
    if (type) {
      query = query.filter("input_data->>type", "eq", type)
    }
    if (origin) {
      query = query.filter("input_data->>origin", "eq", origin)
    }

    // Cursor-based pagination (use created_at as cursor)
    if (cursor) {
      query = query.lt("created_at", cursor)
    }

    const { data: jobs, error: listError } = await query

    // A swallowed error here reads as "no jobs": the query fails, `jobs` is
    // undefined, and the caller gets a 200 with an empty list instead of a
    // failure it can see. Surface it, like every other query in this file.
    if (listError) {
      return sendInternalError(reply, req, listError, "Failed to list jobs")
    }

    // The component-execution exclusion (see the query above): keep a job that
    // belongs to no execution at all, or whose execution is not a component
    // execution. A to-one embed arrives as an object — that is how every other
    // reader in this repo takes it (app-analytics.ts, app-runner.ts) — but an
    // unverified assumption about PostgREST's response shape is what produced
    // this bug, so accept a one-element array rather than bet the list again.
    const visibleJobs = (jobs ?? []).filter((job) => {
      if (job.workflow_execution_id == null) return true
      const embed = (job as { workflow_executions?: unknown }).workflow_executions
      const execution = (Array.isArray(embed) ? embed[0] : embed) as
        | { is_component_execution?: boolean | null }
        | null
        | undefined
      return execution?.is_component_execution !== true
    })

    // Strip the joined workflow_executions data (only used for filtering)
    const cleanedJobs = visibleJobs.map(({ workflow_executions: _we, ...job }) => job)
    const sanitizedJobs = cleanedJobs.map((job) => {
      const sanitized = sanitizeJobForPublic(job as JobRecord, isAdmin)
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

    return {
      data: sanitizedJobs,
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
      .select("id, status, output_data, error_message, error_hint")
      .in("id", jobIds)

    if (!isAdmin) {
      query = query.eq("user_id", req.userId)
    }

    const { data: jobs, error } = await query

    if (error) {
      return sendInternalError(reply, req, error, "Failed to fetch job statuses")
    }

    return { data: redactPrivateJobData(jobs ?? []) }
  })

  app.delete<{ Params: { id: string } }>("/v1/jobs/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const { id } = req.params
    const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"

    try {
      await deleteJobWithPrivateMedia({
        jobId: id,
        actorUserId: req.userId,
        isAdmin,
        logger: req.log,
      })
    } catch (error) {
      return sendInternalError(reply, req, error, "Failed to delete job")
    }

    return { success: true }
  })
}
