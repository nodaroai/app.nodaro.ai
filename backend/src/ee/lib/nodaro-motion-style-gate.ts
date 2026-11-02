/**
 * A forced Nodaro Motion Style (Always Precise / Always Flex) is saved only
 * once every environment's engine enforces it (`castSwap.styleChoice`).
 *
 * The Nodaro Motion settings are one row each, which staging and production
 * share (one database, `engine-environments.ts`). An engine that does not
 * declare `castSwap.styleChoice` never reads the setting, so its direct runs
 * would quietly take the request's `style` while clients, told the style is
 * forced, hide their Style control. So the save is refused while any
 * environment in `TREND_PUBLISH_ENVIRONMENTS` has no recorded engine, or one
 * that does not declare it: the steps setting's rule
 * (`nodaro-motion-steps-gate.ts`). "Users choose" needs nothing.
 */
import { engineTakesStyleChoice } from "../../lib/nodaro-motion-style.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot enforce a forced style: none recorded, or one that does not
 * declare `castSwap.styleChoice`. Empty = every one can.
 */
export function environmentsThatCannotForceStyle(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineTakesStyleChoice(env.supports.castSwap)
  })
}

/** The refusal's sentence, naming the environments that cannot (`environmentsThatCannotForceStyle`). */
export function cannotForceStyleMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot enforce a Style yet, and this setting is shared by every environment: let users choose, or wait for the engine.`
}
