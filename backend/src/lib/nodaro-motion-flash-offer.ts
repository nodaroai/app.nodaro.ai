/**
 * Video Remake's "Offer Flash", per engine (decided 2026-11-22): whether
 * EVERY user may pick that engine's Flash choice — Prism Flash
 * (`engine: "nodaro-prism-flash"`) beside Nodaro Prism, Pulse Flash
 * (`"nodaro-pulse-flash"`) beside Nodaro Pulse — each its engine's run with
 * the video step on the faster, lower-cost model of the same family, at that
 * model's own price, picked per run. `"off"` (the default) or `"on"`.
 *
 * The `app_settings` row `nodaro_motion_flash_offer`:
 * `{ "nodaro-prism"?: FlashOffer, "nodaro-pulse"?: FlashOffer }`, keyed by
 * Video Remake's PUBLIC engine ids, `FlashOffer = "off" | "on"`.
 *
 * - No row, an engine left out, or `"off"`: that engine's Flash choice is not
 *   offered (`style-choice` answers `flash` false for it) and a request naming
 *   it is refused 409 `flash_not_offered` (`nodaro-motion-engine.ts` here, and
 *   the engine itself). There is no deployment default.
 * - `"on"`: offered to every account, on every surface (the app, an API key,
 *   MCP), while this environment's engine declares `castSwap.flashChoices`.
 *
 * It is a NEW key on purpose: the retired admin-only test
 * (`nodaro_motion_flash_model`, an admin account's runs silently moved to the
 * Flash model) is read by nothing any more, so its stored row cannot expose
 * Flash to anyone.
 *
 * What is stored: only the engines that are on. Who reads it: the platform
 * (`flashOffered`, lib/video-remake-flash.ts, for `style-choice` and the
 * engine hook) and the Cast Swap engine, through
 * `tk.settings.nodaroMotionFlashOffer()` (advertised as
 * `tk.capabilities.nodaroMotionFlashOffer`), which answers each engine that is
 * on, null when none is, and to an engine that does not declare
 * `castSwap.flashChoices`. Written only by
 * `PUT /v1/admin/video-remake/flash-offer` (ee/routes), through
 * `nodaro-motion-flash-offer-store.ts`. It IS one of the Video Remake
 * settings a stored settings set holds (decided 2026-11-22): a set saved with
 * Flash on offers it once saved live, through that PUT and its rules. This
 * module is pure (no database).
 */
import { z } from "zod"
import { NODARO_MOTION_ENGINES, type NodaroMotionEngine } from "@nodaro/shared/models"
import { byEngineSchema, parseByEngine, type ByEngine } from "./nodaro-motion-engine-keys.js"

export const NODARO_MOTION_FLASH_OFFER_KEY = "nodaro_motion_flash_offer"

/** One engine's Offer Flash. */
export const NODARO_MOTION_FLASH_OFFERS = ["off", "on"] as const
export type NodaroMotionFlashOfferValue = (typeof NODARO_MOTION_FLASH_OFFERS)[number]

/** The saved setting: one value per engine an admin set. */
export type NodaroMotionFlashOffer = ByEngine<NodaroMotionFlashOfferValue>

/** What `tk.settings.nodaroMotionFlashOffer()` answers: each engine that is on, by its public id. */
export type NodaroMotionFlashOfferForPlugin = Partial<Record<NodaroMotionEngine, "on">>

const flashOfferSchema = z.enum(NODARO_MOTION_FLASH_OFFERS)

/** What an admin saves: strict (an unknown engine or value is refused). */
export const nodaroMotionFlashOfferSchema: z.ZodType<NodaroMotionFlashOffer> = byEngineSchema(flashOfferSchema)

/** The setting with every `"off"` entry left out (the same as never set): what is stored. A new object. */
export function flashOffersOn(setting: NodaroMotionFlashOffer | null | undefined): NodaroMotionFlashOffer {
  const out: NodaroMotionFlashOffer = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    if (setting?.[engine] === "on") out[engine] = "on"
  }
  return out
}

/** Whether any engine's Flash choice is offered by the setting. */
export function anyFlashOfferOn(setting: NodaroMotionFlashOffer | null | undefined): boolean {
  return Object.keys(flashOffersOn(setting)).length > 0
}

/** One engine's Offer Flash: `"off"` unless the setting turns it on. */
export function flashOfferOf(setting: NodaroMotionFlashOffer | null | undefined, engine: NodaroMotionEngine): NodaroMotionFlashOfferValue {
  return setting?.[engine] === "on" ? "on" : "off"
}

/**
 * What the plugin is answered: each engine that is on, by its public id (an
 * engine that takes Flash choices reads the public ids), a new object; null
 * when none is on.
 */
export function flashOfferForPlugin(setting: NodaroMotionFlashOffer | null | undefined): NodaroMotionFlashOfferForPlugin | null {
  const kept = flashOffersOn(setting)
  return Object.keys(kept).length > 0 ? (kept as NodaroMotionFlashOfferForPlugin) : null
}

/**
 * The tolerant read of the stored row (`parseByEngine`): each engine's value
 * validated on its own, an invalid one dropped with a warning (that engine
 * then stays off). Not an object reads as never saved (null).
 */
export function parseNodaroMotionFlashOffer(
  value: unknown,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): NodaroMotionFlashOffer | null {
  const parsed = parseByEngine(value, NODARO_MOTION_FLASH_OFFER_KEY, flashOfferSchema, warn)
  return parsed ? flashOffersOn(parsed) : null
}

/**
 * Whether a (loaded or recorded) Cast Swap engine runs the Flash choices: it
 * declares `castSwap.flashChoices` (and lists the two ids in its `engines`).
 * An engine without it refuses a Flash id and never reads the row.
 */
export function engineTakesFlashChoices(cs: { readonly flashChoices?: boolean } | undefined): boolean {
  return cs?.flashChoices === true
}
