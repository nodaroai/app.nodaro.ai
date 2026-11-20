import type { FastifyInstance } from "fastify"
import { getPluginSupports } from "./private-plugins/supports-registry.js"
import type { PluginSupports } from "./private-plugins/types.js"

/**
 * The Face chip of a person role (decided 2026-11-20): `face: "new"` (the
 * face from the role's pictures, what a role without the key gets) or
 * `"original"` (the person keeps their own face from the video, and is never
 * face-masked). Taken by a Cast Swap engine that declares `castSwap.roleFace`
 * (0.495.0+).
 *
 * An engine from before it ignores the key, so a person sent `"original"`
 * there would be face-masked with nothing to replace the face: the run would
 * not do what was asked. So a DIRECT run or quote that asks for it is held at
 * the app's door while this process's engine does not declare the flag
 * (`registerCastSwapRoleFaceGate`), before the engine's route runs and before
 * anything is held or quoted: 409 `engine_unsupported`. A trend run is
 * refused earlier, by the trend routes' own engine check (`engineSupports`).
 *
 * A body without `face`, or with only `face: "new"`, is never touched here: it
 * runs exactly as before, on every engine. The platform never validates or
 * strips the key itself: the engine's route is its authority.
 */

export type RoleFace = "new" | "original"

/** Whether an engine's supports take a person role's `face` (`castSwap.roleFace`). */
export function engineTakesRoleFace(cs: PluginSupports["castSwap"] | undefined): boolean {
  return cs?.roleFace === true
}

/**
 * Whether an engine's supports remake a stored face mask for a trend run that
 * mixes kept and new faces (`castSwap.roleFaceStoredMask`: `storedFaceMask`'s
 * `raw`, `erase` and `roleBoxes`).
 */
export function engineTakesRoleFaceStoredMask(cs: PluginSupports["castSwap"] | undefined): boolean {
  return cs?.roleFaceStoredMask === true
}

/** Whether this process's Cast Swap engine takes a person role's `face`. */
export function loadedEngineTakesRoleFace(): boolean {
  return engineTakesRoleFace(getPluginSupports().castSwap)
}

/** Whether a run body's roles ask any role to keep its own face (`face: "original"`). */
export function asksForOriginalFace(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false
  const roles = (body as { roles?: unknown }).roles
  if (!Array.isArray(roles)) return false
  return roles.some((r) => typeof r === "object" && r !== null && (r as { face?: unknown }).face === "original")
}

export const ROLE_FACE_UNSUPPORTED = "engine_unsupported"
export const ROLE_FACE_UNSUPPORTED_MESSAGE =
  'Keeping a person\'s own face from the video (face: "original") is not available here yet. Leave face out, or set it to "new".'

/** The run and the quote, as the router names them, under both prefixes. */
export const ROLE_FACE_GATED_ROUTES: ReadonlySet<string> = new Set([
  "/v1/video-remake",
  "/v1/video-remake/estimate",
  "/v1/cast-swap",
  "/v1/cast-swap/estimate",
])

export function registerCastSwapRoleFaceGate(app: FastifyInstance): void {
  app.addHook("preHandler", async (req, reply) => {
    // The route the router picked, never the raw path (plugin-route-scopes.ts).
    if (req.method !== "POST" || !ROLE_FACE_GATED_ROUTES.has(req.routeOptions?.url ?? "")) return
    if (!asksForOriginalFace(req.body) || loadedEngineTakesRoleFace()) return
    return reply.status(409).send({ error: { code: ROLE_FACE_UNSUPPORTED, message: ROLE_FACE_UNSUPPORTED_MESSAGE } })
  })
}
