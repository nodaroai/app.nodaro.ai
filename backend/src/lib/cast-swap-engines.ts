/**
 * The video engines the loaded (or a recorded) Cast Swap engine runs. An
 * engine that predates the choice declares none and runs Seedance 2.5 alone:
 * it drops an `engine` it does not know, so a body naming another engine must
 * be held back rather than sent, or it would silently run on Seedance.
 */
import { CAST_SWAP_ENGINE_WHEN_OMITTED, type CastSwapEngine } from "@nodaro/shared/models"
import { getPluginSupports } from "./private-plugins/supports-registry.js"

export function castSwapEnginesOf(cs: { readonly engines?: readonly CastSwapEngine[] } | undefined): readonly CastSwapEngine[] {
  return cs?.engines ?? [CAST_SWAP_ENGINE_WHEN_OMITTED]
}

/** Whether this process's Cast Swap engine runs `engine` (Seedance 2.5, or one it declares). */
export function loadedEngineRuns(engine: CastSwapEngine): boolean {
  return engine === CAST_SWAP_ENGINE_WHEN_OMITTED || castSwapEnginesOf(getPluginSupports().castSwap).includes(engine)
}
