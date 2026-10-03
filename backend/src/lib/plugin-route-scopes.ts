import type { FastifyInstance } from "fastify"
import { requireScope, type Scope } from "./scopes.js"

/**
 * OAuth scopes for routes a private plugin serves.
 *
 * A plugin's request type carries `userId` and nothing else, so a plugin
 * route cannot see what an app token was granted. This hook enforces the
 * scope at the app's door, before the plugin runs. First-party sessions,
 * personal API tokens and internal calls carry no `appAuthorization` and pass
 * untouched. Paid plugin routes are additionally held by creditGuard's rule
 * that spending needs a :write or :execute scope.
 */
const RULES: ReadonlyArray<{ readonly prefix: string; readonly read: Scope; readonly write: Scope }> = [
  // Tracked brands, their scans and cards: the user's own data.
  { prefix: "/v1/competitors", read: "assets:read", write: "assets:write" },
  // A website lookup on the user's behalf, feeding a brand they add.
  { prefix: "/v1/competitor-discover", read: "assets:write", write: "assets:write" },
]

/** The scope an app token needs for this route, or null when no rule covers it.
 *  `url` is the route Fastify matched (`/v1/competitors/:id`), never the raw
 *  request path. */
export function scopeForPluginRoute(method: string, url: string): Scope | null {
  const path = url.split("?")[0] ?? ""
  const rule = RULES.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`))
  if (!rule) return null
  return method === "GET" || method === "HEAD" ? rule.read : rule.write
}

/** Must be registered after the auth hook, which sets `req.appAuthorization`. */
export function registerPluginRouteScopeHook(app: FastifyInstance): void {
  app.addHook("preHandler", async (req, reply) => {
    if (!req.appAuthorization) return
    // The route the router picked, as creditGuard reads it: the raw path can
    // spell the same route differently (`/v1/%63ompetitors` is decoded before
    // routing), and a rule matched on it would miss.
    const scope = scopeForPluginRoute(req.method, req.routeOptions?.url ?? "")
    if (!scope) return
    const err = requireScope(req.appAuthorization.scopes, scope)
    if (err) return reply.status(err.statusCode).send(err.body)
  })
}
