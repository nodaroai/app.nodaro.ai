/**
 * Nodaro Motion's Flex prompt wording for direct runs, per engine (registered
 * by `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its
 * edition gate). Admin-only.
 *
 *   GET /v1/admin/nodaro-motion/prompt-wording   { promptWording, updatedAt, engines, supported } (promptWording null = never saved: current everywhere)
 *   PUT /v1/admin/nodaro-motion/prompt-wording   { promptWording }: save the whole setting; audit-logged
 *
 * The setting (`nodaro_motion_prompt_wording`, lib/nodaro-motion-prompt-wording.ts)
 * says, per engine, how every DIRECT Flex run's prompt is worded: `"current"`
 * (today's, the default) or `"new"`. A trend run keeps its own trend's
 * wording; every Precise prompt ignores it.
 *
 * A save that puts any engine on "new" is 409 `engine_unsupported` while any
 * environment's engine does not list "new" in `castSwap.promptWordings`
 * (`nodaro-motion-prompt-wording-gate.ts`: the row is shared by every
 * environment); "current" everywhere is saved whatever the engines, so the
 * new wording can always be taken back. `supported` is whether THIS
 * environment's engine lists it. Each save writes an `admin_actions` row
 * (`update_nodaro_motion_prompt_wording`) with the setting before and after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION, NODARO_MOTION_ENGINES, NODARO_MOTION_ENGINE_NAMES } from "@nodaro/shared/models"
import {
  NODARO_MOTION_PROMPT_WORDING_KEY,
  anyNewWording,
  engineTakesPromptWording,
  newWordings,
  nodaroMotionPromptWordingSchema,
  type NodaroMotionPromptWording,
} from "../../lib/nodaro-motion-prompt-wording.js"
import { readNodaroMotionPromptWording, saveNodaroMotionPromptWording } from "../../lib/nodaro-motion-prompt-wording-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import { cannotUseNewWordingMessage, environmentsThatCannotUseNewWording } from "../lib/nodaro-motion-prompt-wording-gate.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"
import type { NodaroMotionAdminEngine } from "./admin-nodaro-motion.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Nodaro Motion settings'). */
export const NODARO_MOTION_PROMPT_WORDING_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0f8"

const putBody = z.strictObject({ promptWording: nodaroMotionPromptWordingSchema })

export interface NodaroMotionPromptWordingView {
  /** null = never saved: every engine on the current wording. Only the engines on "new" are listed. */
  promptWording: NodaroMotionPromptWording | null
  updatedAt: string | null
  engines: NodaroMotionAdminEngine[]
  /** Whether this environment's Cast Swap engine words a Flex prompt the new way (`castSwap.promptWordings`). */
  supported: boolean
}

async function view(): Promise<NodaroMotionPromptWordingView> {
  const { promptWording, updatedAt } = await readNodaroMotionPromptWording()
  return {
    promptWording,
    updatedAt,
    engines: NODARO_MOTION_ENGINES.map((id) => ({ id, name: NODARO_MOTION_ENGINE_NAMES[id], internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id] })),
    supported: engineTakesPromptWording(getPluginSupports().castSwap, "new"),
  }
}

export function registerNodaroMotionPromptWordingRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/nodaro-motion/prompt-wording", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion prompt wording")
    }
  })

  app.put("/v1/admin/nodaro-motion/prompt-wording", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const promptWording = newWordings(parsed.data.promptWording)
      // The new wording is saved only once every environment's engine words it (the row is shared by every environment).
      if (anyNewWording(promptWording)) {
        const envs = environmentsThatCannotUseNewWording(await listEngineEnvironments())
        if (envs.length > 0) {
          return reply.status(409).send({ error: { code: "engine_unsupported", message: cannotUseNewWordingMessage(envs), envs } })
        }
      }
      const before = (await readNodaroMotionPromptWording()).promptWording
      await saveNodaroMotionPromptWording(promptWording, req.userId!)
      await audit(req, "update_nodaro_motion_prompt_wording", "app_setting", NODARO_MOTION_PROMPT_WORDING_AUDIT_TARGET, {
        key: NODARO_MOTION_PROMPT_WORDING_KEY,
        before,
        after: promptWording,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion prompt wording")
    }
  })
}
