/**
 * The generation session a request's job is born in.
 *
 * A creation tool sends `sessionId` beside its generation params (image, video,
 * speech, music — any route that creates a job). The value is read off the RAW
 * body here, never off a route's Zod schema, so no generation route has to know
 * sessions exist and a route added tomorrow stamps them too: the job funnel
 * (`insert-job.ts`) is the one caller, on every request lane.
 *
 * The check is the caller's OWN session, in the context the request was made
 * in (personal or the same workspace) — the same rows `GET /v1/sessions`
 * shows. Anything else is a 404, never a 403: whether a stranger's session
 * exists is not ours to say. The DB enforces the same rule a second time
 * (migration 518's session_items guard), so a forgotten check here fails the
 * insert rather than leaking.
 *
 * Resolved at most once per request: a route that inserts several jobs
 * (variants, per-segment children) reads the database once.
 */
import type { FastifyRequest } from "fastify"
import { supabase } from "./supabase.js"
import { GenerationSessionNotFoundError } from "./generation-session-error.js"
import { callerGrantOf, grantMayWriteSessions, trustedProvenanceOf } from "./job-submission-context.js"

export { GenerationSessionNotFoundError, isGenerationSessionNotFound } from "./generation-session-error.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The raw `sessionId` of a request body: `undefined` when absent, null or empty. */
export function rawSessionIdOf(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined
  const value = (body as Record<string, unknown>).sessionId
  return value === null || value === "" ? undefined : value
}

const resolved = new WeakMap<FastifyRequest, Promise<string | null>>()

async function lookup(req: FastifyRequest): Promise<string | null> {
  // An internal request carries a session only when trusted server code
  // attached it to that very request (`trustedProvenanceOf`): an MCP tool's
  // (`mcpInject`), or the `provenance` option a plugin declares on
  // `tk.http.internalRequest`. Its BODY is never read for one — not the
  // orchestrator's (a workflow run is not a session, whatever a node's data
  // holds), not an MCP relay's, and not a plugin's payload, which can carry
  // records its caller controls.
  const raw: unknown = req.authKind === "internal" ? trustedProvenanceOf(req)?.sessionId : rawSessionIdOf(req.body)
  if (raw === undefined || raw === null || raw === "") return null
  if (typeof raw !== "string" || !UUID_RE.test(raw) || !req.userId) {
    throw new GenerationSessionNotFoundError()
  }
  // Filing a job in a session is a session WRITE, under the caller's grant
  // (`callerGrantOf`): an OAuth app's or an MCP session's needs the same
  // `assets:write` the /v1/sessions write routes ask for, on an internal hop
  // as on the public path; an internal hop whose grant no server-side scope
  // vouches for may not.
  if (!grantMayWriteSessions(callerGrantOf(req))) {
    throw new GenerationSessionNotFoundError()
  }

  let query = supabase
    .from("generation_sessions")
    .select("id")
    .eq("id", raw)
    .eq("user_id", req.userId)
  query = req.workspaceId ? query.eq("workspace_id", req.workspaceId) : query.is("workspace_id", null)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) throw new GenerationSessionNotFoundError()
  return (data as { id: string }).id
}

/**
 * The validated session id of this request, or `null` when it names none.
 * THROWS `GenerationSessionNotFoundError` for a session the caller may not use.
 */
export function resolveRequestSession(req: FastifyRequest): Promise<string | null> {
  let pending = resolved.get(req)
  if (!pending) {
    pending = lookup(req)
    resolved.set(req, pending)
  }
  return pending
}

/** Remove any caller-written `session_id` from a row: only the request's
 *  validated session may set it (the `withoutJobSubmissionContext` posture). */
export function withoutSessionColumn(row: Record<string, unknown>): Record<string, unknown> {
  if (!("session_id" in row)) return row
  const { session_id: _ignored, ...rest } = row
  return rest
}

/** The column the funnel stamps, spread AFTER the caller's row. */
export function sessionColumns(sessionId: string | null): Record<string, unknown> {
  return sessionId ? { session_id: sessionId } : {}
}
