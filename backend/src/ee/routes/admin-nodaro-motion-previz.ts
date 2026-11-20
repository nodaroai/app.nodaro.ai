/**
 * Whether Video Remake accepts a 3D previz clip (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET /v1/admin/video-remake/previz   { previz, enabled, enabledByDefault, updatedAt, supported }
 *                                       (previz null = never saved: the deployment's default)
 *   PUT /v1/admin/video-remake/previz   { previz }: save the whole setting; audit-logged
 *
 * The setting (`nodaro_motion_previz`, lib/nodaro-motion-previz.ts) says
 * whether a run may state that its clip is a 3D previz (`clipKind: "previz"`
 * on the run and the estimate): the engine then renders the clip into the
 * run's look instead of editing it. `enabled` is stored only once an admin
 * chose a value: `enabled` in the view is the resolved answer,
 * `enabledByDefault` what this deployment answers while none is stored (on
 * for Nodaro's own, off under a white-label surface profile).
 *
 * There is no engine check: the switch is saved whatever the engines. An
 * engine that does not declare `castSwap.previz` never reads the row, and a
 * run naming such a clip is refused before it reaches that engine
 * (lib/cast-swap-previz-gate.ts), so nothing reads the switch there
 * (`supported` false). Each save writes an `admin_actions` row
 * (`update_nodaro_motion_previz`) with the setting before and after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import {
  NODARO_MOTION_PREVIZ_KEY,
  engineTakesPreviz,
  nodaroMotionPrevizSchema,
  previzEnabled,
  withoutDefaultPreviz,
  type NodaroMotionPreviz,
} from "../../lib/nodaro-motion-previz.js"
import { previzOfferedByDefault } from "../../lib/nodaro-motion-previz-default.js"
import { readNodaroMotionPreviz, saveNodaroMotionPreviz } from "../../lib/nodaro-motion-previz-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { defineNodaroMotionSettingsSection, sendRefusal } from "../lib/nodaro-motion-settings-section.js"
import { audit } from "./admin-trends-lifecycle.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Video Remake settings'). */
export const NODARO_MOTION_PREVIZ_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a100"

const putBody = z.strictObject({ previz: nodaroMotionPrevizSchema })

/**
 * The setting as a stored settings set holds it (admin-nodaro-motion-settings-sets.ts): what an admin set. Saved
 * whatever the engines (one that takes no 3D previz clip never reads the row).
 */
export const NODARO_MOTION_PREVIZ_SECTION = defineNodaroMotionSettingsSection({
  key: "previz",
  path: "/v1/admin/video-remake/previz",
  label: "3D previz clips",
  body: putBody,
  prepare: (body) => ({ value: { previz: withoutDefaultPreviz(body.previz) } }),
  readLive: async () => {
    const { previz } = await readNodaroMotionPreviz()
    return previz === null ? null : { previz }
  },
})

export interface NodaroMotionPrevizView {
  /** null = never saved. Only what an admin set is listed. */
  previz: NodaroMotionPreviz | null
  /** Whether this deployment accepts a 3D previz clip: the saved choice, else `enabledByDefault`. */
  enabled: boolean
  /** What this deployment answers while no choice is saved: false under a white-label surface profile. */
  enabledByDefault: boolean
  updatedAt: string | null
  /** Whether this environment's Cast Swap engine takes a 3D previz clip (`castSwap.previz`). */
  supported: boolean
}

async function view(): Promise<NodaroMotionPrevizView> {
  const { previz, updatedAt } = await readNodaroMotionPreviz()
  const enabledByDefault = previzOfferedByDefault()
  return {
    previz,
    enabled: previzEnabled(previz, enabledByDefault),
    enabledByDefault,
    updatedAt,
    supported: engineTakesPreviz(getPluginSupports().castSwap),
  }
}

export function registerNodaroMotionPrevizRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/video-remake/previz", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Video Remake previz setting")
    }
  })

  app.put("/v1/admin/video-remake/previz", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = NODARO_MOTION_PREVIZ_SECTION.body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const prepared = NODARO_MOTION_PREVIZ_SECTION.prepare(parsed.data)
      if ("refusal" in prepared) return sendRefusal(reply, prepared.refusal)
      const { previz } = prepared.value
      const before = (await readNodaroMotionPreviz()).previz
      await saveNodaroMotionPreviz(previz, req.userId!)
      await audit(req, "update_nodaro_motion_previz", "app_setting", NODARO_MOTION_PREVIZ_AUDIT_TARGET, {
        key: NODARO_MOTION_PREVIZ_KEY,
        before,
        after: previz,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Video Remake previz setting")
    }
  })
}
