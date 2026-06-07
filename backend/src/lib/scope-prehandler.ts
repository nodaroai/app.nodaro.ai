import type { FastifyReply, FastifyRequest } from "fastify"
import { requireScope, type Scope } from "./scopes.js"

/**
 * Route preHandler that enforces an OAuth scope for developer-app tokens and is a
 * NO-OP for first-party (Supabase JWT) and personal-API-token callers (who own
 * their resources and carry no `appAuthorization`).
 *
 * Use on write routes that an OAuth app should reach ONLY when the user granted
 * the matching scope — e.g. `assets:write` on character/object/location
 * mutations. Without it, an app the user authorized for ANY scope (even
 * read-only) can create/delete the owner's assets, exceeding the consented
 * scope. Mirrors the per-handler `authorize(req, reply, scope)` pattern in
 * routes/workflows.ts, packaged as a preHandler for routes that don't need the
 * returned userId at the gate.
 */
export function requireAppScope(scope: Scope) {
  // MUST `return reply...` (not just `await reply.send()`): in a Fastify async
  // hook, returning the reply is what halts the lifecycle. Bare `await
  // reply.send()` lets the route handler still execute its side effects (the
  // unauthorized write runs even though the client gets 403) — an auth fail-open.
  return async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> => {
    if (!req.appAuthorization) return
    const err = requireScope(req.appAuthorization.scopes, scope)
    if (err) {
      return reply.status(err.statusCode).send(err.body)
    }
  }
}
