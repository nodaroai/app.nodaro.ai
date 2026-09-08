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
