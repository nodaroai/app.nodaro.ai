/**
 * Nodaro Motion's style-only setting, per engine (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET /v1/admin/nodaro-motion/style-only   { styleOnly, updatedAt, engines, supported } (styleOnly null = never saved: the defaults)
 *   PUT /v1/admin/nodaro-motion/style-only   { styleOnly }: save the whole setting; audit-logged
 *
 * The setting (`nodaro_motion_style_only`, lib/nodaro-motion-style-only.ts)
 * says, per engine, what a DIRECT style-only run does (a Prism Flex run with
 * an art style and nothing to swap): its `path` ("original", the default, or
 * "flex") and its own `enginePrompt` step (absent: the template).
 *
 * A PUT is refused:
 *  - 400 `validation_error`: the body's shape (strict), or an engine prompt the
 *    save-time step rules refuse (`issues`, each path under `styleOnly.`);
 *  - 400 `style_only_engine`: a changed Pulse entry (Pulse takes no art style);
 *  - 409 `engine_unsupported`: a change while NO environment's engine declares
 *    `castSwap.styleOnly` (`nodaro-motion-style-only-gate.ts`: an engine
 *    without it never reads the row, so one reader is enough).
 * The defaults are saved whatever the engines, so a change can always be
 * taken back; they are left out of what is stored. `supported` is whether
 * THIS environment's engine declares it. Each save writes an `admin_actions`
 * row (`update_nodaro_motion_style_only`) with the setting before and after.
 */
import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION, NODARO_MOTION_ENGINES, NODARO_MOTION_ENGINE_NAMES } from "@nodaro/shared/models"
import type { CastSwapStepsProblem } from "../../lib/cast-swap-steps.js"
import {
  NODARO_MOTION_STYLE_ONLY_KEY,
  anyStyleOnlyChange,
  engineTakesStyleOnly,
  nodaroMotionStyleOnlySchema,
  styleOnlyEntryProblems,
  withoutDefaultStyleOnly,
  type NodaroMotionStyleOnly,
} from "../../lib/nodaro-motion-style-only.js"
import { readNodaroMotionStyleOnly, saveNodaroMotionStyleOnly } from "../../lib/nodaro-motion-style-only-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import { NO_ENGINE_RUNS_STYLE_ONLY_MESSAGE, PULSE_RUNS_NO_STYLE_ONLY_MESSAGE, noEnvironmentRunsStyleOnly } from "../lib/nodaro-motion-style-only-gate.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"
import type { NodaroMotionAdminEngine } from "./admin-nodaro-motion.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Nodaro Motion settings'). */
export const NODARO_MOTION_STYLE_ONLY_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0fa"

/** The body key: every refusal's path starts here. */
const BODY_KEY = "styleOnly"

const putBody = z.strictObject({ [BODY_KEY]: nodaroMotionStyleOnlySchema })

export interface NodaroMotionStyleOnlyView {
  /** null = never saved: every engine on the defaults. Only what differs from them is listed. */
  styleOnly: NodaroMotionStyleOnly | null
  updatedAt: string | null
  engines: NodaroMotionAdminEngine[]
  /** Whether this environment's Cast Swap engine runs style-only runs (`castSwap.styleOnly`). */
  supported: boolean
}

async function view(): Promise<NodaroMotionStyleOnlyView> {
  const { styleOnly, updatedAt } = await readNodaroMotionStyleOnly()
  return {
    styleOnly,
    updatedAt,
    engines: NODARO_MOTION_ENGINES.map((id) => ({ id, name: NODARO_MOTION_ENGINE_NAMES[id], internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id] })),
    supported: engineTakesStyleOnly(getPluginSupports().castSwap),
  }
}

/** 400 naming each problem of the setting, in the steps route's shape (`issues`) and `formatZodError`'s message style. */
function problemsRefused(reply: FastifyReply, problems: CastSwapStepsProblem[]) {
  const first = problems[0]
  const head = first ? `${first.path}: ${first.message}` : "Invalid style-only setting"
  const message = problems.length > 1 ? `${head} (+${problems.length - 1} more)` : head
  return reply.status(400).send({ error: { code: "validation_error", message, issues: problems } })
}

export function registerNodaroMotionStyleOnlyRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/nodaro-motion/style-only", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion style-only setting")
    }
  })

  app.put("/v1/admin/nodaro-motion/style-only", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const styleOnly = withoutDefaultStyleOnly(parsed.data[BODY_KEY])
      // Art styles are Prism's: Pulse never gets a style-only run, so a change for it would never be read.
      if (styleOnly["motion-pulse"]) {
        return reply.status(400).send({ error: { code: "style_only_engine", message: PULSE_RUNS_NO_STYLE_ONLY_MESSAGE } })
      }
      // The store validates nothing: the save-time step rules (a known model that can see what it is shown) are applied here.
      const problems = NODARO_MOTION_ENGINES.flatMap((engine) => {
        const entry = styleOnly[engine]
        return entry ? styleOnlyEntryProblems(`${BODY_KEY}.${engine}`, entry) : []
      })
      if (problems.length > 0) return problemsRefused(reply, problems)
      // A change is saved once one environment's engine runs style-only runs (an engine without it never reads the row).
      if (anyStyleOnlyChange(styleOnly) && noEnvironmentRunsStyleOnly(await listEngineEnvironments())) {
        return reply.status(409).send({ error: { code: "engine_unsupported", message: NO_ENGINE_RUNS_STYLE_ONLY_MESSAGE, envs: [] } })
      }
      const before = (await readNodaroMotionStyleOnly()).styleOnly
      await saveNodaroMotionStyleOnly(styleOnly, req.userId!)
      await audit(req, "update_nodaro_motion_style_only", "app_setting", NODARO_MOTION_STYLE_ONLY_AUDIT_TARGET, {
        key: NODARO_MOTION_STYLE_ONLY_KEY,
        before,
        after: styleOnly,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion style-only setting")
    }
  })
}
