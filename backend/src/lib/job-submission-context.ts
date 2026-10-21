import { AsyncLocalStorage } from "node:async_hooks"
import type { FastifyRequest } from "fastify"

export interface ServerJobSubmission {
  readonly jobType: string
  readonly metadata: Readonly<Record<string, unknown>>
}

export class JobSubmissionIdentityError extends Error {
  constructor() {
    super("Job submission identity does not match the authenticated request")
    this.name = "JobSubmissionIdentityError"
  }
}

interface SubmissionScope {
  readonly userId: string
  readonly method: string
  readonly url: string
  readonly submission?: ServerJobSubmission
  /** The job a worker-side handler is running when it asks for this one (child job). */
  readonly parentJobId?: string
  /** Set only by the plugin toolkit's own `tk.http.internalRequest` (trusted plugin code). */
  readonly trustedPluginCaller?: true
  active: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const scopes = new AsyncLocalStorage<SubmissionScope | undefined>()

/** A parent job id is a job id (UUID) — refused before any request is made. */
export function assertParentJobId(parentJobId: string): void {
  if (!UUID.test(parentJobId)) throw new Error("parentJobId must be a job id")
}

/** Server-only transport. Nothing reads metadata from an HTTP body or header. */
export async function withJobSubmissionContext<T>(request: {
  readonly userId: string; readonly method: string; readonly url: string
  readonly jobSubmission?: ServerJobSubmission
  /** Server-only: the parent job of the job this request creates (`tk.http.workerRequest`). */
  readonly parentJobId?: string
  /**
   * Server-only: the request is the plugin toolkit's own internal request
   * (`tk.http.internalRequest` / `workerRequest` in private-plugins/toolkit.ts
   * — plugin code is trusted). Set by that one function and nothing else;
   * never derived from a header or the body. Read by `mayUseChildJobAsSource`.
   */
  readonly trustedPluginCaller?: boolean
}, run: () => T | PromiseLike<T>): Promise<T> {
  // Nested internal calls without an explicit context must not inherit one.
  if (!request.jobSubmission && request.parentJobId === undefined && request.trustedPluginCaller !== true) {
    return scopes.run(undefined, async () => await run())
  }
  // A scope that carries a submission or a parent needs a caller; the trusted
  // plugin flag alone does not (it is matched against the caller when read).
  if ((request.jobSubmission || request.parentJobId !== undefined) && !request.userId.trim()) {
    throw new Error("Invalid server job submission context")
  }
  if (request.parentJobId !== undefined) assertParentJobId(request.parentJobId)
  let submission: ServerJobSubmission | undefined
  if (request.jobSubmission) {
    const encoded = JSON.stringify(request.jobSubmission.metadata)
    if (!encoded || Buffer.byteLength(encoded) > 256 * 1024 || !request.jobSubmission.jobType.trim()) {
      throw new Error("Invalid server job submission context")
    }
    const metadata: unknown = JSON.parse(encoded)
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Job submission metadata must be an object")
    submission = { jobType: request.jobSubmission.jobType, metadata: metadata as Record<string, unknown> }
  }
  const scope: SubmissionScope = {
    userId: request.userId, method: request.method, url: request.url,
    ...(submission ? { submission } : {}),
    ...(request.parentJobId !== undefined ? { parentJobId: request.parentJobId } : {}),
    ...(request.trustedPluginCaller === true ? { trustedPluginCaller: true as const } : {}),
    active: true,
  }
  // Fastify's inject result is a lazy thenable. Start/await it INSIDE the
  // scope; awaiting the value returned by scopes.run would start it outside.
  try { return await scopes.run(scope, async () => await run()) }
  finally { scope.active = false }
}

/** Every insertion lane strips the reserved column from caller-provided rows. */
export function withoutJobSubmissionContext(row: Record<string, unknown>): Record<string, unknown> {
  if (!("submission_context" in row)) return row
  const { submission_context: _untrusted, ...rest } = row
  return rest
}

/** A matching route and job type receive a snapshot at the INSERT boundary. */
export function jobSubmissionColumns(req: FastifyRequest, row: Record<string, unknown>): Record<string, unknown> {
  const scope = scopes.getStore()
  if (!scope?.active || !scope.submission || req.method !== scope.method || req.url !== scope.url) return {}
  const input = row.input_data as Record<string, unknown> | undefined
  const type = row.job_type ?? input?.type
  if (type !== scope.submission.jobType) return {}
  if (row.user_id !== scope.userId || req.userId !== scope.userId) throw new JobSubmissionIdentityError()
  return { submission_context: structuredClone(scope.submission.metadata) }
}

/**
 * The parent job id a server-side caller attached to THIS request (the same
 * active + method + url match as `jobSubmissionColumns`), else undefined.
 * Nothing reads it from an HTTP body or header. Like `jobSubmissionColumns`,
 * a request that authenticated as someone other than the caller (a body
 * `userId`) is refused rather than handed another user's parent.
 */
export function jobSubmissionParentJobId(req: FastifyRequest): string | undefined {
  const scope = scopes.getStore()
  if (!scope?.active || req.method !== scope.method || req.url !== scope.url) return undefined
  if (scope.parentJobId === undefined) return undefined
  if (req.userId !== scope.userId) throw new JobSubmissionIdentityError()
  return scope.parentJobId
}

/**
 * Whether THIS request is the plugin toolkit's own internal request (the same
 * active + method + url + caller match as `jobSubmissionParentJobId`).
 */
function isTrustedPluginRequest(req: FastifyRequest): boolean {
  const scope = scopes.getStore()
  if (!scope?.active || req.method !== scope.method || req.url !== scope.url) return false
  return scope.trustedPluginCaller === true && req.userId === scope.userId
}

/**
 * Whether this request may name a CHILD job (`parent_job_id` set) as the
 * source of the job it creates or prices: only trusted plugin code reaching a
 * route as the caller — internal auth AND, on this very request, a server-only
 * scope from the plugin toolkit (`tk.http.internalRequest`, or a
 * `workerRequest` with a parent job), as Cast Swap's Full Quality quote and
 * upscale of its Seedance edit child are. Every other caller — a browser, an
 * API key, an app token, and an internal hop that relays a caller's body (MCP's
 * `mcpInject`, the trend routes' `engineRequest`) — names a child exactly as a
 * job that does not exist, so a child's input never feeds a job its owner can
 * read.
 */
export function mayUseChildJobAsSource(req: FastifyRequest): boolean {
  if (req.authKind !== "internal") return false
  try {
    return jobSubmissionParentJobId(req) !== undefined || isTrustedPluginRequest(req)
  } catch {
    return false
  }
}
