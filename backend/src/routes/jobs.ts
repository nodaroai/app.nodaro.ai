import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { requireScope } from "../lib/scopes.js"
import { formatZodError } from "../lib/zod-error.js"

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
    status: z.enum(["pending", "queued", "processing", "completed", "failed", "cancelled"]),
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
  })
  .openapi("Job")

// Lean status shape for the per-node poll path (every ~3s). Selects only the
// fields a poller needs (status + progress + output/error) — no input_data,
// cost, timestamps, or provider columns — to keep the hot-path payload small.
const JobStatus = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["pending", "queued", "processing", "completed", "failed", "cancelled"]),
    progress: z.number().min(0).max(100),
    output_data: z.unknown(),
    error_message: z.string().nullable(),
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
}

// Public job type (for regular users). USD-denominated `cost` removed
// per the api/sdk/mcp-wide policy: regular callers see only `credits`.
// Admins keep the full JobRecord shape (with provider / provider_cost /
// display_cost / credits_actual).
export interface PublicJob {
  id: string
  status: string
  progress: number
  input_data: unknown
  output_data: unknown
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  user_id: string
  credits: number | null
  job_type: string | null
}

/**
 * Sanitize job data for public API response.
 *
 * Non-admin callers see only the credits abstraction — USD pricing
 * (display_cost / provider_cost) is admin-only, same pattern as the
 * frontend's `sanitizeJobForPublic` filter. Provider id is also hidden
 * (internal implementation detail; the user only knows the model id
 * they picked, which is preserved in input_data).
 *
 * Admins (req.userRole === 'admin') see the full record including
 * provider, provider_cost, display_cost, and credits_actual.
 */
export function sanitizeJobForPublic(job: JobRecord, isAdmin: boolean): JobRecord | PublicJob {
  // Admin users: return full data
  if (isAdmin) {
    return job
  }

  // Regular users: strip ALL USD-denominated cost fields. Credits stay
  // (that's the abstraction the user is billed in). The previous
  // version renamed display_cost → cost, which still leaked USD; user
  // explicitly asked for USD to be admin-only across api/sdk/mcp.
  const {
    provider: _provider,
    provider_cost: _providerCost,
    display_cost: _displayCost,
    credits_actual: _creditsActual,
    ...rest
  } = job

  // Also strip internal fields from input_data (orchestrator stores full payload)
  if (rest.input_data && typeof rest.input_data === "object") {
    const cleaned = { ...(rest.input_data as Record<string, unknown>) }
    delete cleaned.userId
    delete cleaned.jobId
    delete cleaned.usageLogId
    delete cleaned.force_private
    delete cleaned.provider
    rest.input_data = cleaned
  }

  return rest
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

    const { data, error } = await supabase
      .from("jobs")
      .select("id, status, output_data")
      .in("id", ids)
      .eq("user_id", req.userId)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { jobs: data ?? [] }
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
      .select("id, status, progress, input_data, output_data, error_message, created_at, started_at, completed_at, user_id, provider, provider_cost, display_cost, credits, credits_actual")
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

    return { data: sanitizeJobForPublic(job as JobRecord, isAdmin) }
  })

  // Lean status poll for the per-node 3s poll path. Same auth + ownership
  // semantics as GET /v1/jobs/:id (admins read any job, non-admins only
  // their own) but selects only the fields a poller needs. No cost/provider
  // columns are returned, so no sanitization is required.
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
      .select("id, status, progress, output_data, error_message")
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

    return { data: job }
  })

  app.get<{ Querystring: { userId?: string; limit?: string; cursor?: string } }>("/v1/jobs", async (req, reply) => {
    const { userId: queryUserId, limit = "50", cursor } = req.query
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100)
    const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"
    const currentUserId = req.userId

    if (!currentUserId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Non-admins always see only their own jobs; admins can optionally filter by userId
    const filterUserId = isAdmin && queryUserId ? queryUserId : currentUserId

    let query = supabase
      .from("jobs")
      .select("id, status, progress, input_data, output_data, error_message, created_at, started_at, completed_at, user_id, provider, provider_cost, display_cost, credits, credits_actual, job_type, workflow_executions!left(is_component_execution)")
      .or("workflow_execution_id.is.null,workflow_executions.is_component_execution.neq.true")
      .order("created_at", { ascending: false })
      .limit(limitNum)

    query = query.eq("user_id", filterUserId)

    // Cursor-based pagination (use created_at as cursor)
    if (cursor) {
      query = query.lt("created_at", cursor)
    }

    const { data: jobs } = await query

    // Strip the joined workflow_executions data (only used for filtering)
    const cleanedJobs = (jobs ?? []).map(({ workflow_executions: _we, ...job }) => job)
    const sanitizedJobs = cleanedJobs.map((job) => sanitizeJobForPublic(job as JobRecord, isAdmin))

    // Determine next cursor
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
      .select("id, status, output_data, error_message")
      .in("id", jobIds)

    if (!isAdmin) {
      query = query.eq("user_id", req.userId)
    }

    const { data: jobs, error } = await query

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: jobs ?? [] }
  })

  app.delete<{ Params: { id: string } }>("/v1/jobs/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const { id } = req.params
    const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"

    let query = supabase
      .from("jobs")
      .delete()
      .eq("id", id)

    if (!isAdmin) {
      query = query.eq("user_id", req.userId)
    }

    const { error } = await query

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { success: true }
  })
}
