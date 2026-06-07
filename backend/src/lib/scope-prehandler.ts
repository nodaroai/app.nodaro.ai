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
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, scope)
      if (err) {
        await reply.status(err.statusCode).send(err.body)
      }
    }
  }
}
