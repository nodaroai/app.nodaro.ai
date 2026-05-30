import type { NodaroClient } from "../client.js"

export type JobStatus =
  | "pending"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"

/**
 * Job record returned to non-admin SDK consumers. Field names are snake_case
 * to match the wire format (per the OpenAPI fix in Phase 1).
 *
 * Sensitive fields stripped server-side for non-admin callers:
 * `provider`, `provider_cost`, `display_cost`, `credits_actual`. USD
 * pricing is admin-only across api/sdk/mcp — non-admin consumers see
 * only the `credits` abstraction.
 */
export interface Job {
  id: string
  status: JobStatus
  progress: number
  user_id: string
  input_data: unknown
  output_data: unknown
  error_message: string | null
  credits: number | null
  job_type: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface CancelJobResult {
  success: true
  cancelled: number
}

/**
 * Lean job status returned by `GET /v1/jobs/:id/status`. Skips the
 * `input_data` JSONB, cost/timestamp columns, and the public sanitize pass —
 * intended for poll loops that only need progress/output/error.
 */
export interface JobStatusResult {
  id: string
  status: JobStatus
  progress?: number
  output_data?: unknown
  error_message?: string | null
}

export class JobsResource {
  constructor(private client: NodaroClient) {}

  /** Get a single job by ID. */
  get(id: string): Promise<{ data: Job }> {
    return this.client.request("GET", `/v1/jobs/${encodeURIComponent(id)}`)
  }

  /**
   * Get the lean status of a single job (poll-loop friendly).
   * Hits `GET /v1/jobs/:id/status` — returns only id/status/progress/
   * output_data/error_message, with far less wire/CPU cost than `get()`.
   * Same auth + ownership semantics as {@link get}.
   */
  getStatus(id: string): Promise<{ data: JobStatusResult }> {
    return this.client.request(
      "GET",
      `/v1/jobs/${encodeURIComponent(id)}/status`,
    )
  }

  /**
   * Cancel a job. Server route is `POST /v1/jobs/:jobId/cancel`.
   * Refunds any reserved credit holds.
   */
  cancel(id: string): Promise<CancelJobResult> {
    return this.client.request(
      "POST",
      `/v1/jobs/${encodeURIComponent(id)}/cancel`,
    )
  }
}
