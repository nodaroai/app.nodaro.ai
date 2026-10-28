/**
 * Nodaro Motion's admin settings (Cloud: registered under `hasAdmin() &&
 * hasCredits()`, beside the trends admin). Admin-only.
 *
 *   GET /v1/admin/nodaro-motion/masking   the face masking per engine (null = never saved)
 *   PUT /v1/admin/nodaro-motion/masking   save it (the whole setting), audit-logged
 *   GET/PUT /v1/admin/nodaro-motion/prompt-parts, POST …/prompt-parts/preview
 *                                         the direct runs' prompt part overrides (admin-nodaro-motion-prompt-parts.ts)
 *   GET/PUT /v1/admin/nodaro-motion/motion
 *                                         the Motion style's masking and prompt style per engine (admin-nodaro-motion-motion.ts)
 *   GET/PUT /v1/admin/nodaro-motion/pulse-audio
 *                                         the direct Pulse runs' audio (admin-nodaro-motion-pulse-audio.ts)
 *   GET/PUT /v1/admin/nodaro-motion/prism-reference-audio
 *                                         the direct Prism runs' reference audio (admin-nodaro-motion-prism-reference-audio.ts)
 *
 * The setting (`nodaro_motion_masking`, lib/nodaro-motion-masking.ts) is how
 * the Cast Swap engine masks faces on every DIRECT run of each engine —
 * people running Nodaro Motion never set it, and a trend run keeps its own
 * trend's setting. Until an admin saves it, no engine masks.
 *
 * Each save writes an `admin_actions` row (`update_nodaro_motion_masking`)
 * with the setting before and after.
 */
import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import {
  CAST_SWAP_ENGINE_OF_NODARO_MOTION,
  NODARO_MOTION_ENGINES,
  NODARO_MOTION_ENGINE_NAMES,
  type NodaroMotionEngine,
} from "@nodaro/shared/models"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { nodaroMotionMaskingSchema, type NodaroMotionMasking } from "../../lib/nodaro-motion-masking.js"
import { readNodaroMotionMasking, saveNodaroMotionMasking } from "../../lib/nodaro-motion-masking-store.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"
import { registerNodaroMotionPromptPartRoutes } from "./admin-nodaro-motion-prompt-parts.js"
import { registerNodaroMotionMotionRoutes } from "./admin-nodaro-motion-motion.js"
import { registerNodaroMotionPulseAudioRoutes } from "./admin-nodaro-motion-pulse-audio.js"
import { registerNodaroMotionPrismReferenceAudioRoutes } from "./admin-nodaro-motion-prism-reference-audio.js"

/**
 * `admin_actions.target_id` is a NOT NULL uuid, and a deployment-wide setting
 * has no row id of its own: every save of this setting is filed under this
 * fixed id (with `target_type: "app_setting"` and the key in the payload).
 */
export const NODARO_MOTION_MASKING_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0f1"

const putBody = z.strictObject({ masking: nodaroMotionMaskingSchema })

/** The engines as the admin screen lists them: public id, name, and the internal engine it runs on. */
export interface NodaroMotionAdminEngine {
  id: NodaroMotionEngine
  name: string
  internal: string
}

export interface NodaroMotionMaskingView {
  /** null = never saved: no engine masks. An engine left out masks nothing. */
  masking: NodaroMotionMasking | null
  updatedAt: string | null
  engines: NodaroMotionAdminEngine[]
}

const ENGINES: NodaroMotionAdminEngine[] = NODARO_MOTION_ENGINES.map((id) => ({
  id,
  name: NODARO_MOTION_ENGINE_NAMES[id],
  internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id],
}))

async function view(): Promise<NodaroMotionMaskingView> {
  const { masking, updatedAt } = await readNodaroMotionMasking()
  return { masking, updatedAt, engines: ENGINES.map((e) => ({ ...e })) }
}

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

export async function adminNodaroMotionRoutes(app: FastifyInstance) {
  registerNodaroMotionPromptPartRoutes(app)
  registerNodaroMotionMotionRoutes(app)
  registerNodaroMotionPulseAudioRoutes(app)
  registerNodaroMotionPrismReferenceAudioRoutes(app)
  app.get("/v1/admin/nodaro-motion/masking", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion masking")
    }
  })

  app.put("/v1/admin/nodaro-motion/masking", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      const before = (await readNodaroMotionMasking()).masking
      await saveNodaroMotionMasking(parsed.data.masking, req.userId!)
      await audit(req, "update_nodaro_motion_masking", "app_setting", NODARO_MOTION_MASKING_AUDIT_TARGET, {
        key: "nodaro_motion_masking",
        before,
        after: parsed.data.masking,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion masking")
    }
  })
}
