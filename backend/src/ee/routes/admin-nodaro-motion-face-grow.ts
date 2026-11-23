/**
 * Video Remake's face grow, per engine (registered by `adminNodaroMotionRoutes`,
 * admin-nodaro-motion.ts, so it shares its edition gate). Admin-only.
 *
 *   GET /v1/admin/video-remake/face-grow   { faceGrow, updatedAt, engines, supported } (faceGrow null = never saved: no engine grows)
 *   PUT /v1/admin/video-remake/face-grow   { faceGrow }: save the whole setting; audit-logged
 *
 * The setting (`nodaro_motion_face_grow`, lib/nodaro-motion-face-grow-setting.ts):
 * per engine, how far a direct Precise run's face mask is widened (% of each
 * face's height, 0–40, 0 = off) — applied where the engine's Precise masking
 * has target "face" and a blur or depth fill. Its own row, so the masking row
 * stays readable by every build. A stored settings set holds it as its own
 * section ("face-grow").
 *
 * A PUT is refused:
 *  - 400 `validation_error`: the body's shape (strict; whole numbers 0–40);
 *  - 422 `platform_unsupported`: a grow while any environment's platform does
 *    not take the row (`nodaro-motion-face-grow.ts`: it would not grow there);
 *  - 409 `engine_unsupported`: a grow while any environment's engine does not
 *    declare `castSwap.faceGrow`.
 * Every engine at 0 is saved whatever the environments, so a grow can always
 * be taken back. Each save writes an `admin_actions` row
 * (`update_nodaro_motion_face_grow`) with the setting before and after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION, NODARO_MOTION_ENGINES, NODARO_MOTION_ENGINE_NAMES } from "@nodaro/shared/models"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import {
  NODARO_MOTION_FACE_GROW_KEY,
  anyFaceGrow,
  nodaroMotionFaceGrowSchema,
  withoutDefaultFaceGrow,
  type NodaroMotionFaceGrow,
} from "../../lib/nodaro-motion-face-grow-setting.js"
import { readNodaroMotionFaceGrow, saveNodaroMotionFaceGrow } from "../../lib/nodaro-motion-face-grow-store.js"
import { engineGrowsFaceMask } from "../../lib/cast-swap-face-masking.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import { cannotGrowFaceMaskMessage, environmentsThatCannotGrowFaceMask, platformHoldOfFaceGrow } from "../lib/nodaro-motion-face-grow.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { defineNodaroMotionSettingsSection, sendRefusal } from "../lib/nodaro-motion-settings-section.js"
import { audit } from "./admin-trends-lifecycle.js"
import type { NodaroMotionAdminEngine } from "./admin-nodaro-motion.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Video Remake settings'). */
export const NODARO_MOTION_FACE_GROW_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a105"

const putBody = z.strictObject({ faceGrow: nodaroMotionFaceGrowSchema })

/** The setting as a stored settings set holds it (its own section): the engines that grow. */
export const NODARO_MOTION_FACE_GROW_SECTION = defineNodaroMotionSettingsSection({
  key: "face-grow",
  path: "/v1/admin/video-remake/face-grow",
  label: "Face grow",
  body: putBody,
  prepare: (body) => ({ value: { faceGrow: withoutDefaultFaceGrow(body.faceGrow) } }),
  engineRefusal: async ({ faceGrow }) => {
    if (!anyFaceGrow(faceGrow)) return null
    const environments = await listEngineEnvironments()
    const held = platformHoldOfFaceGrow(environments)
    if (held) return { status: 422, error: held }
    const lacking = environmentsThatCannotGrowFaceMask(environments)
    return lacking.length > 0 ? { status: 409, error: { code: "engine_unsupported", message: cannotGrowFaceMaskMessage(lacking), envs: lacking } } : null
  },
  readLive: async () => {
    const { faceGrow } = await readNodaroMotionFaceGrow()
    return faceGrow === null ? null : { faceGrow }
  },
})

export interface NodaroMotionFaceGrowView {
  /** null = never saved: no engine grows. Only the engines that grow are listed. */
  faceGrow: NodaroMotionFaceGrow | null
  updatedAt: string | null
  engines: NodaroMotionAdminEngine[]
  /** Whether this environment's Cast Swap engine grows (`castSwap.faceGrow`). */
  supported: boolean
}

async function view(): Promise<NodaroMotionFaceGrowView> {
  const { faceGrow, updatedAt } = await readNodaroMotionFaceGrow()
  return {
    faceGrow,
    updatedAt,
    engines: NODARO_MOTION_ENGINES.map((id) => ({ id, name: NODARO_MOTION_ENGINE_NAMES[id], internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id] })),
    supported: engineGrowsFaceMask(getPluginSupports().castSwap),
  }
}

export function registerNodaroMotionFaceGrowRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/video-remake/face-grow", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Video Remake face grow")
    }
  })

  app.put("/v1/admin/video-remake/face-grow", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = NODARO_MOTION_FACE_GROW_SECTION.body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const prepared = NODARO_MOTION_FACE_GROW_SECTION.prepare(parsed.data)
      if ("refusal" in prepared) return sendRefusal(reply, prepared.refusal)
      const refusal = await NODARO_MOTION_FACE_GROW_SECTION.engineRefusal!(prepared.value, null)
      if (refusal) return sendRefusal(reply, refusal)
      const { faceGrow } = prepared.value
      const before = (await readNodaroMotionFaceGrow()).faceGrow
      await saveNodaroMotionFaceGrow(faceGrow, req.userId!)
      await audit(req, "update_nodaro_motion_face_grow", "app_setting", NODARO_MOTION_FACE_GROW_AUDIT_TARGET, { key: NODARO_MOTION_FACE_GROW_KEY, before, after: faceGrow })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Video Remake face grow")
    }
  })
}
