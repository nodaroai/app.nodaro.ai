/**
 * When the no-person setting may be saved.
 *
 * The Nodaro Motion settings are one row each, which staging and production
 * share (one database, `engine-environments.ts`). The no-person row
 * (`nodaro_motion_no_person`) is read only by an engine that declares
 * `castSwap.noPersonSourceClip`; an engine without the flag never reads it and
 * never sends the source clip on these runs, so the row cannot change a run
 * there. A change is therefore saved once AT LEAST ONE environment in
 * `TREND_PUBLISH_ENVIRONMENTS` has a recorded engine that declares it
 * (`noEnvironmentRunsNoPerson`): one reader is enough, as for the style-only
 * row (`nodaro-motion-style-only-gate.ts`).
 *
 * The default (on, stored as nothing) needs no engine: saving it can always
 * take a change back.
 */
import { engineTakesNoPersonSourceClip } from "../../lib/nodaro-motion-no-person.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

/**
 * True when no environment of `TREND_PUBLISH_ENVIRONMENTS` has a recorded
 * engine declaring `castSwap.noPersonSourceClip` (an environment outside that
 * list never counts).
 */
export function noEnvironmentRunsNoPerson(environments: readonly EngineEnvironment[]): boolean {
  return !TREND_PUBLISH_ENVIRONMENTS.some((name) => {
    const env = environments.find((e) => e.env === name)
    return !!env && engineTakesNoPersonSourceClip(env.supports.castSwap)
  })
}

/** The row's refusal while `noEnvironmentRunsNoPerson`. */
export const NO_ENGINE_READS_NO_PERSON_MESSAGE = "No Cast Swap engine reads this setting yet: keep the default (on), or wait for the engine."
