/**
 * A Nodaro Motion steps setting is saved, and a trend that sets `steps` is
 * published, only once every environment's engine takes steps
 * (`castSwap.steps`).
 *
 * The Nodaro Motion settings are one row each, which staging and production
 * share (one database, `engine-environments.ts`). An engine that does not
 * declare `castSwap.steps` is answered no steps setting (`tk.settings`,
 * toolkit.ts), so its direct runs would quietly run as today. So the save is
 * refused while any environment in `TREND_PUBLISH_ENVIRONMENTS` has no
 * recorded engine, or one that does not declare it: the face mesh's rule
 * (`nodaro-motion-face-mesh.ts`).
 */
import { engineTakesSteps } from "../../lib/cast-swap-steps.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot take steps: none recorded, or one that does not declare it.
 * Empty = every one can.
 */
export function environmentsThatCannotTakeSteps(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineTakesSteps(env.supports.castSwap)
  })
}

/** The refusal's sentence, naming the environments that cannot (`environmentsThatCannotTakeSteps`). */
export function cannotTakeStepsMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot take preparation steps yet, and this setting is shared by every environment: clear the steps, or wait for the engine.`
}
