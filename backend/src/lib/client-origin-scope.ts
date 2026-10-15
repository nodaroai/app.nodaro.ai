/**
 * The client app a request's job is attributed to: `input_data.origin`.
 *
 * A client app sends `origin` (its slug — `create-image`, `studio`, ...)
 * beside its params on ANY job-creating request. It is read off the RAW body
 * here, never off a route's Zod schema, so no route has to declare it and a
 * route added tomorrow stamps it too: the job funnel (`insert-job.ts`) is the
 * one caller, on every request lane. It is what `GET /v1/jobs?origin=`
 * filters on and what the failure reports name as the app.
 *
 * The same posture as the generation session beside it
 * (`generation-session-scope.ts`):
 *  - the value is the REQUEST's, validated once by `clientOriginSchema`; a
 *    route-written `input_data.origin` the request did not send is dropped,
 *    so the stored value can never be anything else;
 *  - a value that is not a slug is refused (400 `validation_error`) before any
 *    row exists — the same answer the routes that also declare the field give
 *    from their own schema, so every lane refuses it alike;
 *  - the orchestrator's own hops carry none: a workflow run is not a client
 *    app's request, whatever a node's data holds.
 */
import type { FastifyRequest } from "fastify"
import { clientOriginSchema } from "./client-origin-schema.js"
import { InvalidClientOriginError } from "./client-origin-error.js"

export { InvalidClientOriginError, isInvalidClientOrigin } from "./client-origin-error.js"

/** The raw `origin` of a request body: `undefined` when absent, null or empty. */
export function rawOriginOf(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined
  const value = (body as Record<string, unknown>).origin
  return value === null || value === "" ? undefined : value
}

/**
 * The validated client origin of this request, or `null` when it names none.
 * THROWS `InvalidClientOriginError` for a value that is not a slug.
 */
export function resolveRequestOrigin(req: FastifyRequest): string | null {
  if (req.authKind === "internal") return null
  const raw = rawOriginOf(req.body)
  if (raw === undefined) return null
  const parsed = clientOriginSchema.safeParse(raw)
  if (!parsed.success) throw new InvalidClientOriginError()
  return parsed.data
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/**
 * The row with `input_data.origin` set to the request's origin — or, when the
 * request names none, without one. Never mutates the caller's row.
 */
export function withRequestOrigin<Row extends Record<string, unknown>>(row: Row, origin: string | null): Row {
  const input = row.input_data
  if (origin === null) {
    if (!isRecord(input) || !("origin" in input)) return row
    const { origin: _dropped, ...rest } = input
    return { ...row, input_data: rest }
  }
  if (input !== undefined && !isRecord(input)) return row
  return { ...row, input_data: { ...(input ?? {}), origin } }
}
