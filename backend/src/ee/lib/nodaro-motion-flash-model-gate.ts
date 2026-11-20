/**
 * When the flash-model test (`nodaro_motion_flash_model` "on" for any engine)
 * may be saved.
 *
 * The Video Remake settings are one row each, which staging and production
 * share (one database, `engine-environments.ts`). This row is one only an
 * engine that declares `castSwap.flashModel` reads: an engine without the
 * flag never reads it, so the row cannot change a run there. A change that
 * turns an engine on is therefore saved once AT LEAST ONE environment in
 * `TREND_PUBLISH_ENVIRONMENTS` has a recorded engine that declares it
 * (`noEnvironmentRunsFlashModel`): one reader is enough, the shot lock's rule
 * (`nodaro-motion-shot-lock-gate.ts`). Because the row is shared, "on" is
 * read by EVERY environment whose engine declares it (for runs started by an
 * admin account there): the admin screen names
 * them (`environmentsThatRunFlashModel`), so a test meant for one environment
 * is not turned on in another unseen.
 *
 * Off everywhere needs nothing: it is what every engine does today.
 */
import { engineTakesFlashModel } from "../../lib/nodaro-motion-flash-model.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

function runsFlashModel(environments: readonly EngineEnvironment[], name: string): boolean {
  const env = environments.find((e) => e.env === name)
  return !!env && engineTakesFlashModel(env.supports.castSwap)
}

/**
 * True when no environment of `TREND_PUBLISH_ENVIRONMENTS` has a recorded
 * engine declaring `castSwap.flashModel` (an environment outside that list
 * never counts).
 */
export function noEnvironmentRunsFlashModel(environments: readonly EngineEnvironment[]): boolean {
  return !TREND_PUBLISH_ENVIRONMENTS.some((name) => runsFlashModel(environments, name))
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine reads the row: where "on" changes the model of every new run.
 */
export function environmentsThatRunFlashModel(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => runsFlashModel(environments, name))
}

/** The refusal's sentence while `noEnvironmentRunsFlashModel`. */
export const NO_ENGINE_RUNS_FLASH_MODEL_MESSAGE = "No Cast Swap engine runs the flash-model test yet: keep it off, or wait for the engine."
