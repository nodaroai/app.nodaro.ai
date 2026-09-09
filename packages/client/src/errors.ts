import type { StudioOpsResponse } from "./resources/studio-productions.js"

export class NodaroError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = "NodaroError"
  }
}

export class UnauthorizedError extends NodaroError {
  constructor(message = "Authentication required") {
    super(message, "unauthorized", 401)
    this.name = "UnauthorizedError"
  }
}

export class ForbiddenError extends NodaroError {
  constructor(message = "Forbidden", public readonly missingScope?: string) {
    super(message, "forbidden", 403)
    this.name = "ForbiddenError"
  }
}

export class NotFoundError extends NodaroError {
  constructor(message = "Not found") {
    super(message, "not_found", 404)
    this.name = "NotFoundError"
  }
}

export class RateLimitedError extends NodaroError {
  constructor(message = "Rate limited") {
    super(message, "rate_limited", 429)
    this.name = "RateLimitedError"
  }
}

export class InsufficientCreditsError extends NodaroError {
  constructor(
    message = "Insufficient credits",
    public readonly required?: number,
    public readonly available?: number,
  ) {
    super(message, "insufficient_credits", 402)
    this.name = "InsufficientCreditsError"
  }
}

export class StorageExceededError extends NodaroError {
  constructor(message = "Storage exceeded", public readonly limitBytes?: number) {
    super(message, "storage_exceeded", 413)
    this.name = "StorageExceededError"
  }
}

/**
 * Optimistic-concurrency rejection (HTTP 409 `workflow_conflict`): the workflow
 * was written by another tab/device after the state carried in
 * `expectedUpdatedAt`/`expectedVersion` was read. `currentRecord` — when the
 * server includes it — is the full current workflow: merge your changes onto it
 * and retry with its fresh `updatedAt`, no follow-up GET needed.
 */
export class WorkflowConflictError extends NodaroError {
  constructor(
    message = "Workflow was updated by another writer",
    public readonly currentUpdatedAt?: string,
    public readonly currentVersion?: number,
    public readonly currentRecord?: Record<string, unknown>,
    /**
     * The wire code this conflict actually arrived with.
     *
     * `production_busy` is the studio production routes' own 409: the row
     * changed under a read-modify-write and the server exhausted its retries.
     * It is the same situation and the same remedy — re-read and apply again —
     * so it is the same ERROR, and a caller catching `WorkflowConflictError`
     * handles both. The code stays truthful because a caller that logs or
     * branches on it should see what the server said, not what the class is
     * usually called.
     */
    code: WorkflowConflictCode = "workflow_conflict",
  ) {
    super(message, code, 409)
    this.name = "WorkflowConflictError"
  }
}

/** The 409 codes that mean "somebody else wrote first; re-read and retry". */
export type WorkflowConflictCode = "workflow_conflict" | "production_busy"

/**
 * A studio operation batch was refused, and the error names WHICH operation
 * (`opIndex`, zero-based) was wrong. Nothing in the batch was written: a batch
 * applies atomically or not at all, so fix that one operation and send the
 * whole batch again.
 *
 * Selected by SHAPE — any 4xx carrying a numeric `opIndex` — not by a list of
 * codes, so a new refusal reason (`op_invalid`, `op_target_missing`, whatever
 * the server adds next) reaches the caller as this error without an SDK
 * release. `code` is whatever the server sent.
 */
export class StudioOpError extends NodaroError {
  constructor(
    message: string,
    code: string,
    status: number,
    /** Zero-based index into the `ops` array that was sent. */
    public readonly opIndex: number,
  ) {
    super(message, code, status)
    this.name = "StudioOpError"
  }
}

/**
 * HTTP 422 `job_blocked`. A job policy registered by this deployment refused
 * the generation **before it ran** — no job was created, nothing was reserved
 * and nothing was charged. `message` is the policy's user-safe text: show it
 * as-is. Do not retry the identical request; whether the same input would be
 * judged differently is the deployment's policy's business.
 *
 * Only occurs on deployments that register a job policy. Selected by `code`,
 * not by status, the same way `workflow_conflict` narrows a 409 above — any
 * other 422 stays a plain `NodaroError`.
 */
export class JobBlockedError extends NodaroError {
  constructor(message = "Blocked by this deployment's content policy") {
    super(message, "job_blocked", 422)
    this.name = "JobBlockedError"
  }
}

/**
 * A job reached a terminal `failed`/`cancelled` status while being awaited by
 * `nodes.runAndWait` / `nodes.runMany`. Not an HTTP-level error (the polls
 * themselves succeeded), so `status` is 0 — distinguish it by type/`code`.
 * Carries the job's own `error_message` (as the message) and `jobId`.
 */
export class JobFailedError extends NodaroError {
  constructor(
    message: string,
    public readonly jobId: string,
    /** The terminal status that triggered the failure (`failed` | `cancelled`). */
    public readonly jobStatus: "failed" | "cancelled" = "failed",
  ) {
    super(message, "job_failed", 0)
    this.name = "JobFailedError"
  }
}

/**
 * `nodes.runAndWait` polled past its `maxMs` deadline without the job reaching
 * a terminal status. Not an HTTP error — `status` is 0; catch by type/`code`.
 */
export class JobTimeoutError extends NodaroError {
  constructor(
    message: string,
    public readonly jobId: string,
    /** The wall-clock deadline (ms) that was exceeded. */
    public readonly timeoutMs: number,
  ) {
    super(message, "job_timeout", 0)
    this.name = "JobTimeoutError"
  }
}

/**
 * The caller's `AbortSignal` fired while `nodes.runAndWait` was polling (or it
 * was already aborted on entry). Polling stops and this rejects. Not an HTTP
 * error — `status` is 0; catch by type/`code`.
 */
export class JobAbortedError extends NodaroError {
  constructor(message = "Aborted", public readonly jobId?: string) {
    super(message, "job_aborted", 0)
    this.name = "JobAbortedError"
  }
}

/**
 * A batch preview was asked for and this deployment cannot give one, so
 * NOTHING was sent: the batch is still unapplied and the production untouched.
 *
 * A preview is two requests because the route's body is parsed in strip mode —
 * a deployment that predates the preview silently DROPS the flag and APPLIES
 * the batch. So the SDK asks with an EMPTY batch first and sends the real one
 * only when that answer carries the `dryRun` marker. This is what it throws
 * when the answer does not: whatever the older deployment made of an empty
 * batch, the caller's batch never left.
 *
 * The remedy is a deployment that serves the preview — there is nothing to
 * retry here. To apply the batch instead, send it without the flag.
 *
 * A deployment that REFUSES the empty batch outright throws its own error
 * instead of this one, which is the right way round: the route's message says
 * more than "unavailable" does.
 *
 * Not an HTTP error: the request itself succeeded and answered the older shape.
 * `status` is 0; catch by type/`code`.
 */
export class StudioPreviewUnavailable extends NodaroError {
  constructor(
    message = "This deployment does not preview operation batches; nothing was sent",
  ) {
    super(message, "studio_preview_unavailable", 0)
    this.name = "StudioPreviewUnavailable"
  }
}

/**
 * A batch preview was asked for and the batch was APPLIED instead. The
 * production is written; this is the opposite of {@link
 * StudioPreviewUnavailable}, where nothing was sent.
 *
 * How it happens: the preview's proving ping and the batch are two requests,
 * and a fleet mid-rollout can serve them from different deployments. The ping
 * answers the marker, the batch reaches a deployment that predates the preview,
 * parses in strip mode, drops the flag and writes. The SDK cannot recall that
 * request — by the time the answer comes back the change has landed — so it
 * refuses to call the result a preview, which is the only thing still in its
 * gift. `receipts` and `warnings` are on both shapes, so an unchecked reply
 * would have shown a person what ALREADY happened under the heading of what
 * would.
 *
 * `applied` is what the route answered: the ordinary apply reply, whose
 * `production` and `version` are now the truth. Adopt them the way a plain
 * apply's caller does — do NOT re-send the batch, and do not present it for
 * approval.
 *
 * Not an HTTP error: the request succeeded, at the wrong thing. `status` is 0.
 */
export class StudioPreviewAppliedError extends NodaroError {
  constructor(
    /**
     * The apply reply the route sent back, as it sent it. An answer this
     * package does not recognise arrives here unchanged rather than being
     * dressed up: it is what the deployment said about a batch it took.
     *
     * `undefined` when the answer carried no body at all — a 204, an empty
     * envelope. The refusal still fires, because a non-preview answer is never
     * handed back as a preview, but there is nothing to report and the SDK will
     * not invent it: whether the batch was applied is unknown from here, and
     * the caller settles it by re-reading the production.
     */
    public readonly applied: StudioOpsResponse | undefined,
    message = applied
      ? "Asked for a preview and this deployment APPLIED the batch; the change is written — see `applied`"
      : "Asked for a preview and this deployment answered with neither one nor a body to read; the batch may have been applied — re-read the production before deciding anything",
  ) {
    super(message, "studio_preview_applied", 0)
    this.name = "StudioPreviewAppliedError"
  }
}

/**
 * The awaited job entered `pending_review`: a job policy registered by this
 * deployment held its output for a human reviewer. `pending_review` is
 * IN-FLIGHT, not terminal, so `nodes.runAndWait` / `nodes.runMany` end the
 * poll on the first tick they observe it rather than burning `maxMs` on a
 * status that no longer moves on its own.
 *
 * This does NOT cancel the job — the output exists, a human is reviewing it,
 * and the credit reservation stays `reserved` for the whole hold. Do not
 * re-run the request (a duplicate would be held too): re-fetch with
 * `jobs.get(jobId)` later, or surface "awaiting review" to your user and poll
 * `jobs.getStatus()` yourself. It resolves to `completed` (approved), `failed`
 * (rejected, with `error_hint.kind === "policy-block"`) or `cancelled`.
 *
 * Not an HTTP error — `status` is 0; catch by type/`code`.
 */
export class JobHeldError extends NodaroError {
  constructor(
    message: string,
    public readonly jobId: string,
  ) {
    super(message, "job_held", 0)
    this.name = "JobHeldError"
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; missingScope?: string; required?: number; available?: number; limitBytes?: number; opIndex?: number; [key: string]: unknown }
}

export function throwFromResponse(status: number, body: ApiErrorBody): never {
  const code = body.error?.code ?? "internal_error"
  const message = body.error?.message ?? "Request failed"
  if (status === 401) throw new UnauthorizedError(message)
  if (status === 409 && (code === "workflow_conflict" || code === "production_busy")) {
    throw new WorkflowConflictError(
      message,
      body.error?.currentUpdatedAt as string | undefined,
      body.error?.currentVersion as number | undefined,
      body.error?.currentRecord as Record<string, unknown> | undefined,
      code,
    )
  }
  // By shape, not by code — see StudioOpError. Only the studio operations route
  // sends an op index, so this cannot capture anyone else's 400.
  if (status >= 400 && status < 500 && typeof body.error?.opIndex === "number") {
    throw new StudioOpError(message, code, status, body.error.opIndex)
  }
  if (status === 422 && code === "job_blocked") throw new JobBlockedError(message)
  if (status === 403 && code === "insufficient_scope") {
    throw new ForbiddenError(message, body.error?.missingScope)
  }
  if (status === 403) throw new ForbiddenError(message)
  if (status === 404) throw new NotFoundError(message)
  if (status === 429) throw new RateLimitedError(message)
  if (status === 402) {
    throw new InsufficientCreditsError(message, body.error?.required, body.error?.available)
  }
  if (status === 413) throw new StorageExceededError(message, body.error?.limitBytes)
  throw new NodaroError(message, code, status)
}
