import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { isCloud } from "../lib/config.js"

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
  job_type: string | null
}

// Public job type (for cloud edition regular users)
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
 * In cloud edition, hide provider details from regular users.
 * - Remove `provider` field (internal implementation detail)
 * - Remove `provider_cost` field (our actual cost - sensitive)
 * - Rename `display_cost` to `cost` (what the user pays)
 */
export function sanitizeJobForPublic(job: JobRecord, isAdmin: boolean): JobRecord | PublicJob {
  // Self-hosted edition or admin users: return full data
  if (!isCloud() || isAdmin) {
    return job
  }

  // Cloud edition regular users: hide sensitive provider details
  const { provider, provider_cost, display_cost, ...rest } = job
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
      .select("id, status, progress, input_data, output_data, error_message, created_at, started_at, completed_at, user_id, provider, provider_cost, display_cost, credits")
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
      .select("id, status, progress, input_data, output_data, error_message, created_at, started_at, completed_at, user_id, provider, provider_cost, display_cost, credits, job_type")
      .order("created_at", { ascending: false })
      .limit(limitNum)

    query = query.eq("user_id", filterUserId)

    // Cursor-based pagination (use created_at as cursor)
    if (cursor) {
      query = query.lt("created_at", cursor)
    }

    const { data: jobs } = await query

    // Sanitize jobs for public response
    const sanitizedJobs = (jobs ?? []).map((job) => sanitizeJobForPublic(job as JobRecord, isAdmin))

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
  app.post<{ Body: { jobIds: string[] } }>("/v1/jobs/batch-status", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const { jobIds } = req.body

    if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "jobIds array is required" },
      })
    }

    // Limit to 100 job IDs per request
    if (jobIds.length > 100) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "Maximum 100 job IDs per request" },
      })
    }

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
