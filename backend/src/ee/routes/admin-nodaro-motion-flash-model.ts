/**
 * Video Remake's flash-model test, per engine (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET /v1/admin/video-remake/flash-model   { flashModel, updatedAt, engines, supported, environments } (flashModel null = never saved: off everywhere)
 *   PUT /v1/admin/video-remake/flash-model   { flashModel }: save the whole setting; audit-logged
 *
 * The setting (`nodaro_motion_flash_model`, lib/nodaro-motion-flash-model.ts)
 * says, per engine, whether a NEW run of that engine started by an admin
 * account is made on the faster, lower-cost model of the same family instead
 * of the engine's own (every other account's run is unchanged):
 * `"off"` (the default, on every deployment) or `"on"`. It is a test switch:
 * no run names it, and it is not one of the settings a stored settings set
 * holds (loading a set never turns it on).
 *
 * A save that turns any engine on is 409 `engine_unsupported` while NO
 * environment's engine declares `castSwap.flashModel`
 * (`nodaro-motion-flash-model-gate.ts`: only an engine that declares it reads
 * the row, so one reader is enough); off everywhere is saved whatever the
 * engines, so it can always be taken back. `supported` is whether THIS
 * environment's engine reads the row; `environments` names every environment
 * whose engine does (the row is shared, so "on" reaches admins' runs in each
 * of them). Each
 * save writes an `admin_actions` row (`update_nodaro_motion_flash_model`)
 * with the setting before and after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION, NODARO_MOTION_ENGINES, NODARO_MOTION_ENGINE_NAMES } from "@nodaro/shared/models"
import {
  NODARO_MOTION_FLASH_MODEL_KEY,
  anyFlashModelOn,
  engineTakesFlashModel,
  flashModelsOn,
  nodaroMotionFlashModelSchema,
  type NodaroMotionFlashModel,
} from "../../lib/nodaro-motion-flash-model.js"
import { readNodaroMotionFlashModel, saveNodaroMotionFlashModel } from "../../lib/nodaro-motion-flash-model-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import { NO_ENGINE_RUNS_FLASH_MODEL_MESSAGE, environmentsThatRunFlashModel, noEnvironmentRunsFlashModel } from "../lib/nodaro-motion-flash-model-gate.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"
import type { NodaroMotionAdminEngine } from "./admin-nodaro-motion.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Video Remake settings'). */
export const NODARO_MOTION_FLASH_MODEL_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a102"

const putBody = z.strictObject({ flashModel: nodaroMotionFlashModelSchema })

export interface NodaroMotionFlashModelView {
  /** null = never saved: off for every engine. Only the engines that are on are listed. */
  flashModel: NodaroMotionFlashModel | null
  updatedAt: string | null
  engines: NodaroMotionAdminEngine[]
  /** Whether this environment's Cast Swap engine runs the flash-model test (`castSwap.flashModel`). */
  supported: boolean
  /** Every environment whose engine reads the row: where "on" changes the model of new runs. */
  environments: string[]
}

async function view(): Promise<NodaroMotionFlashModelView> {
  const [{ flashModel, updatedAt }, environments] = await Promise.all([readNodaroMotionFlashModel(), listEngineEnvironments()])
  return {
    flashModel,
    updatedAt,
    engines: NODARO_MOTION_ENGINES.map((id) => ({ id, name: NODARO_MOTION_ENGINE_NAMES[id], internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id] })),
    supported: engineTakesFlashModel(getPluginSupports().castSwap),
    environments: environmentsThatRunFlashModel(environments),
  }
}

export function registerNodaroMotionFlashModelRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/video-remake/flash-model", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Video Remake flash-model test")
    }
  })

  app.put("/v1/admin/video-remake/flash-model", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const flashModel = flashModelsOn(parsed.data.flashModel)
      // "On" is saved once some environment's engine runs the test (only such an engine reads the row).
      if (anyFlashModelOn(flashModel) && noEnvironmentRunsFlashModel(await listEngineEnvironments())) {
        return reply.status(409).send({ error: { code: "engine_unsupported", message: NO_ENGINE_RUNS_FLASH_MODEL_MESSAGE } })
      }
      const before = (await readNodaroMotionFlashModel()).flashModel
      await saveNodaroMotionFlashModel(flashModel, req.userId!)
      await audit(req, "update_nodaro_motion_flash_model", "app_setting", NODARO_MOTION_FLASH_MODEL_AUDIT_TARGET, {
        key: NODARO_MOTION_FLASH_MODEL_KEY,
        before,
        after: flashModel,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Video Remake flash-model test")
    }
  })
}
