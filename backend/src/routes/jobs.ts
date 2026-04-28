import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { openApiRegistry } from "../lib/openapi-registry.js"

const batchStatusBody = z.object({
  jobIds: z.array(z.string().min(1)).min(1).max(100),
})

// ---------------------------------------------------------------------------
// OpenAPI seed: GET /v1/jobs/{id}
// ---------------------------------------------------------------------------

const JobSummary = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["pending", "queued", "processing", "completed", "failed", "cancelled"]),
    progress: z.number().min(0).max(100).optional(),
    userId: z.string().uuid(),
    inputData: z.unknown().optional(),
    outputData: z.unknown().optional(),
    errorMessage: z.string().nullable().optional(),
    cost: z.number().nullable().optional(),
    credits: z.number().nullable().optional(),
    createdAt: z.string(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
  })
  .openapi("Job")

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

// Public job type (for regular users)
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
  cost: number | null
  credits: number | null
  job_type: string | null
}

/**
 * Sanitize job data for public API response.
 * Hide provider details from regular (non-admin) users:
 * - Remove `provider` field (internal implementation detail)
 * - Remove `provider_cost` field (our actual cost - sensitive)
 * - Rename `display_cost` to `cost` (what the user pays)
 */
export function sanitizeJobForPublic(job: JobRecord, isAdmin: boolean): JobRecord | PublicJob {
  // Admin users: return full data
  if (isAdmin) {
    return job
  }

  // Regular users: hide sensitive provider/cost details
  const { provider, provider_cost, display_cost, credits_actual, ...rest } = job

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

  return {
    ...rest,
    cost: display_cost,
  }
}

export async function jobRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/v1/jobs/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
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
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request" },
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
