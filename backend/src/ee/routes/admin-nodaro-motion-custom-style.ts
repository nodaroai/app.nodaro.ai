/**
 * Video Remake's custom style (registered by `adminNodaroMotionRoutes`,
 * admin-nodaro-motion.ts, so it shares its edition gate). Admin-only.
 *
 *   GET  /v1/admin/video-remake/custom-style            { customStyle, enabled, enabledByDefault, updatedAt, supported }
 *                                                       (customStyle null = never saved: the deployment's default, the engine's steps)
 *   PUT  /v1/admin/video-remake/custom-style            { customStyle }: save the whole setting; audit-logged
 *   GET  /v1/admin/video-remake/custom-style/defaults   the engine's own answer: each step's default instructions and model,
 *                                                       the limits (null where this environment's engine has none)
 *   POST /v1/admin/video-remake/custom-style/check      { customStyle }: { problems }, the engine's; nothing is saved
 *
 * The setting (`nodaro_motion_custom_style`, lib/nodaro-motion-custom-style.ts)
 * says whether this deployment offers a custom style — the style in the
 * person's own words, in place of a catalog art style, on a direct Nodaro
 * Prism run — and holds the admin's own instructions and model for the
 * engine's two LLM steps (`medium`: reads a run's words and decides the
 * style's medium and tones; `describe`: puts a picture's visual style into
 * words). `enabled` is stored only once an admin chose a value: `enabled` in
 * the view is the resolved answer, `enabledByDefault` what this deployment
 * answers while none is stored (on for Nodaro's own, off under a white-label
 * surface profile).
 *
 * The steps' defaults are the engine's alone, read from it (`POST
 * /v1/cast-swap/custom-style`, internal only, as the admin through
 * `engineRequest`), never kept here. A PUT is refused 400 `validation_error`
 * on the body's shape (strict), and on what this environment's engine says is
 * wrong with a step (`problems`: instructions too long, a model it does not
 * serve), each named at its path. An engine that does not declare
 * `castSwap.customStyle` has no such route: nothing is asked, the switch and
 * the steps save as they are, and nothing reads them there (`supported`
 * false). 502 `engine_error` when the engine answered unexpectedly. Each save
 * writes an `admin_actions` row (`update_nodaro_motion_custom_style`) with the
 * setting before and after.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import {
  CUSTOM_STYLE_STEPS,
  NODARO_MOTION_CUSTOM_STYLE_KEY,
  customStyleEnabled,
  engineTakesCustomStyle,
  nodaroMotionCustomStyleSchema,
  withoutDefaultCustomStyle,
  type NodaroMotionCustomStyle,
} from "../../lib/nodaro-motion-custom-style.js"
import { customStyleOfferedByDefault } from "../../lib/nodaro-motion-custom-style-default.js"
import { readNodaroMotionCustomStyle, saveNodaroMotionCustomStyle } from "../../lib/nodaro-motion-custom-style-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { engineRequest, isRec, parseJson } from "../lib/trends/run-helpers.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { defineNodaroMotionSettingsSection, sendRefusal } from "../lib/nodaro-motion-settings-section.js"
import { audit } from "./admin-trends-lifecycle.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Video Remake settings'). */
export const NODARO_MOTION_CUSTOM_STYLE_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0fe"

/** The engine's custom-style route (internal only). */
const ENGINE_CUSTOM_STYLE_ROUTE = "/v1/cast-swap/custom-style"

/** The path every problem is named under (the editors' `customStyle` object). */
const SETTING_PATH = "customStyle"

const putBody = z.strictObject({ customStyle: nodaroMotionCustomStyleSchema })

/** One problem of a setting, at its path in the PUT's body. */
export interface NodaroMotionCustomStyleProblem {
  path: string
  code: string
  message: string
}

/** The engine's own problems, as its route answers them (paths inside the setting: `medium.instructions`). */
const engineProblemsSchema = z.array(z.object({ path: z.string(), code: z.string(), message: z.string() }))

/**
 * The setting as a stored settings set holds it (admin-nodaro-motion-settings-sets.ts): what an admin set. Saved
 * whatever the engines (one that does not take a custom style never reads the row); its steps are checked by this
 * environment's engine when the set is saved, through the route.
 */
export const NODARO_MOTION_CUSTOM_STYLE_SECTION = defineNodaroMotionSettingsSection({
  key: "custom-style",
  path: "/v1/admin/video-remake/custom-style",
  label: "Custom style",
  body: putBody,
  prepare: (body) => ({ value: { customStyle: withoutDefaultCustomStyle(body.customStyle) } }),
  readLive: async () => {
    const { customStyle } = await readNodaroMotionCustomStyle()
    return customStyle === null ? null : { customStyle }
  },
})

export interface NodaroMotionCustomStyleView {
  /** null = never saved. Only what an admin set is listed. */
  customStyle: NodaroMotionCustomStyle | null
  /** Whether this deployment offers a custom style: the saved choice, else `enabledByDefault`. */
  enabled: boolean
  /** What this deployment answers while no choice is saved: false under a white-label surface profile. */
  enabledByDefault: boolean
  updatedAt: string | null
  /** Whether this environment's Cast Swap engine takes a custom style (`castSwap.customStyle`). */
  supported: boolean
}

async function view(): Promise<NodaroMotionCustomStyleView> {
  const { customStyle, updatedAt } = await readNodaroMotionCustomStyle()
  const enabledByDefault = customStyleOfferedByDefault()
  return {
    customStyle,
    enabled: customStyleEnabled(customStyle, enabledByDefault),
    enabledByDefault,
    updatedAt,
    supported: engineTakesCustomStyle(getPluginSupports().castSwap),
  }
}

function engineError(reply: FastifyReply) {
  return reply.status(502).send({ error: { code: "engine_error", message: "Video Remake answered unexpectedly." } })
}

/**
 * Ask this environment's engine. `absent` = never asked (no
 * `castSwap.customStyle`) or the route is not there (404); `failed` = any
 * other refusal or an answer that is not an object (bare or under `data`).
 */
async function askEngine(
  app: FastifyInstance,
  req: FastifyRequest,
  setting?: NodaroMotionCustomStyle,
): Promise<{ kind: "answer"; answer: Record<string, unknown> } | { kind: "absent" } | { kind: "failed" }> {
  if (!engineTakesCustomStyle(getPluginSupports().castSwap)) return { kind: "absent" }
  // The engine checks the two steps alone; the switch is this platform's.
  const steps = setting ? Object.fromEntries(CUSTOM_STYLE_STEPS.flatMap((name) => (setting[name] ? [[name, setting[name]]] : []))) : undefined
  const res = await engineRequest(app, req, ENGINE_CUSTOM_STYLE_ROUTE, steps ? { setting: steps } : {})
  if (res.statusCode === 404) return { kind: "absent" }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    req.log.warn({ status: res.statusCode }, "cast-swap custom-style: the engine refused")
    return { kind: "failed" }
  }
  const raw = parseJson(res.body)
  const answer = isRec(raw) && isRec(raw.data) ? raw.data : raw
  return isRec(answer) ? { kind: "answer", answer } : { kind: "failed" }
}

/**
 * What this environment's engine says is wrong with the setting's steps, each
 * under `customStyle`: `[]` when nothing is, or when there is no engine to
 * ask; null when it answered unexpectedly.
 */
async function engineProblems(app: FastifyInstance, req: FastifyRequest, setting: NodaroMotionCustomStyle): Promise<NodaroMotionCustomStyleProblem[] | null> {
  const asked = await askEngine(app, req, setting)
  if (asked.kind === "absent") return []
  if (asked.kind === "failed") return null
  const problems = engineProblemsSchema.safeParse(asked.answer.problems ?? [])
  if (!problems.success) return null
  return problems.data.map((p) => ({ path: [SETTING_PATH, p.path].filter(Boolean).join("."), code: p.code, message: p.message }))
}

/** 400 naming each problem of the setting, in `formatZodError`'s message style. */
function settingRefused(reply: FastifyReply, problems: NodaroMotionCustomStyleProblem[]) {
  const first = problems[0]!
  const head = `${first.path}: ${first.message}`
  const message = problems.length > 1 ? `${head} (+${problems.length - 1} more)` : head
  return reply.status(400).send({ error: { code: "validation_error", message, issues: problems } })
}

/** Whether the setting holds a step of the admin's own (the only part an engine checks). */
const hasSteps = (setting: NodaroMotionCustomStyle): boolean => CUSTOM_STYLE_STEPS.some((name) => setting[name] !== undefined)

export function registerNodaroMotionCustomStyleRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/video-remake/custom-style", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Video Remake custom style setting")
    }
  })

  app.put("/v1/admin/video-remake/custom-style", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = NODARO_MOTION_CUSTOM_STYLE_SECTION.body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const prepared = NODARO_MOTION_CUSTOM_STYLE_SECTION.prepare(parsed.data)
      if ("refusal" in prepared) return sendRefusal(reply, prepared.refusal)
      const { customStyle } = prepared.value
      // The steps as this environment's engine checks them; the switch alone asks nothing.
      if (hasSteps(customStyle)) {
        const problems = await engineProblems(app, req, customStyle)
        if (problems === null) return engineError(reply)
        if (problems.length > 0) return settingRefused(reply, problems)
      }
      const before = (await readNodaroMotionCustomStyle()).customStyle
      await saveNodaroMotionCustomStyle(customStyle, req.userId!)
      await audit(req, "update_nodaro_motion_custom_style", "app_setting", NODARO_MOTION_CUSTOM_STYLE_AUDIT_TARGET, {
        key: NODARO_MOTION_CUSTOM_STYLE_KEY,
        before,
        after: customStyle,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Video Remake custom style setting")
    }
  })

  app.get("/v1/admin/video-remake/custom-style/defaults", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const asked = await askEngine(app, req)
      if (asked.kind === "failed") return engineError(reply)
      if (asked.kind === "absent") return { data: null }
      // The engine's answer as it is, without the problems of a setting nobody sent.
      const { problems: _problems, ...defaults } = asked.answer
      return { data: defaults }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Video Remake custom style defaults")
    }
  })

  app.post("/v1/admin/video-remake/custom-style/check", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const problems = await engineProblems(app, req, withoutDefaultCustomStyle(parsed.data.customStyle))
      if (problems === null) return engineError(reply)
      return { data: { problems } }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to check the Video Remake custom style setting")
    }
  })
}
