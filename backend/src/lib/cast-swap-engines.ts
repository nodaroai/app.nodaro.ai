/**
 * The video engines the loaded (or a recorded) Cast Swap engine runs. An
 * engine that predates the choice declares none and runs Seedance 2.5 alone:
 * it drops an `engine` it does not know, so a body naming another engine must
 * be held back rather than sent, or it would silently run on Seedance.
 *
 * Declared in any vocabulary: an engine that knows Video Remake's public ids
 * declares those — the current ones (`"nodaro-prism"`, `"nodaro-pulse"`), or
 * earlier ones (`"motion-prism"`, `"motion-pulse"`; `"motion-pro"`,
 * `"motion-lite"`, 0.394.0 – 0.397.0, with `engineAliases`) — and may list
 * the internal ids beside them; an older one
 * declares the internal ids only. Every form reads as the internal ids here,
 * the ones the platform stores and sends (`castSwapEngineFrom`), so a list of
 * the new ids alone still names both engines; a value that names no engine is
 * dropped.
 */
import {
  CAST_SWAP_ENGINE_WHEN_OMITTED,
  NODARO_MOTION_LEGACY_ENGINE_OF,
  castSwapEngineFrom,
  type CastSwapEngine,
  type NodaroMotionEngine,
} from "@nodaro/shared/models"
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
 * Whether this process's Cast Swap engine takes an art style (`direction.style`
 * on a direct Flex run): it declares `castSwap.artStyle` (0.417.0+). An older
 * one strips a `direction` it does not know and runs without the style, so a
 * body naming one must be held back rather than sent.
 */
export function loadedEngineTakesArtStyle(): boolean {
  return getPluginSupports().castSwap?.artStyle === true
}

/**
 * Whether this process's Cast Swap engine takes a custom style
 * (`direction.customStyle`, the style in the person's own words, and its
 * `describe-style` route): it declares `castSwap.customStyle`. An older one's
 * strict schema refuses the key, so a body naming one must be held back rather
 * than sent. Whether the deployment offers it is the route's to say
 * (`custom_style_not_available`).
 */
export function loadedEngineTakesCustomStyle(): boolean {
  return getPluginSupports().castSwap?.customStyle === true
}

/**
 * Whether this process's Cast Swap engine plans roles from the prompt
 * (`POST /v1/video-remake/plan-roles`): it declares `castSwap.planRoles`. An
 * older one has no such route, so a caller must not ask it. Whether the
 * deployment offers it is the route's to say (`plan_roles_not_available`).
 */
export function loadedEngineTakesPlanRoles(): boolean {
  return getPluginSupports().castSwap?.planRoles === true
}

/**
 * Whether this process's Cast Swap engine takes a 3D previz clip
 * (`clipKind: "previz"` on the run and the estimate): it declares
 * `castSwap.previz`. An older one drops the key and would run an ordinary
 * edit of the clip, so a body naming one must be held back rather than sent.
 * Whether the deployment accepts it is the route's to say
 * (`previz_not_available`).
 */
export function loadedEngineTakesPreviz(): boolean {
  return getPluginSupports().castSwap?.previz === true
}

/**
 * The request key for a Nodaro Pulse run's length fit: `motionLength`
 * where the loaded engine takes Video Remake's names (`engineAliases`,
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

/**
 * The public id to send the loaded Cast Swap engine for `engine`, where a
 * route of the engine takes a public id (the steps route): the current id
 * once the engine declares it among its `engines`, else the id before it
 * (`"motion-prism"`, `"motion-pulse"`), the only one an engine from before the
 * 2026-11-17 rename takes.
 */
export function publicEngineIdForLoadedEngine(engine: NodaroMotionEngine): NodaroMotionEngine | (typeof NODARO_MOTION_LEGACY_ENGINE_OF)[NodaroMotionEngine] {
  const declared = getPluginSupports().castSwap?.engines ?? []
  return (declared as readonly string[]).includes(engine) ? engine : NODARO_MOTION_LEGACY_ENGINE_OF[engine]
}
