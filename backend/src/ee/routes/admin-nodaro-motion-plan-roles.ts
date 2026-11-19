/**
 * Video Remake's roles planned from the prompt (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET  /v1/admin/video-remake/plan-roles            { planRoles, enabled, enabledByDefault, updatedAt, supported }
 *                                                     (planRoles null = never saved: the deployment's default, the engine's step)
 *   PUT  /v1/admin/video-remake/plan-roles            { planRoles }: save the whole setting; audit-logged
 *   GET  /v1/admin/video-remake/plan-roles/defaults   the engine's own answer: the step's default instructions and model,
 *                                                     the instructions' template and the limits (null where this
 *                                                     environment's engine plans no roles)
 *   POST /v1/admin/video-remake/plan-roles/check      { planRoles }: { problems }, the engine's; nothing is saved
 *
 * The setting (`nodaro_motion_plan_roles`, lib/nodaro-motion-plan-roles.ts)
 * says whether this deployment offers roles planned from the prompt — a
 * person's request in their own words and their loose reference images, turned
 * into a run's roles before anything runs — and holds the admin's own
 * instructions and model for the engine's planning step (`plan`). `enabled` is
 * stored only once an admin chose a value: `enabled` in the view is the
 * resolved answer, `enabledByDefault` what this deployment answers while none
 * is stored (on for Nodaro's own, off under a white-label surface profile).
 *
 * The step's defaults are the engine's alone, read from it (`POST
 * /v1/cast-swap/plan-roles-setting`, internal only, as the admin through
 * `engineRequest`), never kept here. A PUT is refused 400 `validation_error`
 * on the body's shape (strict), and on what this environment's engine says is
 * wrong with the step (`problems`: instructions too long, a model it does not
 * serve), each named at its path. An engine that does not declare
 * `castSwap.planRoles` has no such route: nothing is asked, the switch and the
 * step save as they are, and nothing reads them there (`supported` false).
 * 502 `engine_error` when the engine answered unexpectedly. Each save writes
 * an `admin_actions` row (`update_nodaro_motion_plan_roles`) with the setting
 * before and after.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import {
  NODARO_MOTION_PLAN_ROLES_KEY,
  engineTakesPlanRoles,
  nodaroMotionPlanRolesSchema,
  planRolesEnabled,
  withoutDefaultPlanRoles,
  type NodaroMotionPlanRoles,
} from "../../lib/nodaro-motion-plan-roles.js"
import { planRolesOfferedByDefault } from "../../lib/nodaro-motion-plan-roles-default.js"
import { readNodaroMotionPlanRoles, saveNodaroMotionPlanRoles } from "../../lib/nodaro-motion-plan-roles-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { engineRequest, isRec, parseJson } from "../lib/trends/run-helpers.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { defineNodaroMotionSettingsSection, sendRefusal } from "../lib/nodaro-motion-settings-section.js"
import { audit } from "./admin-trends-lifecycle.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Video Remake settings'). */
export const NODARO_MOTION_PLAN_ROLES_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0ff"

/** The engine's plan-roles setting route (internal only). */
const ENGINE_PLAN_ROLES_SETTING_ROUTE = "/v1/cast-swap/plan-roles-setting"

/** The path every problem is named under (the editor's `planRoles` object). */
const SETTING_PATH = "planRoles"

const putBody = z.strictObject({ planRoles: nodaroMotionPlanRolesSchema })

/** One problem of a setting, at its path in the PUT's body. */
export interface NodaroMotionPlanRolesProblem {
  path: string
  code: string
  message: string
}

/** The engine's own problems, as its route answers them (paths inside the setting: `plan.instructions`). */
const engineProblemsSchema = z.array(z.object({ path: z.string(), code: z.string(), message: z.string() }))

/**
 * The setting as a stored settings set holds it (admin-nodaro-motion-settings-sets.ts): what an admin set. Saved
 * whatever the engines (one that plans no roles never reads the row); its step is checked by this environment's
 * engine when the set is saved, through the route.
 */
export const NODARO_MOTION_PLAN_ROLES_SECTION = defineNodaroMotionSettingsSection({
  key: "plan-roles",
  path: "/v1/admin/video-remake/plan-roles",
  label: "Roles from the prompt",
  body: putBody,
  prepare: (body) => ({ value: { planRoles: withoutDefaultPlanRoles(body.planRoles) } }),
  readLive: async () => {
    const { planRoles } = await readNodaroMotionPlanRoles()
    return planRoles === null ? null : { planRoles }
  },
})

export interface NodaroMotionPlanRolesView {
  /** null = never saved. Only what an admin set is listed. */
  planRoles: NodaroMotionPlanRoles | null
  /** Whether this deployment offers roles planned from the prompt: the saved choice, else `enabledByDefault`. */
  enabled: boolean
  /** What this deployment answers while no choice is saved: false under a white-label surface profile. */
  enabledByDefault: boolean
  updatedAt: string | null
  /** Whether this environment's Cast Swap engine plans roles from the prompt (`castSwap.planRoles`). */
  supported: boolean
}

async function view(): Promise<NodaroMotionPlanRolesView> {
  const { planRoles, updatedAt } = await readNodaroMotionPlanRoles()
  const enabledByDefault = planRolesOfferedByDefault()
  return {
    planRoles,
    enabled: planRolesEnabled(planRoles, enabledByDefault),
    enabledByDefault,
    updatedAt,
    supported: engineTakesPlanRoles(getPluginSupports().castSwap),
  }
}

function engineError(reply: FastifyReply) {
  return reply.status(502).send({ error: { code: "engine_error", message: "Video Remake answered unexpectedly." } })
}

/**
 * Ask this environment's engine. `absent` = never asked (no
 * `castSwap.planRoles`) or the route is not there (404); `failed` = any other
 * refusal or an answer that is not an object (bare or under `data`).
 */
async function askEngine(
  app: FastifyInstance,
  req: FastifyRequest,
  setting?: NodaroMotionPlanRoles,
): Promise<{ kind: "answer"; answer: Record<string, unknown> } | { kind: "absent" } | { kind: "failed" }> {
  if (!engineTakesPlanRoles(getPluginSupports().castSwap)) return { kind: "absent" }
  // The engine checks the step alone; the switch is this platform's.
  const res = await engineRequest(app, req, ENGINE_PLAN_ROLES_SETTING_ROUTE, setting?.plan ? { setting: { plan: setting.plan } } : {})
  if (res.statusCode === 404) return { kind: "absent" }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    req.log.warn({ status: res.statusCode }, "cast-swap plan-roles-setting: the engine refused")
    return { kind: "failed" }
  }
  const raw = parseJson(res.body)
  const answer = isRec(raw) && isRec(raw.data) ? raw.data : raw
  return isRec(answer) ? { kind: "answer", answer } : { kind: "failed" }
}

/**
 * What this environment's engine says is wrong with the setting's step, each
 * under `planRoles` (the engine already names them inside the setting,
 * `plan.model`): `[]` when nothing is, or when there is no engine to ask; null
 * when it answered unexpectedly.
 */
async function engineProblems(app: FastifyInstance, req: FastifyRequest, setting: NodaroMotionPlanRoles): Promise<NodaroMotionPlanRolesProblem[] | null> {
  const asked = await askEngine(app, req, setting)
  if (asked.kind === "absent") return []
  if (asked.kind === "failed") return null
  const problems = engineProblemsSchema.safeParse(asked.answer.problems ?? [])
  if (!problems.success) return null
  return problems.data.map((p) => ({ path: [SETTING_PATH, p.path].filter(Boolean).join("."), code: p.code, message: p.message }))
}

/** 400 naming each problem of the setting, in `formatZodError`'s message style. */
function settingRefused(reply: FastifyReply, problems: NodaroMotionPlanRolesProblem[]) {
  const first = problems[0]!
  const head = `${first.path}: ${first.message}`
  const message = problems.length > 1 ? `${head} (+${problems.length - 1} more)` : head
  return reply.status(400).send({ error: { code: "validation_error", message, issues: problems } })
}

export function registerNodaroMotionPlanRolesRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/video-remake/plan-roles", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Video Remake plan-roles setting")
    }
  })

  app.put("/v1/admin/video-remake/plan-roles", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = NODARO_MOTION_PLAN_ROLES_SECTION.body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const prepared = NODARO_MOTION_PLAN_ROLES_SECTION.prepare(parsed.data)
      if ("refusal" in prepared) return sendRefusal(reply, prepared.refusal)
      const { planRoles } = prepared.value
      // The step as this environment's engine checks it; the switch alone asks nothing.
      if (planRoles.plan !== undefined) {
        const problems = await engineProblems(app, req, planRoles)
        if (problems === null) return engineError(reply)
        if (problems.length > 0) return settingRefused(reply, problems)
      }
      const before = (await readNodaroMotionPlanRoles()).planRoles
      await saveNodaroMotionPlanRoles(planRoles, req.userId!)
      await audit(req, "update_nodaro_motion_plan_roles", "app_setting", NODARO_MOTION_PLAN_ROLES_AUDIT_TARGET, {
        key: NODARO_MOTION_PLAN_ROLES_KEY,
        before,
        after: planRoles,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Video Remake plan-roles setting")
    }
  })

  app.get("/v1/admin/video-remake/plan-roles/defaults", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const asked = await askEngine(app, req)
      if (asked.kind === "failed") return engineError(reply)
      if (asked.kind === "absent") return { data: null }
      // The engine's answer as it is, without the problems of a setting nobody sent.
      const { problems: _problems, ...defaults } = asked.answer
      return { data: defaults }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Video Remake plan-roles defaults")
    }
  })

  app.post("/v1/admin/video-remake/plan-roles/check", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const problems = await engineProblems(app, req, withoutDefaultPlanRoles(parsed.data.planRoles))
      if (problems === null) return engineError(reply)
      return { data: { problems } }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to check the Video Remake plan-roles setting")
    }
  })
}
