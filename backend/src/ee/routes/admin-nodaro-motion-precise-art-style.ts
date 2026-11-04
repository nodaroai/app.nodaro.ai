/**
 * Nodaro Motion's setting for a Precise run with an art style, per engine
 * (registered by `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it
 * shares its edition gate). Admin-only.
 *
 *   GET /v1/admin/nodaro-motion/precise-art-style   { preciseArtStyle, updatedAt, engines, supported } (preciseArtStyle null = never saved: the default)
 *   PUT /v1/admin/nodaro-motion/precise-art-style   { preciseArtStyle }: save the whole setting; audit-logged
 *
 * The setting (`nodaro_motion_precise_art_style`,
 * lib/nodaro-motion-precise-art-style.ts) says, per engine, how a DIRECT
 * Precise run that carries an art style opens its prompt: its `opener`
 * ("restyle", the default, or "edit", the Precise opener of before), and its
 * own "Style the role pictures" (`styleRefs`, `{ mode, send?, prompt? }`; Off
 * by default, never the per-engine steps' switch, which is the Flex runs').
 *
 * A PUT is refused:
 *  - 400 `validation_error`: the body's shape (strict: an unknown engine, key
 *    or opener), or a style-refs instruction the save-time step rules refuse
 *    (`issues`, each path under `preciseArtStyle.`);
 *  - 400 `precise_art_style_engine`: any Pulse entry left after the default
 *    (Pulse takes no art style);
 *  - 409 `engine_unsupported`: a change while NO environment's engine declares
 *    `castSwap.preciseArtStyle` (`nodaro-motion-precise-art-style-gate.ts`: an
 *    engine without it never reads the row, so one reader is enough). A change
 *    is the opener "edit" or the style-refs step On.
 * The defaults (Restyle, the step Off) are saved whatever the engines, so a
 * change can always be taken back. `supported` is whether THIS
 * environment's engine declares it. Each save writes an `admin_actions` row
 * (`update_nodaro_motion_precise_art_style`) with the setting before and after.
 */
import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION, NODARO_MOTION_ENGINES, NODARO_MOTION_ENGINE_NAMES } from "@nodaro/shared/models"
import {
  NODARO_MOTION_PRECISE_ART_STYLE_KEY,
  anyPreciseArtStyleChange,
  engineTakesPreciseArtStyle,
  nodaroMotionPreciseArtStyleSchema,
  preciseArtStyleEntryProblems,
  withoutDefaultPreciseArtStyle,
  type NodaroMotionPreciseArtStyle,
} from "../../lib/nodaro-motion-precise-art-style.js"
import { readNodaroMotionPreciseArtStyle, saveNodaroMotionPreciseArtStyle } from "../../lib/nodaro-motion-precise-art-style-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import {
  NO_ENGINE_RUNS_PRECISE_ART_STYLE_MESSAGE,
  PULSE_TAKES_NO_PRECISE_ART_STYLE_MESSAGE,
  noEnvironmentRunsPreciseArtStyle,
} from "../lib/nodaro-motion-precise-art-style-gate.js"
import type { CastSwapStepsProblem } from "../../lib/cast-swap-steps.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"
import type { NodaroMotionAdminEngine } from "./admin-nodaro-motion.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Nodaro Motion settings'). */
export const NODARO_MOTION_PRECISE_ART_STYLE_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0fb"

/** The body key: every refusal's path starts here. */
const BODY_KEY = "preciseArtStyle"

const putBody = z.strictObject({ [BODY_KEY]: nodaroMotionPreciseArtStyleSchema })

/** 400 naming each problem of the setting, in the steps route's shape (`issues`) and `formatZodError`'s message style. */
function problemsRefused(reply: FastifyReply, problems: CastSwapStepsProblem[]) {
  const first = problems[0]
  const head = first ? `${first.path}: ${first.message}` : "Invalid Precise art-style setting"
  const message = problems.length > 1 ? `${head} (+${problems.length - 1} more)` : head
  return reply.status(400).send({ error: { code: "validation_error", message, issues: problems } })
}

export interface NodaroMotionPreciseArtStyleView {
  /** null = never saved: every engine on the default. Only what differs from it is listed. */
  preciseArtStyle: NodaroMotionPreciseArtStyle | null
  updatedAt: string | null
  engines: NodaroMotionAdminEngine[]
  /** Whether this environment's Cast Swap engine takes an art style on a Precise run (`castSwap.preciseArtStyle`). */
  supported: boolean
}

async function view(): Promise<NodaroMotionPreciseArtStyleView> {
  const { preciseArtStyle, updatedAt } = await readNodaroMotionPreciseArtStyle()
  return {
    preciseArtStyle,
    updatedAt,
    engines: NODARO_MOTION_ENGINES.map((id) => ({ id, name: NODARO_MOTION_ENGINE_NAMES[id], internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id] })),
    supported: engineTakesPreciseArtStyle(getPluginSupports().castSwap),
  }
}

export function registerNodaroMotionPreciseArtStyleRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/nodaro-motion/precise-art-style", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion Precise art-style setting")
    }
  })

  app.put("/v1/admin/nodaro-motion/precise-art-style", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const preciseArtStyle = withoutDefaultPreciseArtStyle(parsed.data[BODY_KEY])
      // Art styles are Prism's: a Pulse entry would never be read.
      if (preciseArtStyle["motion-pulse"]) {
        return reply.status(400).send({ error: { code: "precise_art_style_engine", message: PULSE_TAKES_NO_PRECISE_ART_STYLE_MESSAGE } })
      }
      // The store validates nothing: the save-time step rules (the style-refs instruction's) are applied here.
      const problems = NODARO_MOTION_ENGINES.flatMap((engine) => {
        const entry = preciseArtStyle[engine]
        return entry ? preciseArtStyleEntryProblems(`${BODY_KEY}.${engine}`, entry) : []
      })
      if (problems.length > 0) return problemsRefused(reply, problems)
      // A change is saved once one environment's engine takes an art style on a Precise run (an engine without it never reads the row).
      if (anyPreciseArtStyleChange(preciseArtStyle) && noEnvironmentRunsPreciseArtStyle(await listEngineEnvironments())) {
        return reply.status(409).send({ error: { code: "engine_unsupported", message: NO_ENGINE_RUNS_PRECISE_ART_STYLE_MESSAGE, envs: [] } })
      }
      const before = (await readNodaroMotionPreciseArtStyle()).preciseArtStyle
      await saveNodaroMotionPreciseArtStyle(preciseArtStyle, req.userId!)
      await audit(req, "update_nodaro_motion_precise_art_style", "app_setting", NODARO_MOTION_PRECISE_ART_STYLE_AUDIT_TARGET, {
        key: NODARO_MOTION_PRECISE_ART_STYLE_KEY,
        before,
        after: preciseArtStyle,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion Precise art-style setting")
    }
  })
}
