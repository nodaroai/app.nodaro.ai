/**
 * When Offer Flash (`nodaro_motion_flash_offer` "on" for any engine) may be
 * saved.
 *
 * The Video Remake settings are one row each, which staging and production
 * share (one database, `engine-environments.ts`). This row offers a choice
 * only where an engine declares `castSwap.flashChoices`: an engine without
 * the flag refuses a Flash id, and `style-choice` answers `flash` false there.
 * A change that turns an engine on is therefore saved once AT LEAST ONE
 * environment in `TREND_PUBLISH_ENVIRONMENTS` has a recorded engine that
 * declares it (`noEnvironmentRunsFlashChoices`): one reader is enough, the
 * shot lock's rule (`nodaro-motion-shot-lock-gate.ts`). Because the row is
 * shared, "on" offers Flash to EVERY user of EVERY environment whose engine
 * declares it: the admin screen names them
 * (`environmentsThatRunFlashChoices`), so an offer meant for staging is not
 * made in production unseen.
 *
 * Off everywhere needs nothing: it is what every engine does today.
 */
import { engineTakesFlashChoices } from "../../lib/nodaro-motion-flash-offer.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

function runsFlashChoices(environments: readonly EngineEnvironment[], name: string): boolean {
  const env = environments.find((e) => e.env === name)
  return !!env && engineTakesFlashChoices(env.supports.castSwap)
}

/**
 * True when no environment of `TREND_PUBLISH_ENVIRONMENTS` has a recorded
 * engine declaring `castSwap.flashChoices` (an environment outside that list
 * never counts).
 */
export function noEnvironmentRunsFlashChoices(environments: readonly EngineEnvironment[]): boolean {
  return !TREND_PUBLISH_ENVIRONMENTS.some((name) => runsFlashChoices(environments, name))
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine reads the row: where "on" offers the Flash choice to every user.
 */
export function environmentsThatRunFlashChoices(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => runsFlashChoices(environments, name))
}

/** The refusal's sentence while `noEnvironmentRunsFlashChoices`. */
export const NO_ENGINE_RUNS_FLASH_CHOICES_MESSAGE = "No Cast Swap engine runs the Flash choices yet: keep Offer Flash off, or wait for the engine."
