/**
 * Nodaro Motion's prompt part overrides for direct runs, per engine and style
 * (registered by `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it
 * shares its edition gate). Admin-only.
 *
 *   GET  /v1/admin/nodaro-motion/prompt-parts           the overrides (null = never saved), the engines and the styles
 *   PUT  /v1/admin/nodaro-motion/prompt-parts           { promptParts }: save the whole setting, each entry checked by the engine first; audit-logged
 *   POST /v1/admin/nodaro-motion/prompt-parts/preview   { engine, style, overrides? }: the engine's parts, assembled prompt and problems
 *
 * The setting (`nodaro_motion_prompt_parts`, lib/nodaro-motion-prompt-parts.ts)
 * is read by the Cast Swap engine for every DIRECT run of the engine and style
 * it names; a trend run keeps its own trend's overrides.
 *
 * The preview asks this environment's engine (`POST /v1/cast-swap/prompt-parts`,
 * internal only, as the admin) with a sample run: one person role with three
 * placeholder pictures, a clip with sound, the engine's internal id and the
 * style, with the prompt style and clip preparation a direct run of that
 * style uses (`directRunPromptShape`: Precise — the Precise prompt on a face
 * mask; Motion — the SAVED Motion setting, `nodaro_motion_motion`, left out =
 * the Flexible prompt on a face mask) — only to an engine that declares
 * `castSwap.promptStyles`; an older one is asked exactly as before (no
 * `source`, no prompt style). The overrides stay keyed by the run's
 * style (`precise` / `motion`); the parts they edit are the prompt style's. `overrides` left out = the saved ones for that engine and style. The
 * engine's answer is relayed as it is; an engine without the route is 503
 * `engine_unsupported`.
 *
 * The PUT takes the overrides as text (empty = the default, dropped; `"-"`
 * removes the part). Every engine and style with overrides is checked on a
 * large direct run, not the sample (`directRunPromptProblems`,
 * ee/lib/nodaro-motion-prompt-check.ts: every role, picture and fixed
 * reference the run takes, and room for the user's pre and post prompts, in
 * the saved Motion setting's shape); any problem in any of them is 422 `prompt_parts_invalid`
 * with every problem, each naming its `engine` and `style`, and nothing is
 * saved. Each save writes
 * an `admin_actions` row (`update_nodaro_motion_prompt_parts`, before and after).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  CAST_SWAP_ENGINE_OF_NODARO_MOTION,
  CAST_SWAP_STYLES,
  NODARO_MOTION_ENGINES,
  NODARO_MOTION_ENGINE_NAMES,
  type CastSwapStyle,
  type NodaroMotionEngine,
} from "@nodaro/shared/models"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { placeholderImageUrl, promptPartEditsSchema, type PromptPartTexts } from "../../lib/cast-swap-prompt-parts-contract.js"
import type { NodaroMotionEnginePromptParts, NodaroMotionPromptParts } from "../../lib/nodaro-motion-prompt-parts.js"
import { readNodaroMotionPromptParts, saveNodaroMotionPromptParts } from "../../lib/nodaro-motion-prompt-parts-store.js"
import type { NodaroMotionMotion } from "../../lib/nodaro-motion-motion.js"
import { readNodaroMotionMotion } from "../../lib/nodaro-motion-motion-store.js"
import { askPromptParts, nonEmptyTexts } from "../lib/cast-swap-prompt-parts.js"
import { directRunPromptPartsInvalid, directRunPromptProblems, directRunRequest, type DirectRunPromptProblem } from "../lib/nodaro-motion-prompt-check.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"

/**
 * `admin_actions.target_id` is a NOT NULL uuid, and a deployment-wide setting
 * has no row id of its own: every save of this setting is filed under this
 * fixed id (its own, beside the masking setting's).
 */
export const NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0f2"

const engineId = z.enum(NODARO_MOTION_ENGINES)
const style = z.enum(CAST_SWAP_STYLES)

/** An admin's edit: per engine, per style, the text per part (empty = the default). */
const editsSchema = z.strictObject(
  Object.fromEntries(
    NODARO_MOTION_ENGINES.map((engine) => [
      engine,
      z.strictObject(Object.fromEntries(CAST_SWAP_STYLES.map((s) => [s, promptPartEditsSchema.optional()]))).optional(),
    ]),
  ),
) as unknown as z.ZodType<Partial<Record<NodaroMotionEngine, Partial<Record<CastSwapStyle, PromptPartTexts>>>>>

const putBody = z.strictObject({ promptParts: editsSchema })
const previewBody = z.strictObject({ engine: engineId, style, overrides: promptPartEditsSchema.optional() })

/** A sample direct run: one person with three pictures, each its own address. */
const SAMPLE_ROLES = [
  { kind: "person", name: "the person", images: [1, 2, 3].map((j) => placeholderImageUrl(1, j)), body: "new", outfit: "new", hair: "new" },
]

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

function preview(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  engine: NodaroMotionEngine,
  s: CastSwapStyle,
  overrides: PromptPartTexts | undefined,
  motion: NodaroMotionMotion | null,
) {
  return askPromptParts(
    app,
    req,
    reply,
    directRunRequest(engine, s, motion?.[engine], { hasAudio: true, roles: structuredClone(SAMPLE_ROLES), ...(overrides ? { overrides } : {}) }),
  )
}

/** The edit without empty texts, styles or engines (each left out uses the defaults). */
function savedFrom(edits: z.infer<typeof editsSchema>): NodaroMotionPromptParts {
  const out: NodaroMotionPromptParts = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    const entry: NodaroMotionEnginePromptParts = {}
    for (const s of CAST_SWAP_STYLES) {
      const texts = nonEmptyTexts(edits[engine]?.[s] ?? {})
      if (texts) entry[s] = texts
    }
    if (Object.keys(entry).length > 0) out[engine] = entry
  }
  return out
}

async function view() {
  const { promptParts, updatedAt } = await readNodaroMotionPromptParts()
  return {
    promptParts,
    updatedAt,
    engines: NODARO_MOTION_ENGINES.map((id) => ({ id, name: NODARO_MOTION_ENGINE_NAMES[id], internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id] })),
    styles: [...CAST_SWAP_STYLES],
  }
}

export function registerNodaroMotionPromptPartRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/nodaro-motion/prompt-parts", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion prompt parts")
    }
  })

  app.post("/v1/admin/nodaro-motion/prompt-parts/preview", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = previewBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      const { engine, style: s } = parsed.data
      const overrides = parsed.data.overrides
        ? nonEmptyTexts(parsed.data.overrides)
        : (await readNodaroMotionPromptParts()).promptParts?.[engine]?.[s]
      const answer = await preview(app, req, reply, engine, s, overrides, (await readNodaroMotionMotion()).motion)
      if (!answer) return reply
      return { data: answer }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to preview the Nodaro Motion prompt")
    }
  })

  app.put("/v1/admin/nodaro-motion/prompt-parts", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      const next = savedFrom(parsed.data.promptParts)
      const problems: DirectRunPromptProblem[] = []
      const motion = (await readNodaroMotionMotion()).motion
      for (const engine of NODARO_MOTION_ENGINES) {
        for (const s of CAST_SWAP_STYLES) {
          const texts = next[engine]?.[s]
          if (!texts) continue
          const found = await directRunPromptProblems(app, req, reply, engine, s, texts, motion?.[engine])
          if (!found) return reply
          problems.push(...found)
        }
      }
      if (problems.length > 0) return directRunPromptPartsInvalid(reply, problems)
      const before = (await readNodaroMotionPromptParts()).promptParts
      await saveNodaroMotionPromptParts(next, req.userId!)
      await audit(req, "update_nodaro_motion_prompt_parts", "app_setting", NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET, {
        key: "nodaro_motion_prompt_parts",
        before,
        after: next,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion prompt parts")
    }
  })
}
