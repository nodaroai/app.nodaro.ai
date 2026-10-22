import type { NodaroClientCore } from "../core.js"

/**
 * A job's lifecycle status. Hand-copied mirror of `JOB_STATUSES` in the
 * platform's `backend/src/lib/job-status.ts` — nothing links the two at build
 * time, so a new member has to be added here in the same change.
 *
 * `pending_review` is IN-FLIGHT, NOT TERMINAL: a job policy registered by the
 * deployment held the output for a human reviewer. Treat it like `processing`
 * in a `switch` — keep waiting, do not re-run — and it resolves to `completed`
 * (approved), `failed` (rejected, carrying an `error_hint` with
 * `kind: "policy-block"`) or `cancelled` (a held job is cancellable like any
 * in-flight job). `credit_status` reads `"reserved"` for the whole hold. Only
 * appears on deployments that register a job policy; `runAndWait` throws
 * {@link JobHeldError} on the first held tick rather than waiting it out.
 */
export type JobStatus =
  | "pending"
  | "queued"
  | "processing"
  | "pending_review"
  | "completed"
  | "failed"
  | "cancelled"

/**
 * A PROVIDER's verdict: the model's own safety filter refused the output.
 * `class` distinguishes a deterministic block (copyright/likeness — retrying
 * the same request never helps) from `safety`, whose filter is known to be
 * non-deterministic for some models: `retried` says whether the worker
 * already spent its one extra attempt, and `suggestedProvider` — present
 * only when the catalog declares a fallback for the model that failed — is a
 * real model id the SAME prompt/references can be retried on.
 */
export type SafetyBlockHint = {
  kind: "safety-block"
  class: "copyright" | "likeness" | "safety"
  retried: boolean
  suggestedProvider?: string
  /**
   * Present when the provider refused the INPUT VIDEO itself — not the prompt,
   * a reference image or the output. Sending a different clip is the fix.
   */
  subject?: "input_video"
}

/**
 * A NODARO-side verdict, not a provider's: a job policy registered by the
 * deployment rejected the request (`hookPoint: "request"` — nothing ran, and
 * the call itself failed with {@link JobBlockedError}) or the finished output
 * (`hookPoint: "result"` — the result was blocked and never published).
 *
 * `reason` is USER-SAFE BY CONTRACT — the platform guarantees the policy's
 * machine text (scores, labels) never reaches it — so show it to the person
 * who made the request as-is. `policyId` identifies the deployment's policy,
 * not a Nodaro product feature. Only occurs on deployments that register a
 * job policy.
 */
export type PolicyBlockHint = {
  kind: "policy-block"
  policyId: string
  reason: string
  hookPoint: "request" | "result"
}

/**
 * The job ran out of credits partway: a step that reserves its own credits
 * (for example, the video a Cast Swap or trend run dispatches) was refused —
 * the balance could not cover it, or a plan or workspace cap was reached. The
 * job failed and its credits were refunded; ask the person to top up (or raise
 * the cap), then run it again.
 *
 * `code` is the refusal's own code, a lowercase snake_case token — for
 * example `insufficient_credits`, `free_video_limit`, `instance_cap_reached`,
 * `budget_exceeded`, `member_cap_exceeded` or `user_allowance_exceeded`. Treat
 * an unknown code like `insufficient_credits`.
 */
export type CreditsHint = {
  kind: "credits"
  code: string
}

/**
 * The provider refused the job's input video without naming a content-policy
 * class (its message is about the file, not a policy). Treat it like any
 * other failure — no fallback model is offered — except that the input to
 * change is known: send a different clip.
 */
export type InputRefusedHint = {
  kind: "input-refused"
  subject: "input_video"
}

/**
 * A job's `jobs.error_hint` (migration 376) — a user-safe, machine-readable
 * failure verdict, so a caller can act on it without parsing `error_message`
 * prose. One column, several verdict sources; `kind` is the discriminant.
 *
 * HAND-COPIED MIRROR of `ErrorHint` in the platform's
 * `backend/src/lib/safety-block.ts` (which names this file in its own
 * comment). Nothing links the two at build time: a new arm there has to be
 * pasted here verbatim in the same change, with a changeset.
 * `packages/client/dist/index.d.ts` is REBUILT, never hand-edited.
 */
export type JobErrorHint = SafetyBlockHint | PolicyBlockHint | CreditsHint | InputRefusedHint

/**
 * The billing lifecycle of a job's credit reservation — `usage_logs.status`
 * for the job's `usage_log_id`. `null` when the job has no usage log (e.g. a
 * free run) or hasn't reserved credits yet.
 */
export type CreditStatus = "reserved" | "committed" | "refunded"

/** A job owner's rating of their job — set with {@link JobsResource.rate}. */
export type JobRating = "good" | "bad"

/**
 * The `rating` filter of {@link JobsResource.list}: one rating, any rating
 * (`"rated"`) or none (`"unrated"`).
 */
export type JobRatingFilter = JobRating | "rated" | "unrated"

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
  /** Present on a failed job the worker classified as a provider
   *  content-policy block (`kind: "safety-block"`) or that a deployment's job
   *  policy rejected (`kind: "policy-block"`); absent/null otherwise.
   *  User-safe by construction — narrow on `kind` before reading the rest. */
  error_hint?: JobErrorHint | null
  /** PR9: the job's credit reservation lifecycle, derived server-side from
   *  `usage_logs.status`. `null` when there is no usage log to report. Never
   *  changes the meaning of `credits` (the reserved amount) below. */
  credit_status?: CreditStatus | null
  /** The credits HELD when the job was accepted. Never changes — a job can
   *  settle below it; read {@link Job.credits_charged} for what it cost. */
  credits: number | null
  /**
   * What the job actually cost once its hold settled. Can be lower than
   * `credits` (the unused part goes back to the balance), `0` when the hold was
   * refunded, `null` while the job is still running or when it reserved
   * nothing of its own. Sum this — not `credits` — to total spend. Returned by
   * `get()` and `list()`.
   */
  credits_charged?: number | null
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
  /** The generation session this job was born in (the `sessionId` sent with
   *  the generation request), or null. See `client.sessions`. */
  session_id?: string | null
  /**
   * Whether the job's owner favorited it (`client.gallery.toggleFavorite`).
   * Returned by `get()` and `list()`. Absent from an older server, and when
   * the server could not read it for a moment — treat absent as unknown,
   * never as `false`.
   */
  favorited?: boolean
  /**
   * The owner's rating of the job ({@link JobsResource.rate}), or `null` when
   * unrated. Returned by `get()` and `list()`; absent like `favorited`.
   */
  rating?: JobRating | null
}

export interface CancelJobResult {
  success: true
  cancelled: number
  /**
   * `true` when the job could not be stopped because its provider call is
   * already running — a metered LLM job's call, an external provider task. It
   * finishes and is charged only what it used.
   */
  inFlight?: boolean
}

export interface DeleteJobResult {
  success: true
}

export interface ListJobsParams {
  /** One status or several (a job matching any of them). An unknown status is a 400. */
  status?: JobStatus | readonly JobStatus[]
  /** Exact match on `input_data.type` — the route that created the job
   *  (`"llm-structured"`, `"video-analysis"`, …). One value or several (up to 20). */
  type?: string | readonly string[]
  /** Exact match on `input_data.origin` — the client app that sent it. */
  origin?: string
  /** `true`: only jobs you favorited; `false`: only jobs you did not. */
  favorited?: boolean
  /** Your rating: `"good"`, `"bad"`, any (`"rated"`) or none (`"unrated"`). */
  rating?: JobRatingFilter
  /** The jobs of one generate-image batch (`count` / `models`) — its `batchId`. */
  batchId?: string
  /** Page size, 1–100 (server default 50). */
  limit?: number
  /** The previous page's `next`. */
  cursor?: string
}

/** What {@link JobsResource.rate} answers: the job's rating now. */
export interface RateJobResult {
  data: { jobId: string; rating: JobRating | null }
}

/**
 * {@link JobsResource.fromUpload}'s body: an image edited in the browser,
 * already stored with `client.uploads.upload`, and what it was made from.
 */
export interface JobFromUploadParams {
  /** The edited image's `assetId`, as `client.uploads.upload` returned it. */
  assetId: string
  /** The job whose image was edited. */
  sourceJobId?: string
  /** Which of `sourceJobId`'s images was edited, when it made several. Default: its `imageUrl`. */
  sourceImageUrl?: string
  /** The upload that was edited, when the source is not a job. Not with `sourceJobId`. */
  sourceAssetId?: string
  /** The editor's design state, stored with `client.uploads.uploadJson`, so the edit can be reopened. */
  editStateUrl?: string
  /** The generation session to file the job in. */
  sessionId?: string
}

/** A list filter value as the query string carries it: several are comma-separated. */
function listParam(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  return typeof value === "string" ? value : value.join(",")
}

export interface ListJobsPage {
  /**
   * A page may hold fewer than `limit` rows — even none — and still carry a
   * `next`. Page on `next`, never on `data.length`.
   */
  data: Job[]
  /** Pass back as `cursor` for the next page; `null` on the last one. */
  next: string | null
}

/**
 * Lean job status returned by `GET /v1/jobs/:id/status`. Skips the
 * `input_data` JSONB and cost columns. Its `output_data` still goes
 * through the server-only nested-field redaction. Intended for poll loops that
 * only need progress/output/error, and when the job finished.
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
  /** When the job finished, on the server's clock; null until it has. */
  completed_at?: string | null
}

export class JobsResource {
  constructor(private client: NodaroClientCore) {}

  /** Get a single job by ID. */
  get(id: string): Promise<{ data: Job }> {
    return this.client.request("GET", `/v1/jobs/${encodeURIComponent(id)}`)
  }

  /**
   * Your jobs, newest first (`GET /v1/jobs`), cursor-paginated. `type` and
   * `origin` filter on the job's own `input_data`, which every job carries —
   * a client app lists its runs with `{ type: "llm-structured", origin: "studio" }`.
   * `status` and `type` take one value or a list; `favorited` and `rating`
   * filter on your own marks. Every filter combines with AND, and each job
   * carries `favorited` and `rating`.
   */
  list(params: ListJobsParams = {}): Promise<ListJobsPage> {
    const { status, type, ...rest } = params
    return this.client.request<ListJobsPage>("GET", "/v1/jobs", {
      query: { ...rest, status: listParam(status), type: listParam(type) },
    })
  }

  /**
   * Record an image edited in the browser as a job (`POST /v1/jobs/from-upload`):
   * a completed, private, free `image-edit` job whose `output_data.imageUrl` is
   * the upload, linked to its source in `input_data` (`sourceJobId` /
   * `sourceAssetId`, `sourceImageUrl`). It then lists, rates, favorites and
   * files into a session like any image job. One upload is one job: the same
   * `assetId` again returns the same job. OAuth apps need the `assets:write`
   * scope. A deployment's job policy can refuse the image ({@link JobBlockedError}).
   */
  fromUpload(params: JobFromUploadParams): Promise<{ data: Job }> {
    return this.client.request<{ data: Job }>("POST", "/v1/jobs/from-upload", { body: params })
  }

  /**
   * Rate one of your jobs `"good"` or `"bad"`, or clear the rating with
   * `null` (`PUT /v1/jobs/:id/rating`). Only the job's owner rates it — anyone
   * else's job is a `NotFoundError`. The rating reads back as `Job.rating`
   * and filters {@link list}. OAuth apps need the `assets:write` scope.
   */
  rate(id: string, rating: JobRating | null): Promise<RateJobResult> {
    return this.client.request<RateJobResult>("PUT", `/v1/jobs/${encodeURIComponent(id)}/rating`, {
      body: { rating },
    })
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
   * Refunds any reserved credit holds. A running LLM job priced per model
   * (metered) whose call has already started answers
   * `{ success: true, cancelled: 0, inFlight: true }`: it finishes and is
   * charged only what it used. A job stopped before its call starts is
   * refunded, except for what an earlier attempt of the same job already used
   * (a retry after a billed attempt): that is charged.
   */
  cancel(id: string): Promise<CancelJobResult> {
    return this.client.request(
      "POST",
      `/v1/jobs/${encodeURIComponent(id)}/cancel`,
    )
  }

  /**
   * Delete a job and the private media it produced. Server route is
   * `DELETE /v1/jobs/:jobId`. Only the job's owner (or an admin) may delete it;
   * a job that is still running is deleted as-is — cancel it first when its
   * worker should stop ({@link cancel}).
   */
  delete(id: string): Promise<DeleteJobResult> {
    return this.client.request(
      "DELETE",
      `/v1/jobs/${encodeURIComponent(id)}`,
    )
  }
}
