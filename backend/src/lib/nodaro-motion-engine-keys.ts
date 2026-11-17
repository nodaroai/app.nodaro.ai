/**
 * A Video Remake `app_settings` row keyed by engine (pure): the per-engine
 * face masking (`nodaro_motion_masking`) and the per-engine prompt part
 * overrides (`nodaro_motion_prompt_parts`). Both are keyed by the PUBLIC
 * engine ids (`"nodaro-prism"`, `"nodaro-pulse"`); a row written before the
 * 2026-11-17 rename names the earlier ones (`"motion-prism"`,
 * `"motion-pulse"`), and one written before the 2026-10-26 rename the ones
 * before them (`"motion-pro"`, `"motion-lite"`).
 */
import { z } from "zod"
import {
  NODARO_MOTION_EARLIER_ENGINES_OF,
  NODARO_MOTION_ENGINES,
  NODARO_MOTION_LEGACY_ENGINES,
  type NodaroMotionEngine,
  type NodaroMotionLegacyEngine,
} from "@nodaro/shared/models"

export type ByEngine<T> = Partial<Record<NodaroMotionEngine, T>>
export type ByEngineForPlugin<T> = Partial<Record<NodaroMotionEngine | NodaroMotionLegacyEngine, T>>

/**
 * TRANSITION SHIM (the engine renames): the setting with every entry also
 * under each of its earlier keys (`"motion-prism"` and `"motion-pro"` beside
 * `"nodaro-prism"`, `"motion-pulse"` and `"motion-lite"` beside
 * `"nodaro-pulse"`), because a Cast Swap engine from before a rename looks
 * only for the keys it knew, and staging and production share one row while
 * they run engines on both sides of it. Remove once every environment pins an
 * engine that reads the current keys. Returns new objects (each copy its own).
 */
export function withEarlierEngineKeys<T>(setting: ByEngine<T>): ByEngineForPlugin<T> {
  const out: ByEngineForPlugin<T> = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    const entry = setting[engine]
    if (entry === undefined) continue
    out[engine] = structuredClone(entry)
    for (const earlier of NODARO_MOTION_EARLIER_ENGINES_OF[engine]) out[earlier] = structuredClone(entry)
  }
  return out
}

/**
 * How recent a key is: 0 for a current id, 1 for the id before it, and so on
 * (`NODARO_MOTION_EARLIER_ENGINES_OF`, newest first).
 */
function keyAge(engine: NodaroMotionEngine, key: string): number {
  if (key === engine) return 0
  return 1 + (NODARO_MOTION_EARLIER_ENGINES_OF[engine] as readonly string[]).indexOf(key)
}

/**
 * The tolerant read of a stored row (it may have been written by hand, or by
 * a newer build): an earlier key read as the engine's current one (the most
 * recent key wins when several name one engine, whatever their order), each engine's
 * entry validated by `entry` on its own, an invalid one dropped with a
 * warning and the valid ones kept. Not an object at all reads as never saved
 * (null). `key` names the row in the warnings. Returns new objects.
 */
export function parseByEngine<T>(
  value: unknown,
  key: string,
  entry: z.ZodType<T>,
  warn: (msg: string) => void,
): ByEngine<T> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (value !== undefined && value !== null) warn(`[${key}] not an object; read as never saved`)
    return null
  }
  const out: ByEngine<T> = {}
  const entries = Object.entries(value as Record<string, unknown>)
  // The most recent key present for each engine: only it is read.
  const newest = new Map<NodaroMotionEngine, number>()
  for (const [k] of entries) {
    const engine = engineOfKey(k)
    if (engine) newest.set(engine, Math.min(newest.get(engine) ?? Infinity, keyAge(engine, k)))
  }
  for (const [k, raw] of entries) {
    const engine = engineOfKey(k)
    if (!engine) {
      warn(`[${key}] unknown engine "${k}" dropped`)
      continue
    }
    if (keyAge(engine, k) !== newest.get(engine)) continue
    const parsed = entry.safeParse(raw)
    if (!parsed.success) {
      warn(`[${key}] invalid setting for "${k}" dropped: ${parsed.error.issues[0]?.message ?? "invalid"}`)
      continue
    }
    out[engine] = parsed.data
  }
  return out
}

/** The current engine a setting's key names (a current or an earlier public id), or undefined. */
function engineOfKey(k: string): NodaroMotionEngine | undefined {
  if ((NODARO_MOTION_ENGINES as readonly string[]).includes(k)) return k as NodaroMotionEngine
  return Object.hasOwn(NODARO_MOTION_LEGACY_ENGINES, k) ? NODARO_MOTION_LEGACY_ENGINES[k as NodaroMotionLegacyEngine] : undefined
}

/**
 * A copy of `value` with every earlier engine key renamed to the current id
 * (the most recent key wins when several name one engine); any other key, and
 * anything that is not an object, is left as it is for the schema to judge.
 */
export function withCurrentEngineKeys(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const entries = Object.entries(value as Record<string, unknown>)
  const newest = new Map<NodaroMotionEngine, number>()
  for (const [k] of entries) {
    const engine = engineOfKey(k)
    if (engine) newest.set(engine, Math.min(newest.get(engine) ?? Infinity, keyAge(engine, k)))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of entries) {
    const engine = engineOfKey(k)
    if (!engine) out[k] = v
    else if (keyAge(engine, k) === newest.get(engine)) out[engine] = v
  }
  return out
}

/**
 * What an admin saves of a setting keyed by engine: strict over the current
 * ids (`"nodaro-prism"`, `"nodaro-pulse"`), each entry read by `entry`. An
 * earlier id is refused like any unknown key (a settings file from before a
 * rename is read through its own upgrade, ee/lib/nodaro-motion-settings-sets.ts).
 */
export function byEngineSchema<T>(entry: z.ZodType<T>): z.ZodType<ByEngine<T>> {
  return z.strictObject({ "nodaro-prism": entry.optional(), "nodaro-pulse": entry.optional() }) as unknown as z.ZodType<ByEngine<T>>
}

/** Whether `value` is a map keyed by engine: an object with at least one key, every key a current or an earlier public id. */
export function isKeyedByEngine(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length > 0 && keys.every((k) => engineOfKey(k) !== undefined)
}
