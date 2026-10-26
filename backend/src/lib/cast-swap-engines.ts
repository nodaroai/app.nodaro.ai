/**
 * The video engines the loaded (or a recorded) Cast Swap engine runs. An
 * engine that predates the choice declares none and runs Seedance 2.5 alone:
 * it drops an `engine` it does not know, so a body naming another engine must
 * be held back rather than sent, or it would silently run on Seedance.
 *
 * Declared in any vocabulary: an engine that knows Nodaro Motion's public ids
 * declares those — the current ones (`"motion-prism"`, `"motion-pulse"`), or
 * the earlier ones (`"motion-pro"`, `"motion-lite"`, 0.394.0 – 0.397.0, with
 * `engineAliases`) — and may list the internal ids beside them; an older one
 * declares the internal ids only. Every form reads as the internal ids here,
 * the ones the platform stores and sends (`castSwapEngineFrom`), so a list of
 * the new ids alone still names both engines; a value that names no engine is
 * dropped.
 */
import { CAST_SWAP_ENGINE_WHEN_OMITTED, castSwapEngineFrom, type CastSwapEngine } from "@nodaro/shared/models"
import { getPluginSupports } from "./private-plugins/supports-registry.js"

export function castSwapEnginesOf(cs: { readonly engines?: readonly string[] } | undefined): readonly CastSwapEngine[] {
  if (!cs?.engines) return [CAST_SWAP_ENGINE_WHEN_OMITTED]
  const out: CastSwapEngine[] = []
  for (const declared of cs.engines) {
    const engine = castSwapEngineFrom(declared)
    if (engine && !out.includes(engine)) out.push(engine)
  }
  return out
}

/** Whether this process's Cast Swap engine runs `engine` (Seedance 2.5, or one it declares). */
export function loadedEngineRuns(engine: CastSwapEngine): boolean {
  return engine === CAST_SWAP_ENGINE_WHEN_OMITTED || castSwapEnginesOf(getPluginSupports().castSwap).includes(engine)
}

/**
 * The request key for a Nodaro Motion Pulse run's length fit: `motionLength`
 * where the loaded engine takes Nodaro Motion's names (`engineAliases`,
 * 0.394.0+), else the old `klingLength` (an older engine knows only that one
 * and would drop the other silently, cutting the clip's end).
 */
export function castSwapLengthKey(): "motionLength" | "klingLength" {
  return getPluginSupports().castSwap?.engineAliases === true ? "motionLength" : "klingLength"
}

/**
 * A body with its length fit under the key the loaded engine takes
 * (`castSwapLengthKey`): `motionLength` or `klingLength`, whichever the body
 * named, moved to that key. A body with neither is returned as it is. A new
 * object when it moves.
 */
export function withWireLengthKey<T extends object>(body: T): T {
  const b = body as Record<string, unknown>
  const value = b.motionLength ?? b.klingLength
  if (value === undefined) return body
  const { motionLength: _m, klingLength: _k, ...rest } = b
  return { ...rest, [castSwapLengthKey()]: value } as T
}
