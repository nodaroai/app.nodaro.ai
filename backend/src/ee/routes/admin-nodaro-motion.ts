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
 *   GET/PUT /v1/admin/nodaro-motion/steps, GET …/steps/defaults, POST …/steps/check
 *                                         the direct runs' preparation steps per engine (admin-nodaro-motion-steps.ts)
 *
 * The setting (`nodaro_motion_masking`, lib/nodaro-motion-masking.ts) is how
 * the Cast Swap engine masks faces on every DIRECT run of each engine —
 * people running Nodaro Motion never set it, and a trend run keeps its own
 * trend's setting. Until an admin saves it, no engine masks.
 *
 * A save whose entry hides whole people (faces hidden, target "body") is 409
 * `engine_unsupported` while any environment's engine cannot do it
 * (`nodaro-motion-hide-body.ts`: the row is shared by every environment);
 * so is one whose entry draws the face mesh (`faceMesh: true`) while any
 * environment's engine cannot draw it (`nodaro-motion-face-mesh.ts`).
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
import { readNodaroMotionPromptParts } from "../../lib/nodaro-motion-prompt-parts-store.js"
import { readNodaroMotionMotion } from "../../lib/nodaro-motion-motion-store.js"
import { CAST_SWAP_STYLES } from "@nodaro/shared/models"
import { loadedEngineHasPromptParts } from "../lib/cast-swap-prompt-parts.js"
import { directRunPromptPartsInvalid, directRunPromptProblems, type DirectRunPromptProblem } from "../lib/nodaro-motion-prompt-check.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import { cannotHideBodiesMessage, environmentsThatCannotHideBodies, hidesWholePeople } from "../lib/nodaro-motion-hide-body.js"
import { cannotDrawFaceMeshMessage, drawsFaceMesh, environmentsThatCannotDrawFaceMesh } from "../lib/nodaro-motion-face-mesh.js"
import { audit } from "./admin-trends-lifecycle.js"
import { registerNodaroMotionPromptPartRoutes } from "./admin-nodaro-motion-prompt-parts.js"
import { registerNodaroMotionMotionRoutes } from "./admin-nodaro-motion-motion.js"
import { registerNodaroMotionPulseAudioRoutes } from "./admin-nodaro-motion-pulse-audio.js"
import { registerNodaroMotionPrismReferenceAudioRoutes } from "./admin-nodaro-motion-prism-reference-audio.js"
import { registerNodaroMotionStepsRoutes } from "./admin-nodaro-motion-steps.js"

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
  registerNodaroMotionStepsRoutes(app)
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
      // A whole-person entry, or one that draws the face mesh, is saved only once every environment's
      // engine can do it (the row is shared by every environment).
      const hides = NODARO_MOTION_ENGINES.some((engine) => hidesWholePeople(parsed.data.masking[engine]))
      const meshes = NODARO_MOTION_ENGINES.some((engine) => drawsFaceMesh(parsed.data.masking[engine]))
      if (hides || meshes) {
        const environments = await listEngineEnvironments()
        const bodies = hides ? environmentsThatCannotHideBodies(environments) : []
        if (bodies.length > 0) {
          return reply.status(409).send({ error: { code: "engine_unsupported", message: cannotHideBodiesMessage(bodies), envs: bodies } })
        }
        const mesh = meshes ? environmentsThatCannotDrawFaceMesh(environments) : []
        if (mesh.length > 0) {
          return reply.status(409).send({ error: { code: "engine_unsupported", message: cannotDrawFaceMeshMessage(mesh), envs: mesh } })
        }
      }
      const before = (await readNodaroMotionMasking()).masking
      // An engine whose face mesh turns on adds the mesh's line to its direct runs' prompt: the saved
      // prompt overrides of those runs (Precise, and Motion where it falls back to this masking) are
      // checked again on a large run, and the save is refused when they no longer fit.
      const meshOn = NODARO_MOTION_ENGINES.filter((engine) => drawsFaceMesh(parsed.data.masking[engine]) && !drawsFaceMesh(before?.[engine]))
      if (meshOn.length > 0 && loadedEngineHasPromptParts()) {
        const saved = (await readNodaroMotionPromptParts()).promptParts
        const motion = (await readNodaroMotionMotion()).motion
        const problems: DirectRunPromptProblem[] = []
        for (const engine of meshOn) {
          for (const style of CAST_SWAP_STYLES) {
            const texts = saved?.[engine]?.[style]
            if (!texts) continue
            const found = await directRunPromptProblems(app, req, reply, engine, style, texts, motion?.[engine], parsed.data.masking[engine])
            if (!found) return reply
            problems.push(...found)
          }
        }
        if (problems.length > 0) {
          return directRunPromptPartsInvalid(
            reply,
            problems,
            `With the face mesh on, the saved Nodaro Motion prompt no longer fits: ${problems[0]!.message} Shorten or reset the prompt overrides first.`,
          )
        }
      }
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
