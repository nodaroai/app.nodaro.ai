/**
 * Nodaro Motion's Precise art-style route (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET /v1/admin/nodaro-motion/precise-style-route   { preciseStyleRoute, updatedAt, supported } (preciseStyleRoute null = never saved: routing on, nobody bypassed)
 *   PUT /v1/admin/nodaro-motion/precise-style-route   { preciseStyleRoute }: save the whole setting; audit-logged
 *
 * The setting (`nodaro_motion_precise_style_route`,
 * lib/nodaro-motion-precise-style-route.ts) says whether a DIRECT run on Nodaro
 * Motion Prism that resolves to Precise and carries an art style runs as Flex
 * (`routing`, on by default), which accounts' emails skip that
 * (`bypassEmails`), and the depth blur of a run it makes Flex
 * (`routedDepthBlur`, 0–40, absent or 0: none; every other Flex run keeps the
 * Motion masking's), and whether such a run's shot list writer is told to
 * describe the colours from the video (`describeColours`, on by default), and
 * whether its depth map carries the face mesh (`faceMesh`, off by default),
 * and which path a run whose art style is photographic takes
 * (`photographicStyles`: "flex", the default, routed as every style, or
 * "precise", left the Precise run routing "off" makes).
 *
 * A PUT is refused 400 `validation_error` on the body's shape (strict: an
 * unknown key, a third value, something that is not an email, too many, a blur
 * that is not a whole number from 0 to 40). Any
 * value saves whatever the engines: an engine that does not declare
 * `castSwap.preciseStyleRoute` never reads the row and runs such a run as
 * Precise, so no 409 waits for one; likewise "precise" for the photographic
 * styles reaches only an engine that declares
 * `castSwap.preciseStyleRoutePhotographic` (one without it routes every style,
 * as before), and the admin screen names the environments that do not take it
 * yet. `supported` is whether THIS environment's
 * engine declares it. Each save writes an `admin_actions` row
 * (`update_nodaro_motion_precise_style_route`) with the setting before and after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import {
  NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY,
  engineRoutesPreciseStyle,
  nodaroMotionPreciseStyleRouteSchema,
  withoutDefaultPreciseStyleRoute,
  type NodaroMotionPreciseStyleRoute,
} from "../../lib/nodaro-motion-precise-style-route.js"
import { readNodaroMotionPreciseStyleRoute, saveNodaroMotionPreciseStyleRoute } from "../../lib/nodaro-motion-precise-style-route-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Nodaro Motion settings'). */
export const NODARO_MOTION_PRECISE_STYLE_ROUTE_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0fc"

const putBody = z.strictObject({ preciseStyleRoute: nodaroMotionPreciseStyleRouteSchema })

export interface NodaroMotionPreciseStyleRouteView {
  /** null = never saved: routing on, nobody bypassed. Only what differs from that is listed. */
  preciseStyleRoute: NodaroMotionPreciseStyleRoute | null
  updatedAt: string | null
  /** Whether this environment's Cast Swap engine runs such a run as Flex (`castSwap.preciseStyleRoute`). */
  supported: boolean
}

async function view(): Promise<NodaroMotionPreciseStyleRouteView> {
  const { preciseStyleRoute, updatedAt } = await readNodaroMotionPreciseStyleRoute()
  return { preciseStyleRoute, updatedAt, supported: engineRoutesPreciseStyle(getPluginSupports().castSwap) }
}

export function registerNodaroMotionPreciseStyleRouteRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/nodaro-motion/precise-style-route", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion Precise art-style route")
    }
  })

  app.put("/v1/admin/nodaro-motion/precise-style-route", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const preciseStyleRoute = withoutDefaultPreciseStyleRoute(parsed.data.preciseStyleRoute)
      const before = (await readNodaroMotionPreciseStyleRoute()).preciseStyleRoute
      await saveNodaroMotionPreciseStyleRoute(preciseStyleRoute, req.userId!)
      await audit(req, "update_nodaro_motion_precise_style_route", "app_setting", NODARO_MOTION_PRECISE_STYLE_ROUTE_AUDIT_TARGET, {
        key: NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY,
        before,
        after: preciseStyleRoute,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion Precise art-style route")
    }
  })
}
