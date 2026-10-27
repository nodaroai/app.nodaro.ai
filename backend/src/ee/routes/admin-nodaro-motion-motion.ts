/**
 * Nodaro Motion's Motion setting for direct runs, per engine (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET /v1/admin/nodaro-motion/motion   the setting (null = never saved), the engines, the prompt styles and the engine's supports
 *   PUT /v1/admin/nodaro-motion/motion   { motion }: save the whole setting; audit-logged
 *
 * The setting (`nodaro_motion_motion`, lib/nodaro-motion-motion.ts) is how
 * the Cast Swap engine prepares the clip and words the prompt of every DIRECT
 * run with `style: "motion"`: per engine, its masking (a face mask, or full
 * depth with its scene source) and its prompt style. An engine left out runs
 * Motion on its Precise masking with the Flexible prompt. A trend run keeps
 * its own trend's setting.
 *
 * A save first re-checks the Motion prompt part overrides already saved
 * (`nodaro_motion_prompt_parts`, each engine's `motion` entry) against the
 * NEW setting, on a large direct run (`directRunPromptProblems`): a
 * part the new masking or prompt style does not use, or a prompt grown too
 * long, is 422 `prompt_parts_invalid` with every problem (each naming its
 * `engine` and `style`), and nothing is saved. An engine that does not take
 * prompt parts, or words the prompt from `style` alone (no
 * `castSwap.promptStyles`), is not asked: the setting cannot change its
 * parts.
 *
 * The GET also answers `supports`: what this environment's Cast Swap engine
 * declares of what the setting uses (`styles`, `sourceModes`, `promptStyles`,
 * `fullDepthScenes`; each absent = an engine from before it), so the screen
 * can say when the engine is out of date.
 *
 * Each save writes an `admin_actions` row (`update_nodaro_motion_motion`)
 * with the setting before and after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { CAST_SWAP_PROMPT_STYLES } from "@nodaro/render-rules"
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION, NODARO_MOTION_ENGINES, NODARO_MOTION_ENGINE_NAMES } from "@nodaro/shared/models"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { NODARO_MOTION_MOTION_KEY, nodaroMotionMotionSchema } from "../../lib/nodaro-motion-motion.js"
import { readNodaroMotionMotion, saveNodaroMotionMotion } from "../../lib/nodaro-motion-motion-store.js"
import { readNodaroMotionPromptParts } from "../../lib/nodaro-motion-prompt-parts-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { loadedEngineHasPromptParts } from "../lib/cast-swap-prompt-parts.js"
import { directRunPromptPartsInvalid, directRunPromptProblems, loadedEngineHasPromptStyles, type DirectRunPromptProblem } from "../lib/nodaro-motion-prompt-check.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"

/**
 * `admin_actions.target_id` is a NOT NULL uuid, and a deployment-wide setting
 * has no row id of its own: every save of this setting is filed under this
 * fixed id (its own, beside the masking and prompt parts settings').
 */
export const NODARO_MOTION_MOTION_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0f3"

const putBody = z.strictObject({ motion: nodaroMotionMotionSchema })

async function view() {
  const { motion, updatedAt } = await readNodaroMotionMotion()
  return {
    motion,
    updatedAt,
    engines: NODARO_MOTION_ENGINES.map((id) => ({ id, name: NODARO_MOTION_ENGINE_NAMES[id], internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id] })),
    promptStyles: [...CAST_SWAP_PROMPT_STYLES],
    supports: engineSupports(),
  }
}

/** What this environment's engine declares of what the setting uses (copies; absent = not declared). */
function engineSupports() {
  const cs = getPluginSupports().castSwap
  return {
    ...(cs?.styles ? { styles: [...cs.styles] } : {}),
    ...(cs?.sourceModes ? { sourceModes: [...cs.sourceModes] } : {}),
    ...(cs?.promptStyles ? { promptStyles: [...cs.promptStyles] } : {}),
    ...(cs?.fullDepthScenes ? { fullDepthScenes: [...cs.fullDepthScenes] } : {}),
  }
}

export function registerNodaroMotionMotionRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/nodaro-motion/motion", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion Motion setting")
    }
  })

  app.put("/v1/admin/nodaro-motion/motion", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      // The Motion overrides already saved are re-checked against the new shape (a mode or prompt style
      // change can leave a part unused, or the prompt too long): any problem refuses the save.
      if (loadedEngineHasPromptParts() && loadedEngineHasPromptStyles()) {
        const saved = (await readNodaroMotionPromptParts()).promptParts
        const problems: DirectRunPromptProblem[] = []
        for (const engine of NODARO_MOTION_ENGINES) {
          const texts = saved?.[engine]?.motion
          if (!texts) continue
          const found = await directRunPromptProblems(app, req, reply, engine, "motion", texts, parsed.data.motion[engine])
          if (!found) return reply
          problems.push(...found)
        }
        if (problems.length > 0) {
          return directRunPromptPartsInvalid(
            reply,
            problems,
            `The saved Motion engine prompt does not fit this setting: ${problems[0]!.message} Change or reset the Motion engine prompt first.`,
          )
        }
      }
      const before = (await readNodaroMotionMotion()).motion
      await saveNodaroMotionMotion(parsed.data.motion, req.userId!)
      await audit(req, "update_nodaro_motion_motion", "app_setting", NODARO_MOTION_MOTION_AUDIT_TARGET, {
        key: NODARO_MOTION_MOTION_KEY,
        before,
        after: parsed.data.motion,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion Motion setting")
    }
  })
}
