import type { FastifyInstance } from "fastify"
import { rateLimiter } from "../middleware/rate-limit.js"

/**
 * An account's DAILY allowance of Video Remake's role planning
 * (`POST /v1/video-remake/plan-roles`, also `/v1/cast-swap/plan-roles`).
 *
 * The route is the engine's, free (no job, no hold, no charge) and runs a
 * model on every call. The engine limits it per minute through the route's own
 * rate-limit config; a route's config takes one window, so the day's allowance
 * is held here, at the app's door, before the engine runs.
 *
 * ONE counter per account (`rl:plan-roles-day:<user>`, the Redis limiter every
 * per-user limit uses) for both spellings of the route and every caller — a
 * product page, the SDK, an MCP tool acting for the account — so they cannot
 * add up to more. The window is 24 hours from the account's first call in it.
 * Every authenticated call that reaches the route counts, whatever it is then
 * answered. Past the allowance: 429 `rate_limit_exceeded` with `Retry-After`.
 * A request with no account is left to the route (401), uncounted.
 *
 * Inert where the engine serves no such route: nothing matches.
 */
export const PLAN_ROLES_DAILY_MAX = 60

const DAY_MS = 24 * 60 * 60 * 1000

/** The route, as the router names it, under both prefixes. */
export const PLAN_ROLES_ROUTES: ReadonlySet<string> = new Set(["/v1/video-remake/plan-roles", "/v1/cast-swap/plan-roles"])

/** Must be registered after the auth hook, which sets `req.userId`. */
export function registerPlanRolesDailyLimit(app: FastifyInstance): void {
  const limiter = rateLimiter({
    windowMs: DAY_MS,
    max: PLAN_ROLES_DAILY_MAX,
    keyPrefix: "plan-roles-day",
    message: `Roles can be planned from a prompt ${PLAN_ROLES_DAILY_MAX} times a day. Try again later, or set the roles yourself.`,
  })
  app.addHook("preHandler", async (req, reply) => {
    // The route the router picked, never the raw path (plugin-route-scopes.ts).
    if (req.method !== "POST" || !PLAN_ROLES_ROUTES.has(req.routeOptions?.url ?? "")) return
    return limiter(req, reply)
  })
}
