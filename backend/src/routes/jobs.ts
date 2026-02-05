import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"

// Job type from database
interface JobRecord {
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
}

// Public job type (for cloud edition regular users)
interface PublicJob {
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
}

/**
 * Sanitize job data for public API response.
 * In cloud edition, hide provider details from regular users.
 * - Remove `provider` field (internal implementation detail)
 * - Remove `provider_cost` field (our actual cost - sensitive)
 * - Rename `display_cost` to `cost` (what the user pays)
 */
function sanitizeJobForPublic(job: JobRecord, isAdmin: boolean): JobRecord | PublicJob {
  // Debug logging to trace sanitization
  console.log(`[jobs] sanitizeJobForPublic - EDITION: "${config.EDITION}", isAdmin: ${isAdmin}`)

  // Self-hosted edition or admin users: return full data
  if (config.EDITION === "self-hosted" || isAdmin) {
    console.log(`[jobs] Returning full job data (self-hosted or admin)`)
    return job
  }

  // Cloud edition regular users: hide sensitive provider details
  console.log(`[jobs] Sanitizing for cloud user - hiding provider details, renaming display_cost to cost`)
  const { provider, provider_cost, display_cost, ...rest } = job
  return {
    ...rest,
    cost: display_cost,
  }
}

export async function jobRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: { admin?: string } }>("/v1/jobs/:id", async (req, reply) => {
    const { id } = req.params
    const isAdmin = req.query.admin === "true" // TODO: Replace with proper auth check

    const { data: job, error } = await supabase
      .from("jobs")
      .select("id, status, progress, input_data, output_data, error_message, created_at, started_at, completed_at, user_id, provider, provider_cost, display_cost")
      .eq("id", id)
      .single()

    if (error || !job) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Job not found" },
      })
    }

    return { data: sanitizeJobForPublic(job as JobRecord, isAdmin) }
  })

  app.get<{ Querystring: { userId?: string; limit?: string; cursor?: string; admin?: string } }>("/v1/jobs", async (req) => {
    const { userId, limit = "50", cursor, admin } = req.query
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100)
    const isAdmin = admin === "true" // TODO: Replace with proper auth check

    let query = supabase
      .from("jobs")
      .select("id, status, progress, input_data, output_data, error_message, created_at, started_at, completed_at, user_id, provider, provider_cost, display_cost")
      .order("created_at", { ascending: false })
      .limit(limitNum)

    // Filter by user_id if provided
    if (userId) {
      query = query.eq("user_id", userId)
    }

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

  app.delete<{ Params: { id: string } }>("/v1/jobs/:id", async (req, reply) => {
    const { id } = req.params

    const { error } = await supabase
      .from("jobs")
      .delete()
      .eq("id", id)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { success: true }
  })
}
