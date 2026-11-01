/**
 * A Prism reference audio setting that names a mode only some engines take
 * (`DECLARED_ONLY_PRISM_REFERENCE_AUDIO_MODES`: "one-tone", "octave") is
 * saved only once every environment's engine lists it in
 * `castSwap.prismReferenceAudioModes`.
 *
 * The direct runs' setting (`nodaro_motion_prism_reference_audio`) is one
 * row, which staging and production share (one database,
 * `engine-environments.ts`). An engine that does not list the mode is sent the
 * full audio for it (`prismReferenceAudioWire`), so its direct runs would
 * quietly carry the song. So the save is refused while any environment in
 * `TREND_PUBLISH_ENVIRONMENTS` has no recorded engine, or one that does not
 * list it: the depth colormap's rule (`nodaro-motion-depth-colormap.ts`) and
 * publishing a trend's (`prismReferenceAudioModeNeed`, publish-check.ts).
 */
import {
  engineTakesPrismReferenceAudioMode,
  type CastSwapPrismReferenceAudioDeclaredOnlyMode,
} from "../../lib/cast-swap-prism-reference-audio.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot take every one of `modes`: none recorded, or one that does not
 * list each. Empty = every one can (and when none is asked).
 */
export function environmentsThatCannotTakePrismReferenceAudioModes(
  environments: readonly EngineEnvironment[],
  modes: readonly CastSwapPrismReferenceAudioDeclaredOnlyMode[],
): string[] {
  if (modes.length === 0) return []
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || modes.some((m) => !engineTakesPrismReferenceAudioMode(env.supports.castSwap, m))
  })
}

/** The refusal's sentence, naming the modes and the environments that cannot take them. */
export function cannotTakePrismReferenceAudioModesMessage(
  modes: readonly CastSwapPrismReferenceAudioDeclaredOnlyMode[],
  envs: readonly string[],
): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot send the Prism reference audio as ${modes.join(" or ")} yet, and this setting is shared by every environment: choose another mode, or wait for the engine.`
}
