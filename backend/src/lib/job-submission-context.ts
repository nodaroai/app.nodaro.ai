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

/**
 * The provenance of the user a server-side hop acts for, attached by that
 * server code (never read from a header or the body). Every value is checked
 * where it is read, exactly as a public request's is: `origin` against the
 * slug rule, `sessionId` as the caller's own session on the request's side of
 * the workspace line, under the caller's grant (`CallerGrant`).
 */
export interface TrustedJobProvenance {
  /** The calling client's origin slug (`input_data.origin`). */
  readonly origin?: string
  /** A generation session to file the job in: the caller's own, or the job is refused (404). */
  readonly sessionId?: string
  /** The originating request's surface (`source` / `source_detail`), derived server-side from it. */
  readonly source?: { readonly source: string; readonly sourceDetail: string | null }
}

/**
 * The grant a caller acts through: an OAuth app's or an MCP session's scopes,
 * or `null` for a first-party caller (a browser session, a personal API key)
 * that has no grant to check. `undefined` where it is read means UNKNOWN — an
 * internal hop no server-side scope vouches for — and fails closed.
 */
export type CallerGrant = readonly string[] | null

interface SubmissionScope {
  readonly userId: string
  readonly method: string
  readonly url: string
  readonly submission?: ServerJobSubmission
  /** The job a worker-side handler is running when it asks for this one (child job). */
  readonly parentJobId?: string
  /** Set only by the plugin toolkit's own `tk.http.internalRequest` (trusted plugin code). */
  readonly trustedPluginCaller?: true
  /** Server-only provenance for the job this request creates. */
  readonly provenance?: TrustedJobProvenance
  /** The grant of the caller this request acts for (absent = unknown). */
  readonly grant?: CallerGrant
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
  /**
   * Server-only: the provenance of the user this request acts for — set by
   * MCP's `mcpInject` (a tool's session), the trend routes' `engineRequest`
   * (the calling client's origin and surface) and the plugin toolkit's
   * `internalRequest` (only what plugin code declared in its `provenance`
   * option). Read by the job funnel through `trustedProvenanceOf`.
   */
  readonly provenance?: TrustedJobProvenance
  /**
   * Server-only: the grant of the caller this request acts for, derived by
   * server code from the outer request (`callerGrantOf`) or an MCP session.
   * Read through `callerGrantOf`; omit it when unknown.
   */
  readonly grant?: CallerGrant
}, run: () => T | PromiseLike<T>): Promise<T> {
  const provenance = request.provenance && Object.values(request.provenance).some((v) => v !== undefined)
    ? request.provenance
    : undefined
  const grant = request.grant === undefined ? undefined : request.grant === null ? null : Object.freeze([...request.grant])
  // Nested internal calls without an explicit context must not inherit one.
  if (
    !request.jobSubmission && request.parentJobId === undefined && request.trustedPluginCaller !== true &&
    !provenance && grant === undefined
  ) {
    return scopes.run(undefined, async () => await run())
  }
  // A scope that carries a submission, a parent, provenance or a grant needs a
  // caller; the trusted plugin flag alone does not (it is matched against the
  // caller when read).
  if ((request.jobSubmission || request.parentJobId !== undefined || provenance || grant !== undefined) && !request.userId.trim()) {
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
    ...(provenance ? { provenance: structuredClone(provenance) } : {}),
    ...(grant !== undefined ? { grant } : {}),
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
  return scopeOf(req)?.trustedPluginCaller === true
}

/** The active scope server code opened for THIS very request (method + url + caller), else undefined. */
function scopeOf(req: FastifyRequest): SubmissionScope | undefined {
  const scope = scopes.getStore()
  if (!scope?.active || req.method !== scope.method || req.url !== scope.url) return undefined
  return req.userId === scope.userId ? scope : undefined
}

/**
 * An INTERNAL request's provenance (client origin, generation session,
 * originating surface): only what server code attached to THIS very request
 * through `withJobSubmissionContext({ provenance })`, else `null`. That is
 * `null` for every internal hop that has no such scope — the orchestrator's
 * own hops, an MCP relay of a caller's body, a forged header or body — and
 * for a body a plugin sends: plugin code relays caller-controlled records into
 * its payloads, so a payload `origin` / `sessionId` is never trusted; a plugin
 * names the ones it validated in `tk.http.internalRequest`'s `provenance`
 * option. A `workerRequest` CHILD job (a parent in the scope) carries none:
 * it is a step of its parent, not a client's request.
 *
 * The same active + method + url + caller match as every other reader here; a
 * body `userId` that switches the caller (possible on a hop that does not pin
 * its body, as MCP's and the trend engine's; the plugin toolkit pins it to the
 * caller) loses the trust (nothing is carried) rather than handing one user's
 * provenance to another's job. Public requests
 * never consult it: their provenance is their own body.
 */
export function trustedProvenanceOf(req: FastifyRequest): TrustedJobProvenance | null {
  if (req.authKind !== "internal") return null
  const scope = scopeOf(req)
  if (!scope?.provenance || scope.parentJobId !== undefined) return null
  return scope.provenance
}

/**
 * The grant of the caller a request acts for, by the credential the host's
 * auth hook recorded on it (`authKind`):
 *  - `app_token`: the OAuth app's scopes (`appAuthorization`), UNKNOWN if the
 *    request carries none;
 *  - `jwt`, `api_token`, `billing_key`: `null` — first party, no grant to
 *    check (an `appAuthorization` on one is honoured as its grant);
 *  - `internal`: the grant server code carried into THIS request's scope (an
 *    MCP session's, or the outer request's a trend route or a plugin relayed);
 *  - anything else, an absent `authKind` included: UNKNOWN.
 * UNKNOWN is `undefined`, and every reader fails closed on it.
 */
export function callerGrantOf(req: FastifyRequest): CallerGrant | undefined {
  switch (req.authKind) {
    case "internal":
      return scopeOf(req)?.grant
    case "app_token":
      return req.appAuthorization ? req.appAuthorization.scopes : undefined
    case "jwt":
    case "api_token":
    case "billing_key":
      return req.appAuthorization ? req.appAuthorization.scopes : null
    default:
      return undefined
  }
}

/**
 * Every request the host's Fastify app received, registered by an `onRequest`
 * hook (`registerAuthHook`). A request object plugin code hands back
 * (`tk.http.internalRequest`'s `request`) counts only if it is one of these:
 * an object merely shaped like a request names no grant.
 */
const hostRequests = new WeakSet<object>()

/** Registers a request the host received. Called by the host's `onRequest` hook only. */
export function markHostRequest(req: FastifyRequest): void {
  hostRequests.add(req)
}

/**
 * The grant of a request object that plugin code handed back as the outer
 * request of its internal call: `callerGrantOf` when the host received that
 * very object, else UNKNOWN.
 */
export function hostRequestGrantOf(req: FastifyRequest): CallerGrant | undefined {
  return hostRequests.has(req) ? callerGrantOf(req) : undefined
}

/**
 * Whether the caller may file a job in a generation session — a session
 * WRITE: a first-party caller may; a grant needs `assets:write` (the scope the
 * /v1/sessions write routes ask for); an unknown grant may not.
 */
export function grantMayWriteSessions(grant: CallerGrant | undefined): boolean {
  return grant === null || (grant !== undefined && grant.includes("assets:write"))
}

/**
 * Whether the job THIS request creates is a CHILD job: internal auth AND a
 * server-only parent job id in this very request's submission scope
 * (`tk.http.workerRequest` with a parent) — the same id `withJobProvenance`
 * stamps as `parent_job_id`, so "is a child" and "was stamped a child" cannot
 * disagree. A trusted plugin request WITHOUT a parent (`tk.http.internalRequest`)
 * creates the user's own job, so it is not one. Never read from a header or
 * the body; a caller mismatch is false, not a throw.
 */
export function createsChildJob(req: FastifyRequest): boolean {
  if (req.authKind !== "internal") return false
  try {
    return jobSubmissionParentJobId(req) !== undefined
  } catch {
    return false
  }
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
  return createsChildJob(req) || isTrustedPluginRequest(req)
}
