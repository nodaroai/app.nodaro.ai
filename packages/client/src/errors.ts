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

interface ApiErrorBody {
  error?: { code?: string; message?: string; missingScope?: string; required?: number; available?: number; limitBytes?: number; [key: string]: unknown }
}

export function throwFromResponse(status: number, body: ApiErrorBody): never {
  const code = body.error?.code ?? "internal_error"
  const message = body.error?.message ?? "Request failed"
  if (status === 401) throw new UnauthorizedError(message)
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
