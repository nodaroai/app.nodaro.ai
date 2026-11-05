/**
 * Nodaro Motion's no-person setting, per engine (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET /v1/admin/nodaro-motion/no-person   { noPerson, updatedAt, engines, supported } (noPerson null = never saved: the default)
 *   PUT /v1/admin/nodaro-motion/no-person   { noPerson }: save the whole setting; audit-logged
 *
 * The setting (`nodaro_motion_no_person`, lib/nodaro-motion-no-person.ts) says,
 * per engine, whether a DIRECT Precise run with no pictured person sends its
 * source clip: on, the default, or `sourceClip: false` for off.
 *
 * A PUT is refused:
 *  - 400 `validation_error`: the body's shape (strict);
 *  - 409 `engine_unsupported`: a change while NO environment's engine declares
 *    `castSwap.noPersonSourceClip` (`nodaro-motion-no-person-gate.ts`: an
 *    engine without it never reads the row, so one reader is enough).
 * The default is saved whatever the engines, so a change can always be taken
 * back; it is left out of what is stored. `supported` is whether THIS
 * environment's engine declares it. Each save writes an `admin_actions` row
 * (`update_nodaro_motion_no_person`) with the setting before and after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION, NODARO_MOTION_ENGINES, NODARO_MOTION_ENGINE_NAMES } from "@nodaro/shared/models"
import {
  NODARO_MOTION_NO_PERSON_KEY,
  anyNoPersonChange,
  engineTakesNoPersonSourceClip,
  nodaroMotionNoPersonSchema,
  withoutDefaultNoPerson,
  type NodaroMotionNoPerson,
} from "../../lib/nodaro-motion-no-person.js"
import { readNodaroMotionNoPerson, saveNodaroMotionNoPerson } from "../../lib/nodaro-motion-no-person-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import { NO_ENGINE_READS_NO_PERSON_MESSAGE, noEnvironmentRunsNoPerson } from "../lib/nodaro-motion-no-person-gate.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"
import type { NodaroMotionAdminEngine } from "./admin-nodaro-motion.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Nodaro Motion settings'). */
export const NODARO_MOTION_NO_PERSON_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0fc"

const putBody = z.strictObject({ noPerson: nodaroMotionNoPersonSchema })

export interface NodaroMotionNoPersonView {
  /** null = never saved: every engine on the default. Only what differs from it is listed. */
  noPerson: NodaroMotionNoPerson | null
  updatedAt: string | null
  engines: NodaroMotionAdminEngine[]
  /** Whether this environment's Cast Swap engine reads the setting (`castSwap.noPersonSourceClip`). */
  supported: boolean
}

async function view(): Promise<NodaroMotionNoPersonView> {
  const { noPerson, updatedAt } = await readNodaroMotionNoPerson()
  return {
    noPerson,
    updatedAt,
    engines: NODARO_MOTION_ENGINES.map((id) => ({ id, name: NODARO_MOTION_ENGINE_NAMES[id], internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id] })),
    supported: engineTakesNoPersonSourceClip(getPluginSupports().castSwap),
  }
}

export function registerNodaroMotionNoPersonRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/nodaro-motion/no-person", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion no-person setting")
    }
  })

  app.put("/v1/admin/nodaro-motion/no-person", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const noPerson = withoutDefaultNoPerson(parsed.data.noPerson)
      // A change is saved once one environment's engine reads the row (an engine without the flag never does).
      if (anyNoPersonChange(noPerson) && noEnvironmentRunsNoPerson(await listEngineEnvironments())) {
        return reply.status(409).send({ error: { code: "engine_unsupported", message: NO_ENGINE_READS_NO_PERSON_MESSAGE, envs: [] } })
      }
      const before = (await readNodaroMotionNoPerson()).noPerson
      await saveNodaroMotionNoPerson(noPerson, req.userId!)
      await audit(req, "update_nodaro_motion_no_person", "app_setting", NODARO_MOTION_NO_PERSON_AUDIT_TARGET, {
        key: NODARO_MOTION_NO_PERSON_KEY,
        before,
        after: noPerson,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion no-person setting")
    }
  })
}
