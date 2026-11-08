/**
 * Nodaro Motion's Style choice for direct runs, per engine (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET /v1/admin/nodaro-motion/style   { style, updatedAt, engines, supported } (style null = never saved: people choose)
 *   PUT /v1/admin/nodaro-motion/style   { style }: save the whole setting; audit-logged
 *
 * The setting (`nodaro_motion_style`, lib/nodaro-motion-style.ts) says, per
 * engine, whether people choose a direct run's style (`"user"`, the default)
 * or it is forced. `"flex"` (Always Flex): every direct run and quote of that
 * engine is Flex, whatever the request's `style` says — the API, the SDK and
 * MCP alike. `"precise"` (Precise in Nodaro Motion): clients run Precise, and
 * the engine (from plugin 0.456.0) makes a request that asks for Flex a Flex
 * run. Clients read it through `GET /v1/cast-swap/style-choice` to hide their
 * Style control. A trend run keeps its own trend's style.
 *
 * A save that forces any engine's style is 409 `engine_unsupported` while any
 * environment's engine does not declare `castSwap.styleChoice`
 * (`nodaro-motion-style-gate.ts`: the row is shared by every environment);
 * "Users choose" everywhere is saved whatever the engines, so a forced style
 * can always be taken back. `supported` is whether THIS environment's engine
 * declares it. Each save writes an `admin_actions` row
 * (`update_nodaro_motion_style`) with the setting before and after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION, NODARO_MOTION_ENGINES, NODARO_MOTION_ENGINE_NAMES } from "@nodaro/shared/models"
import { NODARO_MOTION_STYLE_KEY, anyStyleForced, engineTakesStyleChoice, forcedStyles, nodaroMotionStyleSchema, type NodaroMotionStyle } from "../../lib/nodaro-motion-style.js"
import { readNodaroMotionStyle, saveNodaroMotionStyle } from "../../lib/nodaro-motion-style-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import { cannotForceStyleMessage, environmentsThatCannotForceStyle } from "../lib/nodaro-motion-style-gate.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { defineNodaroMotionSettingsSection, sendRefusal } from "../lib/nodaro-motion-settings-section.js"
import { audit } from "./admin-trends-lifecycle.js"
import type { NodaroMotionAdminEngine } from "./admin-nodaro-motion.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Nodaro Motion settings'). */
export const NODARO_MOTION_STYLE_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0f7"

const putBody = z.strictObject({ style: nodaroMotionStyleSchema })

/** The setting as a stored settings set holds it (admin-nodaro-motion-settings-sets.ts): the forced engines only. */
export const NODARO_MOTION_STYLE_SECTION = defineNodaroMotionSettingsSection({
  key: "style",
  path: "/v1/admin/nodaro-motion/style",
  label: "Style choice",
  body: putBody,
  prepare: (body) => ({ value: { style: forcedStyles(body.style) } }),
  // A forced style is saved only once every environment's engine enforces it (the row is shared by every environment).
  engineRefusal: async ({ style }) => {
    if (!anyStyleForced(style)) return null
    const envs = environmentsThatCannotForceStyle(await listEngineEnvironments())
    return envs.length > 0 ? { status: 409, error: { code: "engine_unsupported", message: cannotForceStyleMessage(envs), envs } } : null
  },
  readLive: async () => {
    const { style } = await readNodaroMotionStyle()
    return style === null ? null : { style }
  },
})

export interface NodaroMotionStyleView {
  /** null = never saved: people choose on every engine. Only the forced engines are listed. */
  style: NodaroMotionStyle | null
  updatedAt: string | null
  engines: NodaroMotionAdminEngine[]
  /** Whether this environment's Cast Swap engine enforces the setting (`castSwap.styleChoice`). */
  supported: boolean
}

async function view(): Promise<NodaroMotionStyleView> {
  const { style, updatedAt } = await readNodaroMotionStyle()
  return {
    style,
    updatedAt,
    engines: NODARO_MOTION_ENGINES.map((id) => ({ id, name: NODARO_MOTION_ENGINE_NAMES[id], internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id] })),
    supported: engineTakesStyleChoice(getPluginSupports().castSwap),
  }
}

export function registerNodaroMotionStyleRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/nodaro-motion/style", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion Style choice")
    }
  })

  app.put("/v1/admin/nodaro-motion/style", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = NODARO_MOTION_STYLE_SECTION.body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const prepared = NODARO_MOTION_STYLE_SECTION.prepare(parsed.data)
      if ("refusal" in prepared) return sendRefusal(reply, prepared.refusal)
      const { style } = prepared.value
      const refusal = await NODARO_MOTION_STYLE_SECTION.engineRefusal!(prepared.value, null)
      if (refusal) return sendRefusal(reply, refusal)
      const before = (await readNodaroMotionStyle()).style
      await saveNodaroMotionStyle(style, req.userId!)
      await audit(req, "update_nodaro_motion_style", "app_setting", NODARO_MOTION_STYLE_AUDIT_TARGET, {
        key: NODARO_MOTION_STYLE_KEY,
        before,
        after: style,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion Style choice")
    }
  })
}
