import type { FastifyInstance, FastifyRequest } from "fastify"
import { internalSecretMatches } from "../lib/internal-caller.js"
import { firstHeaderValue } from "../lib/request-helpers.js"
import { withoutServerOnlyKeys } from "../lib/server-only-keys.js"

/**
 * The body a route reads is the caller's, less the keys that are the server's
 * own (`lib/server-only-keys.ts`). A route's pre-handler keeps on the body
 * what the server measured for the price, and the price reads it from there:
 * were a caller's key of that name left in place, a measurement that did not
 * run would leave the caller's value to be priced by.
 *
 * A request carrying the internal secret composes its own body (the workflow
 * engine, a plugin, a server loopback) and keeps it as sent. The MCP funnel
 * forwards a caller's arguments under that secret, so it drops the keys from
 * them itself (`lib/mcp/internal-request.ts`).
 */

/**
 * The bodies third parties post to us, read as they sent them: a workflow's
 * webhook trigger, Stripe's events and Telegram's updates.
 */
const PASS_THROUGH_PREFIXES = ["/v1/webhooks/", "/v1/billing/stripe-webhook", "/v1/telegram/webhook/"] as const

/** True when the request carries the internal secret, so its body is the server's own. */
export function isInternalRequest(req: FastifyRequest): boolean {
  return internalSecretMatches(firstHeaderValue(req.headers["x-internal-orchestrator-secret"]))
}

/**
 * What a route may read of `body` on `req`: the body as sent when the request
 * is internal, else the body without the server's keys. The quote route asks
 * it of the run body it prices, so a quote reads what the run reads.
 */
export function callerBodyOf<T>(req: FastifyRequest, body: T): T {
  return isInternalRequest(req) ? body : withoutServerOnlyKeys(body)
}

/**
 * Before any route's pre-handlers read the body. A body with no server key is
 * left as the same object; one with any is replaced, never changed in place.
 */
export function registerServerOnlyBodyKeysHook(app: FastifyInstance): void {
  app.addHook("preValidation", async (req) => {
    const route = req.routeOptions?.url ?? req.url
    if (PASS_THROUGH_PREFIXES.some((prefix) => route.startsWith(prefix))) return
    const body = callerBodyOf(req, req.body)
    if (body !== req.body) req.body = body
  })
}
