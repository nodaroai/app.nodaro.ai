/**
 * Video Remake's shot-list frame rate (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET /v1/admin/video-remake/shot-list-fps   { shotListFps, fps, defaultFps, options, updatedAt, supported, rateCarried }
 *                                              (shotListFps null = never saved: the engine's default)
 *   PUT /v1/admin/video-remake/shot-list-fps   { shotListFps }: save the whole setting; audit-logged
 *
 * The setting (`nodaro_motion_shot_list_fps`, lib/nodaro-motion-shot-list-fps.ts)
 * says how many frames of each second the model that writes a run's shot
 * list is shown of the clip. `fps` is stored only once an admin chose a
 * rate: `fps` in the view is the rate in effect, `defaultFps` what the engine
 * applies while none is stored (the recommended rate).
 *
 * There is no engine check: the rate is saved whatever the engines. An
 * engine that does not declare `castSwap.shotListFps` never reads the row
 * (`supported` false), and a deployment that cannot serve a call carrying a
 * rate answers its engine 1 whatever is saved (`rateCarried` false). Each
 * save writes an `admin_actions` row (`update_nodaro_motion_shot_list_fps`)
 * with the setting before and after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { geminiKeySet } from "../../lib/llm/anthropic-availability.js"
import {
  NODARO_MOTION_SHOT_LIST_FPS_DEFAULT,
  NODARO_MOTION_SHOT_LIST_FPS_KEY,
  NODARO_MOTION_SHOT_LIST_FPS_OPTIONS,
  engineTakesShotListFps,
  nodaroMotionShotListFpsSchema,
  shotListFpsInEffect,
  withoutDefaultShotListFps,
  type NodaroMotionShotListFps,
} from "../../lib/nodaro-motion-shot-list-fps.js"
import { readNodaroMotionShotListFps, saveNodaroMotionShotListFps } from "../../lib/nodaro-motion-shot-list-fps-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { defineNodaroMotionSettingsSection, sendRefusal } from "../lib/nodaro-motion-settings-section.js"
import { audit } from "./admin-trends-lifecycle.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Video Remake settings'). */
export const NODARO_MOTION_SHOT_LIST_FPS_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a103"

const putBody = z.strictObject({ shotListFps: nodaroMotionShotListFpsSchema })

/**
 * The setting as a stored settings set holds it (admin-nodaro-motion-settings-sets.ts): what an admin set. Saved
 * whatever the engines (one that reads no frame rate never reads the row).
 */
export const NODARO_MOTION_SHOT_LIST_FPS_SECTION = defineNodaroMotionSettingsSection({
  key: "shot-list-fps",
  path: "/v1/admin/video-remake/shot-list-fps",
  label: "Shot list frame rate",
  body: putBody,
  prepare: (body) => ({ value: { shotListFps: withoutDefaultShotListFps(body.shotListFps) } }),
  readLive: async () => {
    const { shotListFps } = await readNodaroMotionShotListFps()
    return shotListFps === null ? null : { shotListFps }
  },
})

export interface NodaroMotionShotListFpsView {
  /** null = never saved. Only what an admin set is listed. */
  shotListFps: NodaroMotionShotListFps | null
  /** The rate in effect, frames a second: the saved choice, else `defaultFps`. */
  fps: number
  /** What the engine applies while no choice is saved: the recommended rate. */
  defaultFps: number
  /** The rates an admin may choose. */
  options: readonly number[]
  updatedAt: string | null
  /** Whether this environment's Cast Swap engine reads its shot list's clip at a frame rate (`castSwap.shotListFps`). */
  supported: boolean
  /** Whether this deployment can serve a call that carries a frame rate (it needs the model provider's own API key); false: clips are read at 1 whatever is saved. */
  rateCarried: boolean
}

async function view(): Promise<NodaroMotionShotListFpsView> {
  const { shotListFps, updatedAt } = await readNodaroMotionShotListFps()
  return {
    shotListFps,
    fps: shotListFpsInEffect(shotListFps),
    defaultFps: NODARO_MOTION_SHOT_LIST_FPS_DEFAULT,
    options: [...NODARO_MOTION_SHOT_LIST_FPS_OPTIONS],
    updatedAt,
    supported: engineTakesShotListFps(getPluginSupports().castSwap),
    rateCarried: geminiKeySet(),
  }
}

export function registerNodaroMotionShotListFpsRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/video-remake/shot-list-fps", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Video Remake shot-list frame rate")
    }
  })

  app.put("/v1/admin/video-remake/shot-list-fps", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = NODARO_MOTION_SHOT_LIST_FPS_SECTION.body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const prepared = NODARO_MOTION_SHOT_LIST_FPS_SECTION.prepare(parsed.data)
      if ("refusal" in prepared) return sendRefusal(reply, prepared.refusal)
      const { shotListFps } = prepared.value
      const before = (await readNodaroMotionShotListFps()).shotListFps
      await saveNodaroMotionShotListFps(shotListFps, req.userId!)
      await audit(req, "update_nodaro_motion_shot_list_fps", "app_setting", NODARO_MOTION_SHOT_LIST_FPS_AUDIT_TARGET, {
        key: NODARO_MOTION_SHOT_LIST_FPS_KEY,
        before,
        after: shotListFps,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Video Remake shot-list frame rate")
    }
  })
}
