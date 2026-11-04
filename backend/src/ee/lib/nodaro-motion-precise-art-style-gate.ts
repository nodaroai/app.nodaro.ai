/**
 * When the Precise art-style setting may be saved.
 *
 * The Nodaro Motion settings are one row each, which staging and production
 * share (one database, `engine-environments.ts`). The Precise art-style row
 * (`nodaro_motion_precise_art_style`) is read only by an engine that declares
 * `castSwap.preciseArtStyle`; an engine without the flag never reads it and
 * refuses an art style on a Precise run anyway, so the row cannot change a
 * run there. A change is therefore saved once AT LEAST ONE environment in
 * `TREND_PUBLISH_ENVIRONMENTS` has a recorded engine that declares it
 * (`noEnvironmentRunsPreciseArtStyle`): one reader is enough, as for the
 * style-only row (`nodaro-motion-style-only-gate.ts`).
 *
 * The defaults (the opener "restyle", stored as nothing, and the style-refs
 * step Off) need no engine: saving them can always take a change back.
 */
import { engineTakesPreciseArtStyle } from "../../lib/nodaro-motion-precise-art-style.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

/**
 * True when no environment of `TREND_PUBLISH_ENVIRONMENTS` has a recorded
 * engine declaring `castSwap.preciseArtStyle` (an environment outside that
 * list never counts).
 */
export function noEnvironmentRunsPreciseArtStyle(environments: readonly EngineEnvironment[]): boolean {
  return !TREND_PUBLISH_ENVIRONMENTS.some((name) => {
    const env = environments.find((e) => e.env === name)
    return !!env && engineTakesPreciseArtStyle(env.supports.castSwap)
  })
}

/** The refusal (400 `precise_art_style_engine`) of a change for Nodaro Motion Pulse: it takes no art style, so the entry would never be read. */
export const PULSE_TAKES_NO_PRECISE_ART_STYLE_MESSAGE = "Nodaro Motion Pulse takes no art style, so it has no Precise art-style setting."

/** The row's refusal while `noEnvironmentRunsPreciseArtStyle`. */
export const NO_ENGINE_RUNS_PRECISE_ART_STYLE_MESSAGE =
  "No Cast Swap engine takes an art style on a Precise run yet: keep the defaults (Restyle, Style the role pictures off), or wait for the engine."
