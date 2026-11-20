/**
 * Video Remake's shot lock for direct runs, per engine (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET /v1/admin/video-remake/shot-lock   { shotLock, updatedAt, engines, supported } (shotLock null = never saved: off everywhere)
 *   PUT /v1/admin/video-remake/shot-lock   { shotLock }: save the whole setting; audit-logged
 *
 * The setting (`nodaro_motion_shot_lock`, lib/nodaro-motion-shot-lock.ts)
 * says, per engine, whether the prompt of every DIRECT run on an ordinary
 * clip carries one more line, which tells the video model to keep the clip's
 * shot order and add no shot: `"off"` (the default, on every deployment) or
 * `"on"`. A trend run, a style-only run and a 3D previz run never read it.
 *
 * A save that turns any engine on is 409 `engine_unsupported` while NO
 * environment's engine declares `castSwap.shotLock`
 * (`nodaro-motion-shot-lock-gate.ts`: only an engine that declares it reads
 * the row, so one reader is enough); off everywhere is saved whatever the
 * engines, so it can always be taken back. `supported` is whether THIS
 * environment's engine writes the line. Each save writes an `admin_actions`
 * row (`update_nodaro_motion_shot_lock`) with the setting before and after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION, NODARO_MOTION_ENGINES, NODARO_MOTION_ENGINE_NAMES } from "@nodaro/shared/models"
import {
  NODARO_MOTION_SHOT_LOCK_KEY,
  anyShotLockOn,
  engineTakesShotLock,
  nodaroMotionShotLockSchema,
  shotLocksOn,
  type NodaroMotionShotLock,
} from "../../lib/nodaro-motion-shot-lock.js"
import { readNodaroMotionShotLock, saveNodaroMotionShotLock } from "../../lib/nodaro-motion-shot-lock-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import { NO_ENGINE_WRITES_SHOT_LOCK_MESSAGE, noEnvironmentWritesShotLock } from "../lib/nodaro-motion-shot-lock-gate.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { defineNodaroMotionSettingsSection, sendRefusal } from "../lib/nodaro-motion-settings-section.js"
import { audit } from "./admin-trends-lifecycle.js"
import type { NodaroMotionAdminEngine } from "./admin-nodaro-motion.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Video Remake settings'). */
export const NODARO_MOTION_SHOT_LOCK_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a101"

const putBody = z.strictObject({ shotLock: nodaroMotionShotLockSchema })

/** The setting as a stored settings set holds it (admin-nodaro-motion-settings-sets.ts): the engines that are on only. */
export const NODARO_MOTION_SHOT_LOCK_SECTION = defineNodaroMotionSettingsSection({
  key: "shot-lock",
  path: "/v1/admin/video-remake/shot-lock",
  label: "Shot lock",
  body: putBody,
  prepare: (body) => ({ value: { shotLock: shotLocksOn(body.shotLock) } }),
  // "On" is saved once some environment's engine writes the line (only such an engine reads the row).
  engineRefusal: async ({ shotLock }) => {
    if (!anyShotLockOn(shotLock)) return null
    return noEnvironmentWritesShotLock(await listEngineEnvironments())
      ? { status: 409, error: { code: "engine_unsupported", message: NO_ENGINE_WRITES_SHOT_LOCK_MESSAGE } }
      : null
  },
  readLive: async () => {
    const { shotLock } = await readNodaroMotionShotLock()
    return shotLock === null ? null : { shotLock }
  },
})

export interface NodaroMotionShotLockView {
  /** null = never saved: off for every engine. Only the engines that are on are listed. */
  shotLock: NodaroMotionShotLock | null
  updatedAt: string | null
  engines: NodaroMotionAdminEngine[]
  /** Whether this environment's Cast Swap engine writes the shot lock's line (`castSwap.shotLock`). */
  supported: boolean
}

async function view(): Promise<NodaroMotionShotLockView> {
  const { shotLock, updatedAt } = await readNodaroMotionShotLock()
  return {
    shotLock,
    updatedAt,
    engines: NODARO_MOTION_ENGINES.map((id) => ({ id, name: NODARO_MOTION_ENGINE_NAMES[id], internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id] })),
    supported: engineTakesShotLock(getPluginSupports().castSwap),
  }
}

export function registerNodaroMotionShotLockRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/video-remake/shot-lock", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Video Remake shot lock")
    }
  })

  app.put("/v1/admin/video-remake/shot-lock", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = NODARO_MOTION_SHOT_LOCK_SECTION.body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const prepared = NODARO_MOTION_SHOT_LOCK_SECTION.prepare(parsed.data)
      if ("refusal" in prepared) return sendRefusal(reply, prepared.refusal)
      const { shotLock } = prepared.value
      const refusal = await NODARO_MOTION_SHOT_LOCK_SECTION.engineRefusal!(prepared.value, null)
      if (refusal) return sendRefusal(reply, refusal)
      const before = (await readNodaroMotionShotLock()).shotLock
      await saveNodaroMotionShotLock(shotLock, req.userId!)
      await audit(req, "update_nodaro_motion_shot_lock", "app_setting", NODARO_MOTION_SHOT_LOCK_AUDIT_TARGET, {
        key: NODARO_MOTION_SHOT_LOCK_KEY,
        before,
        after: shotLock,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Video Remake shot lock")
    }
  })
}
