/**
 * Whether this deployment offers an engine's Flash choice (Nodaro Prism Flash,
 * Nodaro Pulse Flash; `@nodaro/shared/models` `VIDEO_REMAKE_FLASH_ENGINES`): the ONE
 * rule both the offering (`GET /v1/video-remake/style-choice`'s `flash`) and
 * the admitting (`nodaro-motion-engine.ts`, before the engine) read, so a
 * client is never shown a choice the platform then refuses, nor refused one it
 * was shown.
 *
 * Offered only while BOTH hold: this environment's Cast Swap engine runs the
 * Flash choices (`castSwap.flashChoices`, with the id in its `engines`), and
 * the admin's Offer Flash says "on" for the engine
 * (`nodaro_motion_flash_offer`, lib/nodaro-motion-flash-offer.ts). Fails
 * CLOSED: a settings read that failed is not offered. The engine checks the
 * setting again itself (`tk.settings.nodaroMotionFlashOffer()`).
 */
import {
  NODARO_MOTION_ENGINE_NAMES,
  VIDEO_REMAKE_FLASH_ENGINE_NAMES,
  nodaroMotionEngineOfFlash,
  videoRemakeFlashEngineOf,
  type NodaroMotionEngine,
  type VideoRemakeFlashEngine,
} from "@nodaro/shared/models"
import { getAppSettings, settingsReadFailed, type AppSettings } from "./app-settings.js"
import { engineTakesFlashChoices, flashOfferOf } from "./nodaro-motion-flash-offer.js"
import { getPluginSupports } from "./private-plugins/supports-registry.js"

type CastSwapSupports = { readonly flashChoices?: boolean; readonly engines?: readonly string[] } | undefined

/** Whether a (loaded or recorded) Cast Swap engine runs `choice`: it declares `flashChoices` and lists the id. */
export function engineRunsFlashChoice(cs: CastSwapSupports, choice: VideoRemakeFlashEngine): boolean {
  return engineTakesFlashChoices(cs) && (cs?.engines ?? []).includes(choice)
}

/**
 * Per engine, whether its Flash choice is offered, from settings already read
 * (null: not read, or the read failed — nothing offered). A new object.
 */
export function flashOfferedEngines(settings: AppSettings | null, cs: CastSwapSupports = getPluginSupports().castSwap): Record<NodaroMotionEngine, boolean> {
  const usable = settings !== null && !settingsReadFailed(settings)
  const offered = (engine: NodaroMotionEngine) =>
    usable && engineRunsFlashChoice(cs, videoRemakeFlashEngineOf(engine)) && flashOfferOf(settings.nodaro_motion_flash_offer, engine) === "on"
  return { "nodaro-prism": offered("nodaro-prism"), "nodaro-pulse": offered("nodaro-pulse") }
}

/** Whether `choice` is offered now (the settings through their cache; a failed read: not offered). Never rejects. */
export async function flashChoiceOffered(choice: VideoRemakeFlashEngine): Promise<boolean> {
  let settings: AppSettings | null = null
  try {
    settings = await getAppSettings()
  } catch {
    return false
  }
  return flashOfferedEngines(settings)[nodaroMotionEngineOfFlash(choice)]
}

/** The refusal of a Flash choice that is not offered (409), as the engine words it. */
export const FLASH_NOT_OFFERED = "flash_not_offered"

export function flashNotOfferedMessage(choice: VideoRemakeFlashEngine): string {
  return `${VIDEO_REMAKE_FLASH_ENGINE_NAMES[choice]} isn't available right now. Choose ${NODARO_MOTION_ENGINE_NAMES[nodaroMotionEngineOfFlash(choice)]}.`
}
