import type { FastifyReply, FastifyRequest } from "fastify"
import { hasScope, requireScope, type Scope } from "./scopes.js"

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

/** Whether a connected app's grant lets it act on the owner's behalf: any `:write` or `:execute` scope. */
export function appScopesCanWrite(scopes: readonly string[]): boolean {
  return scopes.some((s) => s.endsWith(":execute") || s.endsWith(":write"))
}

/**
 * Like {@link requireAppScope}, for a route that acts on the owner's behalf
 * without spending credits (an import of a link into their files, a content
 * rights confirmation in their name): an OAuth app passes with ANY `:write` or
 * `:execute` scope — the same line the credit guard draws for a generation —
 * and one granted only read scopes is refused. No-op for every other caller.
 * Same halt rule — the refusal RETURNS the reply.
 */
export function requireAppWriteScope() {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> => {
    if (!req.appAuthorization) return
    if (appScopesCanWrite(req.appAuthorization.scopes)) return
    return reply.status(403).send({
      error: {
        code: "insufficient_scope",
        message: "This app's granted scopes do not permit acting on the account's files; a :write or :execute scope is required.",
      },
    })
  }
}

/**
 * Like {@link requireAppScope}, for a route that more than one scope already
 * reveals: an OAuth app passes with ANY of `scopes`. A refusal names the first
 * one as `missingScope` (the one to ask for) and every one in the message.
 * Same halt rule — the refusal RETURNS the reply.
 */
export function requireAnyAppScope(scopes: readonly [Scope, ...Scope[]]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> => {
    if (!req.appAuthorization) return
    const granted = req.appAuthorization.scopes
    if (scopes.some((scope) => hasScope(granted, scope))) return
    return reply.status(403).send({
      error: {
        code: "insufficient_scope",
        message: `Missing required scope: one of ${scopes.join(", ")}`,
        missingScope: scopes[0],
      },
    })
  }
}
