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
 * Sensitive fields (`provider`, `provider_cost`, `credits_actual`) are
 * stripped server-side for non-admin callers; `display_cost` is renamed to
 * `cost`.
 */
export interface Job {
  id: string
  status: JobStatus
  progress: number
  user_id: string
  input_data: unknown
  output_data: unknown
  error_message: string | null
  cost: number | null
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

export class JobsResource {
  constructor(private client: NodaroClient) {}

  /** Get a single job by ID. */
  get(id: string): Promise<{ data: Job }> {
    return this.client.request("GET", `/v1/jobs/${encodeURIComponent(id)}`)
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
