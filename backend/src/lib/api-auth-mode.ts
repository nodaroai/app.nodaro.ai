import type { FastifyReply, FastifyRequest } from "fastify"

/**
 * Reject requests authenticated via a PROGRAMMATIC token — a developer-app OAuth
 * access token (`req.appAuthorization`) or a personal API token (`req.apiToken`).
 *
 * Some routes are first-party-only: the editor (Supabase JWT) may call them, but
 * programmatic clients must not. A first-party JWT request has NEITHER field set
 * by the auth hook, so this guard lets it through and blocks everything else.
 *
 * Two call sites today:
 *   - API-token management (`POST/GET/PATCH/DELETE /v1/api-tokens`) — documented
 *     "JWT auth required". Without this, an OAuth app holding ANY scope could call
 *     `POST /v1/api-tokens` and mint an unscoped personal API token (which carries
 *     no `appAuthorization`, so every `requireScope` check becomes a no-op) — a
 *     privilege escalation / account takeover beyond the scopes the user granted.
 *   - Node-preset writes (`node-presets` + `node-preset-groups` CREATE/PATCH/
 *     DELETE/import/reorder) — the feature is "read-only over the API"; the SDK
 *     and CLI expose reads only. Writes stay in the editor.
 *
 * Returns true (and sends a 403) when the caller is a programmatic token — the
 * handler must `return` immediately. Returns false for first-party JWT callers.
 */
export function rejectProgrammaticAuth(
  req: FastifyRequest,
  reply: FastifyReply,
  message: string,
  opts?: { allowPersonalToken?: boolean },
): boolean {
  // OAuth app tokens are ALWAYS rejected on these routes — no scope exists that
  // could authorize them, so a third-party app (granted any scope) must never
  // reach here (the privilege-escalation class).
  if (req.appAuthorization) {
    reply.status(403).send({ error: { code: "forbidden", message } })
    return true
  }
  // Personal API tokens are the user's OWN full-access key. Rejected by default
  // (JWT-only routes like /v1/api-tokens), but allowed when the route is a
  // supported SDK surface (e.g. developer-app management has a @nodaro/client
  // resource that authenticates with a personal token). JWT sessions set neither
  // field and always pass.
  if (req.apiToken && !opts?.allowPersonalToken) {
    reply.status(403).send({ error: { code: "forbidden", message } })
    return true
  }
  return false
}
