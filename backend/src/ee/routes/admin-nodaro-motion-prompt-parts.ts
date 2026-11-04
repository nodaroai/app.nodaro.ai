/**
 * Nodaro Motion's prompt part overrides for direct runs, per engine and style
 * (registered by `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it
 * shares its edition gate). Admin-only.
 *
 *   GET  /v1/admin/nodaro-motion/prompt-parts           the overrides (null = never saved), the engines and the keys (`styles`)
 *   PUT  /v1/admin/nodaro-motion/prompt-parts           { promptParts }: save the whole setting, each entry checked by the engine first; audit-logged
 *   POST /v1/admin/nodaro-motion/prompt-parts/preview   { engine, style, overrides?, promptWording? }: the engine's parts, assembled prompt and problems
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
 * style (`precise` / `motion`); the parts they edit are the prompt style's. `overrides` left out = the saved ones for that engine and style.
 * `promptWording` (`"current"` / `"new"`) is the Flex wording to preview (never
 * applied to `style: "styleOnly"`: the style-only set has no wording), left
 * out = the engine's saved one (`nodaro_motion_prompt_wording`); it is said
 * only for a Flex run worded Flexible, and only to an engine that lists it
 * (`directRunRequest`, `forLoadedEngine`), so a Precise preview is unchanged.
 * Each save's check (below) words a Flex run's overrides as the engine's
 * saved wording does. The
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
 *
 * The style-only key (`styleOnly`, beside `precise` and `motion`): a style-only
 * run's own parts (a direct Prism Flex run with an art style and nothing to
 * swap). The GET lists it in `styles` only while this environment's engine
 * runs style-only runs (`castSwap.styleOnly`); its preview and its check ask
 * the engine for the style-only set (`directRunRequest`: no role, no masking,
 * no wording), and only an engine with the flag (else 503
 * `engine_unsupported`). Pulse takes no art style, so a Pulse `styleOnly`
 * entry or preview is 400 `style_only_engine` (the switch route's refusal). A save that sets or changes a `styleOnly` entry is
 * 409 `engine_unsupported` (`envs`: the environments that cannot) until EVERY
 * environment's engine declares the flag (`environmentsThatCannotRunStyleOnly`):
 * the row is shared, and an app from before the key drops the engine's whole
 * entry when it reads one. A save that leaves every `styleOnly` entry as it is,
 * or removes one, is never held by that rule. Saving one key never alters
 * another: each is checked and stored on its own.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  CAST_SWAP_ENGINE_OF_NODARO_MOTION,
  CAST_SWAP_STYLES,
  NODARO_MOTION_ENGINES,
  NODARO_MOTION_ENGINE_NAMES,
  type NodaroMotionEngine,
} from "@nodaro/shared/models"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { placeholderImageUrl, promptPartEditsSchema, type PromptPartTexts } from "../../lib/cast-swap-prompt-parts-contract.js"
import {
  NODARO_MOTION_PROMPT_PARTS_KEYS,
  type NodaroMotionEnginePromptParts,
  type NodaroMotionPromptParts,
  type NodaroMotionPromptPartsKey,
} from "../../lib/nodaro-motion-prompt-parts.js"
import { readNodaroMotionPromptParts, saveNodaroMotionPromptParts } from "../../lib/nodaro-motion-prompt-parts-store.js"
import { readNodaroMotionMasking } from "../../lib/nodaro-motion-masking-store.js"
import type { NodaroMotionMasking } from "../../lib/nodaro-motion-masking.js"
import type { NodaroMotionMotion } from "../../lib/nodaro-motion-motion.js"
import { readNodaroMotionMotion } from "../../lib/nodaro-motion-motion-store.js"
import { readNodaroMotionSteps } from "../../lib/nodaro-motion-steps-store.js"
import type { NodaroMotionSteps } from "../../lib/nodaro-motion-steps.js"
import { loadedEngineTakesShotList } from "../../lib/cast-swap-steps.js"
import { askPromptParts, nonEmptyTexts } from "../lib/cast-swap-prompt-parts.js"
import {
  directRunPromptPartsInvalid,
  directRunPromptProblems,
  directRunRequest,
  savedFlexWording,
  type DirectRunPromptProblem,
} from "../lib/nodaro-motion-prompt-check.js"
import { promptWordingOf } from "../../lib/nodaro-motion-prompt-wording.js"
import { CAST_SWAP_PROMPT_WORDINGS, type CastSwapPromptWording } from "@nodaro/render-rules"
import { engineTakesStyleOnly } from "../../lib/nodaro-motion-style-only.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import { PULSE_RUNS_NO_STYLE_ONLY_MESSAGE, cannotRunStyleOnlyMessage, environmentsThatCannotRunStyleOnly } from "../lib/nodaro-motion-style-only-gate.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"

/**
 * `admin_actions.target_id` is a NOT NULL uuid, and a deployment-wide setting
 * has no row id of its own: every save of this setting is filed under this
 * fixed id (its own, beside the masking setting's).
 */
export const NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0f2"

const engineId = z.enum(NODARO_MOTION_ENGINES)
const style = z.enum(NODARO_MOTION_PROMPT_PARTS_KEYS)

/** An admin's edit: per engine, per key (a style, or `styleOnly`), the text per part (empty = the default). */
const editsSchema = z.strictObject(
  Object.fromEntries(
    NODARO_MOTION_ENGINES.map((engine) => [
      engine,
      z.strictObject(Object.fromEntries(NODARO_MOTION_PROMPT_PARTS_KEYS.map((s) => [s, promptPartEditsSchema.optional()]))).optional(),
    ]),
  ),
) as unknown as z.ZodType<Partial<Record<NodaroMotionEngine, Partial<Record<NodaroMotionPromptPartsKey, PromptPartTexts>>>>>

const putBody = z.strictObject({ promptParts: editsSchema })
// `promptWording` left out = the engine's saved Flex wording (`nodaro_motion_prompt_wording`).
const previewBody = z.strictObject({
  engine: engineId,
  style,
  overrides: promptPartEditsSchema.optional(),
  promptWording: z.enum(CAST_SWAP_PROMPT_WORDINGS).optional(),
})

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
  s: NodaroMotionPromptPartsKey,
  overrides: PromptPartTexts | undefined,
  motion: NodaroMotionMotion | null,
  masking: NodaroMotionMasking | null,
  steps: NodaroMotionSteps | null,
  wording: CastSwapPromptWording,
) {
  return askPromptParts(
    app,
    req,
    reply,
    directRunRequest(
      engine,
      s,
      motion?.[engine],
      { hasAudio: true, roles: structuredClone(SAMPLE_ROLES), ...(overrides ? { overrides } : {}) },
      masking?.[engine],
      steps?.[engine],
      wording,
    ),
  )
}

/** The steps setting, read only when this environment's engine takes the shot list (the one step a prompt shows). */
async function stepsForShotList(): Promise<NodaroMotionSteps | null> {
  return loadedEngineTakesShotList() ? (await readNodaroMotionSteps()).steps : null
}

/** The edit without empty texts, keys or engines (each left out uses the defaults). */
function savedFrom(edits: z.infer<typeof editsSchema>): NodaroMotionPromptParts {
  const out: NodaroMotionPromptParts = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    const entry: NodaroMotionEnginePromptParts = {}
    for (const s of NODARO_MOTION_PROMPT_PARTS_KEYS) {
      const texts = nonEmptyTexts(edits[engine]?.[s] ?? {})
      if (texts) entry[s] = texts
    }
    if (Object.keys(entry).length > 0) out[engine] = entry
  }
  return out
}

/** Whether this environment's engine runs style-only runs, so its set may be previewed and checked. */
function loadedEngineTakesStyleOnly(): boolean {
  return engineTakesStyleOnly(getPluginSupports().castSwap)
}

/** Reply 503 for a style-only preview or check on an engine without style-only runs (it would answer the plain Flex set). */
function styleOnlyUnsupported(reply: FastifyReply) {
  return reply.status(503).send({
    error: { code: "engine_unsupported", message: "This environment's Cast Swap engine cannot run style-only runs yet, so it cannot show or check their prompt parts." },
  })
}

/** Reply 400 for anything style-only on Pulse (it takes no art style, so the entry would never be read). */
function pulseRunsNoStyleOnly(reply: FastifyReply) {
  return reply.status(400).send({ error: { code: "style_only_engine", message: PULSE_RUNS_NO_STYLE_ONLY_MESSAGE } })
}

/** Whether `a` and `b` hold the same texts (both absent counts as the same). */
function sameTexts(a: PromptPartTexts | undefined, b: PromptPartTexts | undefined): boolean {
  const ka = Object.keys(a ?? {})
  const kb = Object.keys(b ?? {})
  return ka.length === kb.length && ka.every((id) => (a as Record<string, string>)[id] === (b as Record<string, string> | undefined)?.[id])
}

/** Whether `next` sets or changes any engine's `styleOnly` entry over `before` (removing one does not count). */
function setsOrChangesStyleOnly(next: NodaroMotionPromptParts, before: NodaroMotionPromptParts | null): boolean {
  return NODARO_MOTION_ENGINES.some((engine) => {
    const texts = next[engine]?.styleOnly
    return texts !== undefined && !sameTexts(texts, before?.[engine]?.styleOnly)
  })
}

async function view() {
  const { promptParts, updatedAt } = await readNodaroMotionPromptParts()
  return {
    promptParts,
    updatedAt,
    engines: NODARO_MOTION_ENGINES.map((id) => ({ id, name: NODARO_MOTION_ENGINE_NAMES[id], internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id] })),
    styles: loadedEngineTakesStyleOnly() ? [...NODARO_MOTION_PROMPT_PARTS_KEYS] : [...CAST_SWAP_STYLES],
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
      if (s === "styleOnly" && engine === "motion-pulse") return pulseRunsNoStyleOnly(reply)
      if (s === "styleOnly" && !loadedEngineTakesStyleOnly()) return styleOnlyUnsupported(reply)
      const overrides = parsed.data.overrides
        ? nonEmptyTexts(parsed.data.overrides)
        : (await readNodaroMotionPromptParts()).promptParts?.[engine]?.[s]
      const wording = parsed.data.promptWording ?? promptWordingOf(await savedFlexWording(), engine)
      const answer = await preview(
        app,
        req,
        reply,
        engine,
        s,
        overrides,
        (await readNodaroMotionMotion()).motion,
        (await readNodaroMotionMasking()).masking,
        await stepsForShotList(),
        wording,
      )
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
      if (next["motion-pulse"]?.styleOnly) return pulseRunsNoStyleOnly(reply)
      const before = (await readNodaroMotionPromptParts()).promptParts
      // A new or changed style-only entry waits for every environment's engine (an older app drops the entry it holds).
      if (setsOrChangesStyleOnly(next, before)) {
        const envs = environmentsThatCannotRunStyleOnly(await listEngineEnvironments())
        if (envs.length > 0) return reply.status(409).send({ error: { code: "engine_unsupported", message: cannotRunStyleOnlyMessage(envs), envs } })
        if (!loadedEngineTakesStyleOnly()) return styleOnlyUnsupported(reply)
      }
      const problems: DirectRunPromptProblem[] = []
      const motion = (await readNodaroMotionMotion()).motion
      const masking = (await readNodaroMotionMasking()).masking
      const steps = await stepsForShotList()
      // A Flex run's overrides are checked worded as the engine's direct Flex runs are (the new wording is longer).
      const wording = await savedFlexWording()
      for (const engine of NODARO_MOTION_ENGINES) {
        for (const s of NODARO_MOTION_PROMPT_PARTS_KEYS) {
          const texts = next[engine]?.[s]
          if (!texts) continue
          // An unchanged style-only entry on an engine that cannot ask for its set (only reached unchanged): kept as checked when saved.
          if (s === "styleOnly" && !loadedEngineTakesStyleOnly()) continue
          const found = await directRunPromptProblems(
            app,
            req,
            reply,
            engine,
            s,
            texts,
            motion?.[engine],
            masking?.[engine],
            steps?.[engine],
            promptWordingOf(wording, engine),
          )
          if (!found) return reply
          problems.push(...found)
        }
      }
      if (problems.length > 0) return directRunPromptPartsInvalid(reply, problems)
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
