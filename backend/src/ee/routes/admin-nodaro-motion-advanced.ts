/**
 * Whether a Nodaro Motion page shows its Advanced options — Prepare
 * references and the pre-prompt (registered by `adminNodaroMotionRoutes`,
 * admin-nodaro-motion.ts, so it shares its edition gate). Admin-only.
 *
 *   GET /v1/admin/nodaro-motion/advanced   { show, updatedAt } (updatedAt null = never saved: hidden)
 *   PUT /v1/admin/nodaro-motion/advanced   { show }: save it; audit-logged
 *
 * The setting (`nodaro_motion_advanced`, lib/nodaro-motion-advanced.ts) is
 * one switch for the whole page, not per engine, off until an admin turns it
 * on. Clients read it through `GET /v1/cast-swap/advanced` to show or hide
 * the options. A page option only: nothing about a run or a quote reads it
 * (the API, the SDK and MCP take `prepareReferences` and `prePrompt` whatever
 * it says), so there is no engine check: any value is saved in every
 * environment. Each save writes an `admin_actions` row
 * (`update_nodaro_motion_advanced`) with the setting before and after.
 */
import type { FastifyInstance } from "fastify"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { NODARO_MOTION_ADVANCED_KEY, advancedShown, nodaroMotionAdvancedSchema } from "../../lib/nodaro-motion-advanced.js"
import { readNodaroMotionAdvanced, saveNodaroMotionAdvanced } from "../../lib/nodaro-motion-advanced-store.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Nodaro Motion settings'). */
export const NODARO_MOTION_ADVANCED_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0f9"

export interface NodaroMotionAdvancedView {
  /** Whether a Nodaro Motion page shows its Advanced options; false until an admin turns them on. */
  show: boolean
  /** null = never saved. */
  updatedAt: string | null
}

async function view(): Promise<NodaroMotionAdvancedView> {
  const { advanced, updatedAt } = await readNodaroMotionAdvanced()
  return { ...advancedShown(advanced), updatedAt }
}

export function registerNodaroMotionAdvancedRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/nodaro-motion/advanced", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion Advanced setting")
    }
  })

  app.put("/v1/admin/nodaro-motion/advanced", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = nodaroMotionAdvancedSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const advanced = { show: parsed.data.show }
      const before = (await readNodaroMotionAdvanced()).advanced
      await saveNodaroMotionAdvanced(advanced, req.userId!)
      await audit(req, "update_nodaro_motion_advanced", "app_setting", NODARO_MOTION_ADVANCED_AUDIT_TARGET, {
        key: NODARO_MOTION_ADVANCED_KEY,
        before,
        after: advanced,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion Advanced setting")
    }
  })
}
