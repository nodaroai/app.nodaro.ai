/**
 * Nodaro Motion's preparation steps for direct runs, per engine, and the
 * engine's defaults and check behind the step editors (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET  /v1/admin/nodaro-motion/steps            { steps, updatedAt, engines } (steps null = never saved: every direct run is today's)
 *   PUT  /v1/admin/nodaro-motion/steps            { steps }: save the whole setting; audit-logged
 *   GET  /v1/admin/nodaro-motion/steps/defaults?engine=<id>
 *                                                 the engine's vocabulary, default texts and layout prompts (null: this engine takes no steps)
 *   POST /v1/admin/nodaro-motion/steps/check      { engine, steps }: { problems }, the platform's and the engine's; nothing is saved
 *
 * The setting (`nodaro_motion_steps`, lib/nodaro-motion-steps.ts) is read by
 * the Cast Swap engine for every DIRECT run of the engine it names; a trend
 * run carries its own trend's `steps`.
 *
 * The PUT checks each entry as a save (`nodaroMotionStepsSaveSchema`: a known
 * model that can see what it is shown); a refusal is 400 `validation_error`
 * with every problem (`issues`: path under `steps`, code, message). Empty
 * entries are dropped. A setting with anything set is 409 `engine_unsupported`
 * while any environment's engine cannot take steps
 * (`nodaro-motion-steps-gate.ts`: the row is shared by every environment);
 * nothing set is saved whatever the engines. Each save writes an
 * `admin_actions` row (`update_nodaro_motion_steps`, before and after).
 *
 * Defaults and check ask this environment's engine (`POST
 * /v1/cast-swap/steps`, internal only, as the admin through `engineRequest`)
 * with the engine's CURRENT public id, whatever form the admin sent. The
 * default texts live in the engine and are only relayed here, never kept. An
 * engine that does not declare `castSwap.steps` is never asked: defaults
 * answers null, check the platform's problems alone; the engine's 404 reads
 * the same. Any other refusal, or an answer outside the contract, is 502
 * `engine_error` with a fixed sentence (never the engine's words).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  CAST_SWAP_ENGINE_IDS_ACCEPTED,
  CAST_SWAP_ENGINE_OF_NODARO_MOTION,
  NODARO_MOTION_ENGINES,
  NODARO_MOTION_ENGINE_NAMES,
  nodaroMotionEngineFrom,
  type NodaroMotionEngine,
} from "@nodaro/shared/models"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { castSwapStepsSaveSchema, loadedEngineTakesSteps, stepsProblems, type CastSwapStepsProblem } from "../../lib/cast-swap-steps.js"
import { NODARO_MOTION_STEPS_KEY, anyStepsSet, nodaroMotionStepsSaveSchema, withoutEmptySteps, type NodaroMotionSteps } from "../../lib/nodaro-motion-steps.js"
import { readNodaroMotionSteps, saveNodaroMotionSteps } from "../../lib/nodaro-motion-steps-store.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import { cannotTakeStepsMessage, environmentsThatCannotTakeSteps } from "../lib/nodaro-motion-steps-gate.js"
import { engineRequest, isRec, parseJson } from "../lib/trends/run-helpers.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"
import type { NodaroMotionAdminEngine } from "./admin-nodaro-motion.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Nodaro Motion settings'). */
export const NODARO_MOTION_STEPS_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0f6"

/** The engine's steps route (internal only). */
const ENGINE_STEPS_ROUTE = "/v1/cast-swap/steps"

/** The path every problem is named under (the editors' `steps` object). */
const STEPS_PATH = "steps"

const putBody = z.strictObject({ steps: z.unknown() })
const engineId = z.enum(CAST_SWAP_ENGINE_IDS_ACCEPTED)
const defaultsQuery = z.object({ engine: engineId })
const checkBody = z.strictObject({ engine: engineId, steps: z.unknown() })

/** The engine's own problems, as its route answers them (paths inside `steps`). */
const engineProblemsSchema = z.array(z.object({ path: z.string(), code: z.string(), message: z.string() }))

export interface NodaroMotionStepsView {
  /** null = never saved: every direct run is today's. An engine left out runs as today. */
  steps: NodaroMotionSteps | null
  updatedAt: string | null
  engines: NodaroMotionAdminEngine[]
}

async function view(): Promise<NodaroMotionStepsView> {
  const { steps, updatedAt } = await readNodaroMotionSteps()
  return {
    steps,
    updatedAt,
    engines: NODARO_MOTION_ENGINES.map((id) => ({ id, name: NODARO_MOTION_ENGINE_NAMES[id], internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id] })),
  }
}

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

/** 400 naming each problem of the setting, in `formatZodError`'s message style. */
function stepsRefused(reply: FastifyReply, problems: CastSwapStepsProblem[]) {
  const first = problems[0]
  const head = first ? `${first.path}: ${first.message}` : "Invalid steps"
  const message = problems.length > 1 ? `${head} (+${problems.length - 1} more)` : head
  return reply.status(400).send({ error: { code: "validation_error", message, issues: problems } })
}

function engineError(reply: FastifyReply) {
  return reply.status(502).send({ error: { code: "engine_error", message: "Nodaro Motion answered unexpectedly." } })
}

/**
 * Ask this environment's engine. `absent` = never asked (no `castSwap.steps`)
 * or the route is not there (404); `failed` = any other refusal or an answer
 * that is not an object (bare or under `data`).
 */
async function askEngine(
  app: FastifyInstance,
  req: FastifyRequest,
  body: { engine: NodaroMotionEngine; steps?: unknown },
): Promise<{ kind: "answer"; answer: Record<string, unknown> } | { kind: "absent" } | { kind: "failed" }> {
  if (!loadedEngineTakesSteps()) return { kind: "absent" }
  const res = await engineRequest(app, req, ENGINE_STEPS_ROUTE, body)
  if (res.statusCode === 404) return { kind: "absent" }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    req.log.warn({ status: res.statusCode }, "cast-swap steps: the engine refused")
    return { kind: "failed" }
  }
  const raw = parseJson(res.body)
  const answer = isRec(raw) && isRec(raw.data) ? raw.data : raw
  return isRec(answer) ? { kind: "answer", answer } : { kind: "failed" }
}

/** The platform's problems, then the engine's not already among them (same path and code), each under `steps`. */
function mergedProblems(platform: CastSwapStepsProblem[], fromEngine: CastSwapStepsProblem[]): CastSwapStepsProblem[] {
  const seen = new Set(platform.map((p) => `${p.path}\u0000${p.code}`))
  const out = [...platform]
  for (const p of fromEngine) {
    const path = [STEPS_PATH, p.path].filter(Boolean).join(".")
    const key = `${path}\u0000${p.code}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ path, code: p.code, message: p.message })
  }
  return out
}

export function registerNodaroMotionStepsRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/nodaro-motion/steps", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion steps")
    }
  })

  app.put("/v1/admin/nodaro-motion/steps", { preHandler: requireAdmin }, async (req, reply) => {
    const envelope = putBody.safeParse(req.body)
    if (!envelope.success) return badRequest(reply, envelope.error)
    const parsed = nodaroMotionStepsSaveSchema.safeParse(envelope.data.steps)
    if (!parsed.success) return stepsRefused(reply, stepsProblems(parsed.error, STEPS_PATH))
    try {
      const steps = withoutEmptySteps(parsed.data)
      // Anything set is saved only once every environment's engine takes steps (the row is shared by every environment).
      if (anyStepsSet(steps)) {
        const envs = environmentsThatCannotTakeSteps(await listEngineEnvironments())
        if (envs.length > 0) {
          return reply.status(409).send({ error: { code: "engine_unsupported", message: cannotTakeStepsMessage(envs), envs } })
        }
      }
      const before = (await readNodaroMotionSteps()).steps
      await saveNodaroMotionSteps(steps, req.userId!)
      await audit(req, "update_nodaro_motion_steps", "app_setting", NODARO_MOTION_STEPS_AUDIT_TARGET, {
        key: NODARO_MOTION_STEPS_KEY,
        before,
        after: steps,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion steps")
    }
  })

  app.get("/v1/admin/nodaro-motion/steps/defaults", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = defaultsQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      const engine = nodaroMotionEngineFrom(parsed.data.engine)!
      const asked = await askEngine(app, req, { engine })
      if (asked.kind === "failed") return engineError(reply)
      return { data: asked.kind === "answer" ? asked.answer : null }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion step defaults")
    }
  })

  app.post("/v1/admin/nodaro-motion/steps/check", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = checkBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      const { steps } = parsed.data
      const own = castSwapStepsSaveSchema.safeParse(steps)
      const platform = own.success ? [] : stepsProblems(own.error, STEPS_PATH)
      const engine = nodaroMotionEngineFrom(parsed.data.engine)!
      const asked = await askEngine(app, req, { engine, steps })
      if (asked.kind === "failed") return engineError(reply)
      let fromEngine: CastSwapStepsProblem[] = []
      if (asked.kind === "answer") {
        const problems = engineProblemsSchema.safeParse(asked.answer.problems)
        if (!problems.success) return engineError(reply)
        fromEngine = problems.data
      }
      return { data: { problems: mergedProblems(platform, fromEngine) } }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to check the Nodaro Motion steps")
    }
  })
}
