/**
 * Video Remake's Offer Flash, per engine (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET /v1/admin/video-remake/flash-offer   { flashOffer, updatedAt, engines, supported, environments } (flashOffer null = never saved: off everywhere)
 *   PUT /v1/admin/video-remake/flash-offer   { flashOffer }: save the whole setting; audit-logged
 *
 * The setting (`nodaro_motion_flash_offer`, lib/nodaro-motion-flash-offer.ts)
 * says, per engine, whether EVERY user may pick that engine's Flash choice
 * (Nodaro Prism Flash, Nodaro Pulse Flash) at its own price: `"off"` (the default, on every
 * deployment) or `"on"`.
 *
 * A save that turns any engine on is 409 `engine_unsupported` while NO
 * environment's engine declares `castSwap.flashChoices`
 * (`nodaro-motion-flash-offer-gate.ts`); off everywhere is saved whatever the
 * engines, so it can always be taken back. `supported` is whether THIS
 * environment's engine runs the choices; `environments` names every
 * environment whose engine does (the row is shared, so "on" offers Flash to
 * every user of each of them). Each save writes an `admin_actions` row
 * (`update_nodaro_motion_flash_offer`) with the setting before and after.
 *
 * It IS a section of the stored settings sets (`NODARO_MOTION_FLASH_OFFER_SECTION`, decided 2026-11-22): a set saves,
 * loads, exports and imports it, and loading one that turns an engine on is held to this PUT's own rules (the same
 * `body`, `prepare` and `engineRefusal`, so 409 `engine_unsupported` while no environment's engine runs the choices).
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION, NODARO_MOTION_ENGINES, NODARO_MOTION_ENGINE_NAMES, VIDEO_REMAKE_FLASH_ENGINE_NAMES, videoRemakeFlashEngineOf } from "@nodaro/shared/models"
import {
  NODARO_MOTION_FLASH_OFFER_KEY,
  anyFlashOfferOn,
  engineTakesFlashChoices,
  flashOffersOn,
  nodaroMotionFlashOfferSchema,
  type NodaroMotionFlashOffer,
} from "../../lib/nodaro-motion-flash-offer.js"
import { readNodaroMotionFlashOffer, saveNodaroMotionFlashOffer } from "../../lib/nodaro-motion-flash-offer-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import { NO_ENGINE_RUNS_FLASH_CHOICES_MESSAGE, environmentsThatRunFlashChoices, noEnvironmentRunsFlashChoices } from "../lib/nodaro-motion-flash-offer-gate.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { defineNodaroMotionSettingsSection, sendRefusal } from "../lib/nodaro-motion-settings-section.js"
import { audit } from "./admin-trends-lifecycle.js"
import type { NodaroMotionAdminEngine } from "./admin-nodaro-motion.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Video Remake settings'). */
export const NODARO_MOTION_FLASH_OFFER_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a105"

const putBody = z.strictObject({ flashOffer: nodaroMotionFlashOfferSchema })

/** The setting as a stored settings set holds it (admin-nodaro-motion-settings-sets.ts): as it is stored (`flashOffersOn`). */
export const NODARO_MOTION_FLASH_OFFER_SECTION = defineNodaroMotionSettingsSection({
  key: "flash-offer",
  path: "/v1/admin/video-remake/flash-offer",
  label: "Offer Flash",
  body: putBody,
  prepare: (body) => ({ value: { flashOffer: flashOffersOn(body.flashOffer) } }),
  // "On" is saved once some environment's engine runs the Flash choices (only such an engine takes one); off always.
  engineRefusal: async ({ flashOffer }) =>
    anyFlashOfferOn(flashOffer) && noEnvironmentRunsFlashChoices(await listEngineEnvironments())
      ? { status: 409, error: { code: "engine_unsupported", message: NO_ENGINE_RUNS_FLASH_CHOICES_MESSAGE } }
      : null,
  readLive: async () => {
    const { flashOffer } = await readNodaroMotionFlashOffer()
    return flashOffer === null ? null : { flashOffer }
  },
})

export interface NodaroMotionFlashOfferView {
  /** null = never saved: off for every engine. Only the engines that are on are listed. */
  flashOffer: NodaroMotionFlashOffer | null
  updatedAt: string | null
  /** Each engine, with the name of its Flash choice. */
  engines: Array<NodaroMotionAdminEngine & { flashName: string }>
  /** Whether this environment's Cast Swap engine runs the Flash choices (`castSwap.flashChoices`). */
  supported: boolean
  /** Every environment whose engine reads the row: where "on" offers Flash to every user. */
  environments: string[]
}

async function view(): Promise<NodaroMotionFlashOfferView> {
  const [{ flashOffer, updatedAt }, environments] = await Promise.all([readNodaroMotionFlashOffer(), listEngineEnvironments()])
  return {
    flashOffer,
    updatedAt,
    engines: NODARO_MOTION_ENGINES.map((id) => ({
      id,
      name: NODARO_MOTION_ENGINE_NAMES[id],
      internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id],
      flashName: VIDEO_REMAKE_FLASH_ENGINE_NAMES[videoRemakeFlashEngineOf(id)],
    })),
    supported: engineTakesFlashChoices(getPluginSupports().castSwap),
    environments: environmentsThatRunFlashChoices(environments),
  }
}

export function registerNodaroMotionFlashOfferRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/video-remake/flash-offer", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read Video Remake's Offer Flash")
    }
  })

  app.put("/v1/admin/video-remake/flash-offer", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = NODARO_MOTION_FLASH_OFFER_SECTION.body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const prepared = NODARO_MOTION_FLASH_OFFER_SECTION.prepare(parsed.data)
      if ("refusal" in prepared) return sendRefusal(reply, prepared.refusal)
      const { flashOffer } = prepared.value
      const refusal = await NODARO_MOTION_FLASH_OFFER_SECTION.engineRefusal!(prepared.value, null)
      if (refusal) return sendRefusal(reply, refusal)
      const before = (await readNodaroMotionFlashOffer()).flashOffer
      await saveNodaroMotionFlashOffer(flashOffer, req.userId!)
      await audit(req, "update_nodaro_motion_flash_offer", "app_setting", NODARO_MOTION_FLASH_OFFER_AUDIT_TARGET, {
        key: NODARO_MOTION_FLASH_OFFER_KEY,
        before,
        after: flashOffer,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save Video Remake's Offer Flash")
    }
  })
}
