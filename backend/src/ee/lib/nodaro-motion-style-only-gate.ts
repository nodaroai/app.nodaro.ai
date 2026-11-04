/**
 * When the style-only settings may be saved: two rules, for two kinds of row.
 *
 * The Nodaro Motion settings are one row each, which staging and production
 * share (one database, `engine-environments.ts`).
 *
 * - The style-only row itself (`nodaro_motion_style_only`, its path and its
 *   own engine prompt) is a row only an engine that declares
 *   `castSwap.styleOnly` reads; an engine without the flag never reads it and
 *   refuses a style-only run anyway, so the row cannot mis-route a run there.
 *   A change is therefore saved once AT LEAST ONE
 *   environment in `TREND_PUBLISH_ENVIRONMENTS` has a recorded engine that
 *   declares it (`noEnvironmentRunsStyleOnly`): one reader is enough.
 * - A key inside a row an older engine also reads (the prompt parts'
 *   `styleOnly` key) keeps the every-environment rule of the other Nodaro
 *   Motion settings (`nodaro-motion-prompt-wording-gate.ts`): saved only once
 *   every environment's engine declares it (`environmentsThatCannotRunStyleOnly`).
 *
 * The defaults need neither: they are what every engine does today.
 */
import { engineTakesStyleOnly } from "../../lib/nodaro-motion-style-only.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

function runsStyleOnly(environments: readonly EngineEnvironment[], name: string): boolean {
  const env = environments.find((e) => e.env === name)
  return !!env && engineTakesStyleOnly(env.supports.castSwap)
}

/**
 * True when no environment of `TREND_PUBLISH_ENVIRONMENTS` has a recorded
 * engine declaring `castSwap.styleOnly` (an environment outside that list
 * never counts).
 */
export function noEnvironmentRunsStyleOnly(environments: readonly EngineEnvironment[]): boolean {
  return !TREND_PUBLISH_ENVIRONMENTS.some((name) => runsStyleOnly(environments, name))
}

/**
 * The refusal (400 `style_only_engine`) of anything style-only for Nodaro
 * Motion Pulse: art styles are Prism's, so Pulse never gets a style-only run
 * and a setting or prompt-parts entry for it would never be read. One
 * sentence for the switch route and the prompt-parts route.
 */
export const PULSE_RUNS_NO_STYLE_ONLY_MESSAGE = "Nodaro Motion Pulse takes no art style, so it runs no style-only runs."

/** The style-only row's refusal while `noEnvironmentRunsStyleOnly`. */
export const NO_ENGINE_RUNS_STYLE_ONLY_MESSAGE = "No Cast Swap engine runs style-only runs yet: keep the defaults (Original clip, Template), or wait for the engine."

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot run a style-only run: none recorded, or one that does not
 * declare `castSwap.styleOnly`. Empty = every one can.
 */
export function environmentsThatCannotRunStyleOnly(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => !runsStyleOnly(environments, name))
}

/** The every-environment refusal's sentence, naming the environments that cannot (`environmentsThatCannotRunStyleOnly`). */
export function cannotRunStyleOnlyMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot run style-only runs yet, and this setting is shared by every environment: keep the defaults (Original clip, Template), or wait for the engine.`
}
