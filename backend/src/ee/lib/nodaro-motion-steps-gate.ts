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
import { engineTakesClipBodySheet, engineTakesSteps } from "../../lib/cast-swap-steps.js"
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

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot take "Body from the clip" (`steps.clipBody`): none recorded,
 * or one that does not declare `castSwap.steps` and `castSwap.clipBodySheet`.
 * An engine with steps but without it is never sent the field, so a shared
 * setting that sets it On with a prompt of its own would quietly run that
 * engine's default there (Off needs nothing: it is safe on every engine).
 */
export function environmentsThatCannotTakeClipBody(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineTakesClipBodySheet(env.supports.castSwap)
  })
}

/** The refusal's sentence for "Body from the clip" (`environmentsThatCannotTakeClipBody`). */
export function cannotTakeClipBodyMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot take the Body from the clip step yet, and this setting is shared by every environment: leave that step unset, or wait for the engine.`
}
