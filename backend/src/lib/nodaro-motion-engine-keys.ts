/**
 * A Nodaro Motion `app_settings` row keyed by engine (pure): the per-engine
 * face masking (`nodaro_motion_masking`) and the per-engine prompt part
 * overrides (`nodaro_motion_prompt_parts`). Both are keyed by the PUBLIC
 * engine ids (`"motion-prism"`, `"motion-pulse"`); a row written before the
 * 2026-10-26 rename names the earlier ones (`"motion-pro"`, `"motion-lite"`).
 */
import type { z } from "zod"
import {
  NODARO_MOTION_ENGINES,
  NODARO_MOTION_LEGACY_ENGINES,
  NODARO_MOTION_LEGACY_ENGINE_OF,
  type NodaroMotionEngine,
  type NodaroMotionLegacyEngine,
} from "@nodaro/shared/models"

export type ByEngine<T> = Partial<Record<NodaroMotionEngine, T>>
export type ByEngineForPlugin<T> = Partial<Record<NodaroMotionEngine | NodaroMotionLegacyEngine, T>>

/**
 * TRANSITION SHIM (the 2026-10-26 rename): the setting with every entry also
 * under its earlier key (`"motion-pro"` beside `"motion-prism"`,
 * `"motion-lite"` beside `"motion-pulse"`), because a plugin up to 0.397.0
 * looks only for the earlier keys, and a newer one for the current keys.
 * Remove once every environment pins a plugin that reads the current keys.
 * Returns new objects (each copy its own).
 */
export function withEarlierEngineKeys<T>(setting: ByEngine<T>): ByEngineForPlugin<T> {
  const out: ByEngineForPlugin<T> = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    const entry = setting[engine]
    if (entry === undefined) continue
    out[engine] = structuredClone(entry)
    out[NODARO_MOTION_LEGACY_ENGINE_OF[engine]] = structuredClone(entry)
  }
  return out
}

/**
 * The tolerant read of a stored row (it may have been written by hand, or by
 * a newer build): an earlier key read as the engine's current one (the
 * current key wins when both are there, whatever their order), each engine's
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
  const current = new Set(entries.map(([k]) => k).filter((k) => (NODARO_MOTION_ENGINES as readonly string[]).includes(k)))
  for (const [k, raw] of entries) {
    const engine: NodaroMotionEngine | undefined = (NODARO_MOTION_ENGINES as readonly string[]).includes(k)
      ? (k as NodaroMotionEngine)
      : Object.hasOwn(NODARO_MOTION_LEGACY_ENGINES, k)
        ? NODARO_MOTION_LEGACY_ENGINES[k as NodaroMotionLegacyEngine]
        : undefined
    if (!engine) {
      warn(`[${key}] unknown engine "${k}" dropped`)
      continue
    }
    if (engine !== k && current.has(engine)) continue
    const parsed = entry.safeParse(raw)
    if (!parsed.success) {
      warn(`[${key}] invalid setting for "${k}" dropped: ${parsed.error.issues[0]?.message ?? "invalid"}`)
      continue
    }
    out[engine] = parsed.data
  }
  return out
}
