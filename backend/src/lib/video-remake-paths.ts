/**
 * Video Remake's two route prefixes (pure).
 *
 * The product's routes are `/v1/video-remake` and everything below it (the
 * run, its quote, a draft's Full Quality, the trend editor's face mask, the
 * public Style choice and Advanced switch). `/v1/cast-swap` is the same set of
 * routes under the name the engine had before, kept as a silent alias: the
 * Cast Swap engine registers its routes under both prefixes where the host
 * advertises `capabilities.videoRemake` (and declares
 * `castSwap.videoRemakeRoutes`), an engine from before the rename under
 * `/v1/cast-swap` alone.
 *
 * Every table keyed by a route (the node gate, the public routes, the engine
 * hooks) is written with the `/v1/cast-swap` spelling, the one every engine
 * version serves, and reads a route through {@link castSwapSpelling}, so both
 * prefixes are the same route everywhere.
 *
 * The admin settings' routes are `/v1/admin/video-remake/*`, with
 * `/v1/admin/nodaro-motion/*` as their silent alias ({@link rewriteVideoRemakeUrl}).
 */
import type { FastifyInstance } from "fastify"

export const VIDEO_REMAKE_PREFIX = "/v1/video-remake"
export const CAST_SWAP_PREFIX = "/v1/cast-swap"
export const ADMIN_VIDEO_REMAKE_PREFIX = "/v1/admin/video-remake"
export const ADMIN_NODARO_MOTION_PREFIX = "/v1/admin/nodaro-motion"

/** Whether `path` is `prefix` itself or a path below it (`/v1/video-remake/x`, never `/v1/video-remakees`). */
function isUnder(path: string, prefix: string): boolean {
  if (!path.startsWith(prefix)) return false
  const next = path.charAt(prefix.length)
  return next === "" || next === "/" || next === "?"
}

/**
 * A route or path under `/v1/video-remake` in its `/v1/cast-swap` spelling
 * (`/v1/video-remake/:jobId/full-quality` → `/v1/cast-swap/:jobId/full-quality`);
 * anything else as it is.
 */
export function castSwapSpelling(route: string): string {
  return isUnder(route, VIDEO_REMAKE_PREFIX) ? CAST_SWAP_PREFIX + route.slice(VIDEO_REMAKE_PREFIX.length) : route
}

/** A route or path under `/v1/cast-swap` in its `/v1/video-remake` spelling; anything else as it is. */
export function videoRemakeSpelling(route: string): string {
  return isUnder(route, CAST_SWAP_PREFIX) ? VIDEO_REMAKE_PREFIX + route.slice(CAST_SWAP_PREFIX.length) : route
}

/** Both spellings of a Video Remake route, the canonical one first (`"/style-choice"` → both prefixes). */
export function videoRemakeRoutes(suffix: string): readonly [string, string] {
  return [VIDEO_REMAKE_PREFIX + suffix, CAST_SWAP_PREFIX + suffix]
}

/**
 * The address a request is routed by (Fastify's `rewriteUrl`; `url` is the
 * request's own, query included):
 *
 * - an admin settings path under `/v1/admin/nodaro-motion` goes to the same
 *   path under `/v1/admin/video-remake`, the only one registered;
 * - a path under `/v1/video-remake` goes to its `/v1/cast-swap` spelling while
 *   the loaded Cast Swap engine serves the old prefix alone
 *   (`engineServesVideoRemake` false), so the product's routes answer whatever
 *   engine an environment pins.
 *
 * Anything else is returned as it is.
 */
export function rewriteVideoRemakeUrl(url: string, engineServesVideoRemake: () => boolean): string {
  if (isUnder(url, ADMIN_NODARO_MOTION_PREFIX)) return ADMIN_VIDEO_REMAKE_PREFIX + url.slice(ADMIN_NODARO_MOTION_PREFIX.length)
  if (isUnder(url, VIDEO_REMAKE_PREFIX) && !engineServesVideoRemake()) return castSwapSpelling(url)
  return url
}

/**
 * Fastify's `rewriteUrl` for the app (app.ts): {@link rewriteVideoRemakeUrl},
 * the loaded engine serving the new prefix when it registered
 * `POST /v1/video-remake`.
 */
export function videoRemakeRewriteUrl(this: FastifyInstance, req: { url?: string }): string {
  return rewriteVideoRemakeUrl(req.url ?? "/", () => this.hasRoute({ method: "POST", url: VIDEO_REMAKE_PREFIX }))
}
