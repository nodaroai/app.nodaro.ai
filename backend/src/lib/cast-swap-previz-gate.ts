import type { FastifyInstance } from "fastify"
import { loadedEngineTakesPreviz } from "./cast-swap-engines.js"

/**
 * A Video Remake run or quote that states a 3D previz clip
 * (`clipKind: "previz"`, or the `previz` options) is refused HERE while this
 * process's engine does not declare `castSwap.previz`.
 *
 * Such a clip is rendered into the run's look, never edited. An engine from
 * before the mode does not know the keys: it drops them and would run, and
 * charge for, an ordinary edit of the clip, which is not what was asked. So
 * the body is held at the app's door, before the engine's route runs and
 * before anything is held or quoted: 403 `previz_not_available`, the engine's
 * own code and sentence for a deployment that does not accept one, so a
 * caller reads one refusal whichever side answers.
 *
 * An engine that declares the flag is never touched here: its route is the
 * authority (the deployment's switch, Nodaro Prism only, no draft, each
 * role's locator). A body that names an ordinary clip (`clipKind: "footage"`,
 * or none) and no `previz` options passes as before, on every engine.
 */
export const PREVIZ_NOT_AVAILABLE = "previz_not_available"
export const PREVIZ_NOT_AVAILABLE_MESSAGE = "A 3D previz clip is not available here. Send an ordinary clip instead."

/** The run and the quote, as the router names them, under both prefixes. */
export const PREVIZ_GATED_ROUTES: ReadonlySet<string> = new Set([
  "/v1/video-remake",
  "/v1/video-remake/estimate",
  "/v1/cast-swap",
  "/v1/cast-swap/estimate",
])

/** Whether a body states a 3D previz clip: `clipKind: "previz"`, or any `previz` options. */
export function namesPrevizClip(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false
  const b = body as { clipKind?: unknown; previz?: unknown }
  return b.clipKind === "previz" || (b.previz !== undefined && b.previz !== null)
}

export function registerCastSwapPrevizGate(app: FastifyInstance): void {
  app.addHook("preHandler", async (req, reply) => {
    // The route the router picked, never the raw path (plugin-route-scopes.ts).
    if (req.method !== "POST" || !PREVIZ_GATED_ROUTES.has(req.routeOptions?.url ?? "")) return
    if (!namesPrevizClip(req.body) || loadedEngineTakesPreviz()) return
    return reply.status(403).send({ error: { code: PREVIZ_NOT_AVAILABLE, message: PREVIZ_NOT_AVAILABLE_MESSAGE } })
  })
}
