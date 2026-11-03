/**
 * The new Flex prompt wording (`nodaro_motion_prompt_wording` "new" for any
 * engine) is saved only once every environment's engine words it
 * (`castSwap.promptWordings` lists "new").
 *
 * The Nodaro Motion settings are one row each, which staging and production
 * share (one database, `engine-environments.ts`). An engine that does not
 * list the wording never reads the setting, so its direct Flex runs would
 * quietly stay on today's wording while the admin screen says "new". So the
 * save is refused while any environment in `TREND_PUBLISH_ENVIRONMENTS` has
 * no recorded engine, or one that does not list it: the Style choice's rule
 * (`nodaro-motion-style-gate.ts`). Every engine on "current" needs nothing.
 */
import { engineTakesPromptWording } from "../../lib/nodaro-motion-prompt-wording.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot word a Flex prompt the new way: none recorded, or one whose
 * `castSwap.promptWordings` does not list "new". Empty = every one can.
 */
export function environmentsThatCannotUseNewWording(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineTakesPromptWording(env.supports.castSwap, "new")
  })
}

/** The refusal's sentence, naming the environments that cannot (`environmentsThatCannotUseNewWording`). */
export function cannotUseNewWordingMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot use the new Flex prompt wording yet, and this setting is shared by every environment: keep the current wording, or wait for the engine.`
}
