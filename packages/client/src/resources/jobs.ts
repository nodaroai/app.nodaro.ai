import type { NodaroClient } from "../client.js"

export type JobStatus =
  | "pending"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"

/**
 * A job's `jobs.error_hint` (migration 376) — a user-safe, machine-readable
 * failure verdict the worker writes on a FINAL provider content-policy
 * block, so a caller can act on it without parsing `error_message` prose.
 * `class` distinguishes a deterministic block (copyright/likeness — retrying
 * the same request never helps) from `safety`, whose filter is known to be
 * non-deterministic for some models: `retried` says whether the worker
 * already spent its one extra attempt, and `suggestedProvider` — present
 * only when the catalog declares a fallback for the model that failed — is a
 * real model id the SAME prompt/references can be retried on.
 */
export interface JobErrorHint {
  kind: "safety-block"
  class: "copyright" | "likeness" | "safety"
  retried: boolean
  suggestedProvider?: string
}

/**
 * The billing lifecycle of a job's credit reservation — `usage_logs.status`
 * for the job's `usage_log_id`. `null` when the job has no usage log (e.g. a
 * free run) or hasn't reserved credits yet.
 */
export type CreditStatus = "reserved" | "committed" | "refunded"

/**
 * Job record returned to non-admin SDK consumers. Field names are snake_case
 * to match the wire format (per the OpenAPI fix in Phase 1).
 *
 * Sensitive fields stripped server-side for non-admin callers:
 * `provider`, `provider_cost`, `display_cost`, `credits_actual`. USD
 * pricing is admin-only across api/sdk/mcp — non-admin consumers see
 * only the `credits` abstraction. Server-only nested job data (including
 * Recast's private remux base) is stripped for every caller, including admins.
 */
export interface Job {
  id: string
  status: JobStatus
  progress: number
  user_id: string
  input_data: unknown
  output_data: unknown
  error_message: string | null
  /** PR9: present on a failed job the worker classified as a content-policy
   *  block; absent/null otherwise. User-safe by construction. */
  error_hint?: JobErrorHint | null
  /** PR9: the job's credit reservation lifecycle, derived server-side from
   *  `usage_logs.status`. `null` when there is no usage log to report. Never
   *  changes the meaning of `credits` (the reserved amount) below. */
  credit_status?: CreditStatus | null
  credits: number | null
  job_type: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  /**
   * Provenance: which kind of caller created the job — one of
   * `"internal" | "mcp" | "app" | "cli" | "sdk" | "extension" | "web" | "api"`.
   * `source_detail` narrows it (origin host, `extension/<name>` label,
   * `sdk/<version>`, MCP client name, developer-app id). Descriptive only;
   * lets a library view label or filter media by origin.
   */
  source?: string | null
  source_detail?: string | null
}

export interface CancelJobResult {
  success: true
  cancelled: number
}

export interface ListJobsParams {
  /** Exact match on `input_data.type` — the route that created the job
   *  (`"llm-structured"`, `"video-analysis"`, …). */
  type?: string
  /** Exact match on `input_data.origin` — the client app that sent it. */
  origin?: string
  /** Page size, 1–100 (server default 50). */
  limit?: number
  /** The previous page's `next`. */
  cursor?: string
}

export interface ListJobsPage {
  data: Job[]
  /** Pass back as `cursor` for the next page; `null` on the last one. */
  next: string | null
}

/**
 * Lean job status returned by `GET /v1/jobs/:id/status`. Skips the
 * `input_data` JSONB and cost/timestamp columns. Its `output_data` still goes
 * through the server-only nested-field redaction. Intended for poll loops that
 * only need progress/output/error.
 */
export interface JobStatusResult {
  id: string
  status: JobStatus
  progress?: number
  output_data?: unknown
  error_message?: string | null
  /** PR9: see {@link Job.error_hint}. */
  error_hint?: JobErrorHint | null
  /** PR9: see {@link Job.credit_status}. */
  credit_status?: CreditStatus | null
}

export class JobsResource {
  constructor(private client: NodaroClient) {}

  /** Get a single job by ID. */
  get(id: string): Promise<{ data: Job }> {
    return this.client.request("GET", `/v1/jobs/${encodeURIComponent(id)}`)
  }

  /**
   * Your jobs, newest first (`GET /v1/jobs`), cursor-paginated. `type` and
   * `origin` filter on the job's own `input_data`, which every job carries —
   * a client app lists its runs with `{ type: "llm-structured", origin: "studio" }`.
   */
  list(params: ListJobsParams = {}): Promise<ListJobsPage> {
    return this.client.request<ListJobsPage>("GET", "/v1/jobs", { query: { ...params } })
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
