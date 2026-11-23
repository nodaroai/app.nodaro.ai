/**
 * Video Remake's Precise upscale (registered by `adminNodaroMotionRoutes`,
 * admin-nodaro-motion.ts, so it shares its edition gate). Admin-only.
 *
 *   GET /v1/admin/video-remake/precise-upscale   { value, stored, defaults, updatedAt, supported }
 *   PUT /v1/admin/video-remake/precise-upscale   { preciseUpscale }: save the whole setting (a resolution left out at its default); audit-logged
 *
 * The setting (`nodaro_motion_precise_upscale`, lib/cast-swap-prism-precise-upscale.ts)
 * says, per output resolution (480p, 720p, 1080p), whether a DIRECT Precise run
 * on Nodaro Prism sends its take to Topaz video upscale, and at which size
 * ("off", or the Topaz target: 480p and 720p take 720p, 1080p or 4k; 1080p
 * takes 1080p or 4k), before the result is scaled back to the run's own frame.
 * A resolution never saved takes its default (480p and 720p: 1080p; 1080p: 4k).
 *
 * `value` is the effective setting (every resolution filled), `stored` what was
 * saved (null = never saved), `defaults` each resolution's default.
 *
 * A PUT is refused 400 `validation_error` on the body's shape (strict: an
 * unknown key, or a choice that resolution does not take). Any value saves
 * whatever the engines: an engine that does not declare
 * `castSwap.preciseUpscale` never reads the row and runs no upscale, so no 409
 * waits for one. `supported` is whether THIS environment's engine declares it;
 * `topazDisabled` whether this deployment withholds Topaz (then the engine is
 * answered every resolution "off", whatever is saved).
 * Each save writes an `admin_actions` row
 * (`update_nodaro_motion_precise_upscale`) with the setting before and after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import {
  NODARO_MOTION_PRECISE_UPSCALE_KEY,
  effectivePreciseUpscale,
  engineTakesPreciseUpscale,
  nodaroMotionPreciseUpscaleSchema,
  type NodaroMotionPreciseUpscale,
  type NodaroMotionPreciseUpscaleEffective,
} from "../../lib/cast-swap-prism-precise-upscale.js"
import { readNodaroMotionPreciseUpscale, saveNodaroMotionPreciseUpscale } from "../../lib/nodaro-motion-precise-upscale-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { topazVideoDisabledHere } from "../../lib/topaz-video-availability.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { defineNodaroMotionSettingsSection, sendRefusal } from "../lib/nodaro-motion-settings-section.js"
import { audit } from "./admin-trends-lifecycle.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Video Remake settings'). */
export const NODARO_MOTION_PRECISE_UPSCALE_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a104"

const putBody = z.strictObject({ preciseUpscale: nodaroMotionPreciseUpscaleSchema })

/**
 * The setting as a stored settings set holds it (admin-nodaro-motion-settings-sets.ts): the whole effective setting,
 * each resolution a PUT leaves out filled with its default, so what is saved is what runs and a set reads back as the
 * admin page holds it. Saved whatever the engines (no engine refusal).
 */
export const NODARO_MOTION_PRECISE_UPSCALE_SECTION = defineNodaroMotionSettingsSection({
  key: "precise-upscale",
  path: "/v1/admin/video-remake/precise-upscale",
  label: "Precise upscale (Topaz)",
  body: putBody,
  prepare: (body) => ({ value: { preciseUpscale: effectivePreciseUpscale(body.preciseUpscale) } }),
  readLive: async () => {
    const { preciseUpscale } = await readNodaroMotionPreciseUpscale()
    return preciseUpscale === null ? null : { preciseUpscale }
  },
})

export interface NodaroMotionPreciseUpscaleView {
  /** The effective setting: each resolution's stored choice, else its default. */
  value: NodaroMotionPreciseUpscaleEffective
  /** What was saved; null = never saved (every default). */
  stored: NodaroMotionPreciseUpscale | null
  /** Each resolution's default. */
  defaults: NodaroMotionPreciseUpscaleEffective
  updatedAt: string | null
  /** Whether this environment's Cast Swap engine runs the step (`castSwap.preciseUpscale`). */
  supported: boolean
  /** Whether this deployment withholds Topaz video upscale (its model or its credit row switched off): every run is then answered "off". */
  topazDisabled: boolean
}

async function view(): Promise<NodaroMotionPreciseUpscaleView> {
  const { preciseUpscale, updatedAt } = await readNodaroMotionPreciseUpscale()
  return {
    value: effectivePreciseUpscale(preciseUpscale),
    stored: preciseUpscale,
    defaults: effectivePreciseUpscale(null),
    updatedAt,
    supported: engineTakesPreciseUpscale(getPluginSupports().castSwap),
    topazDisabled: topazVideoDisabledHere(),
  }
}

export function registerNodaroMotionPreciseUpscaleRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/video-remake/precise-upscale", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Video Remake Precise upscale")
    }
  })

  app.put("/v1/admin/video-remake/precise-upscale", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = NODARO_MOTION_PRECISE_UPSCALE_SECTION.body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const prepared = NODARO_MOTION_PRECISE_UPSCALE_SECTION.prepare(parsed.data)
      if ("refusal" in prepared) return sendRefusal(reply, prepared.refusal)
      const { preciseUpscale } = prepared.value
      const before = (await readNodaroMotionPreciseUpscale()).preciseUpscale
      await saveNodaroMotionPreciseUpscale(preciseUpscale, req.userId!)
      await audit(req, "update_nodaro_motion_precise_upscale", "app_setting", NODARO_MOTION_PRECISE_UPSCALE_AUDIT_TARGET, {
        key: NODARO_MOTION_PRECISE_UPSCALE_KEY,
        before,
        after: preciseUpscale,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Video Remake Precise upscale")
    }
  })
}
