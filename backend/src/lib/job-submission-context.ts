import { AsyncLocalStorage } from "node:async_hooks"
import type { FastifyRequest } from "fastify"

export interface ServerJobSubmission {
  readonly jobType: string
  readonly metadata: Readonly<Record<string, unknown>>
}

interface SubmissionScope {
  readonly userId: string
  readonly method: string
  readonly url: string
  readonly submission: ServerJobSubmission
  active: boolean
}

const scopes = new AsyncLocalStorage<SubmissionScope | undefined>()

/** Server-only transport. Nothing reads metadata from an HTTP body or header. */
export async function withJobSubmissionContext<T>(request: {
  readonly userId: string; readonly method: string; readonly url: string
  readonly jobSubmission?: ServerJobSubmission
}, run: () => T | PromiseLike<T>): Promise<T> {
  // Nested internal calls without an explicit context must not inherit one.
  if (!request.jobSubmission) return scopes.run(undefined, async () => await run())
  const encoded = JSON.stringify(request.jobSubmission.metadata)
  if (!encoded || Buffer.byteLength(encoded) > 256 * 1024
    || !request.jobSubmission.jobType.trim() || !request.userId.trim()) {
    throw new Error("Invalid server job submission context")
  }
  const metadata: unknown = JSON.parse(encoded)
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Job submission metadata must be an object")
  const scope: SubmissionScope = {
    userId: request.userId, method: request.method, url: request.url,
    submission: { jobType: request.jobSubmission.jobType, metadata: metadata as Record<string, unknown> }, active: true,
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
  if (!scope?.active || req.method !== scope.method || req.url !== scope.url) return {}
  const input = row.input_data as Record<string, unknown> | undefined
  const type = row.job_type ?? input?.type
  if (type !== scope.submission.jobType) return {}
  if (row.user_id !== scope.userId || req.userId !== scope.userId) throw new Error("Job submission identity does not match the authenticated request")
  return { submission_context: structuredClone(scope.submission.metadata) }
}
