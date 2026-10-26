/**
 * Nodaro Motion's face masking, per engine — set by an admin for the whole
 * deployment, never by the person running it (decided 2026-10-25).
 *
 * The `app_settings` row `nodaro_motion_masking`:
 * `{ "motion-prism"?: FaceMasking, "motion-pulse"?: FaceMasking }`, keyed by
 * Nodaro Motion's PUBLIC engine ids, each entry a Cast Swap `faceMasking`
 * setting (`faceMaskingSchema`). No row = never saved: every direct run is
 * unmasked ("off", what a run that sends no masking always did). A row saved
 * before the 2026-10-26 rename is keyed by the earlier ids (`"motion-pro"`,
 * `"motion-lite"`) and reads as the new ones. While environments on both
 * sides of the rename share the row, a save writes both key sets
 * (`withEarlierMaskingKeys`, in `nodaro-motion-masking-store.ts`), and the
 * read prefers the current key.
 *
 * Who reads it: the Cast Swap engine, through `tk.settings.nodaroMotionMasking()`
 * (advertised as `tk.capabilities.nodaroMotionMasking`), for every DIRECT run
 * (no `trendRun`) and its estimate. That read answers each entry under both
 * its current and its earlier key (`withEarlierMaskingKeys`, a transition shim
 * for plugins up to 0.397.0, which look only for the earlier keys). A trend run keeps its own trend's setting.
 * Written only by `PUT /v1/admin/nodaro-motion/masking` (ee/routes), through
 * `nodaro-motion-masking-store.ts`. This module is pure (no database).
 *
 * Read through `getAppSettings()` (its 60 s cache, its stampede guard, and
 * `invalidateSettingsCache()` after a write), parsed here.
 */
import { z } from "zod"
import {
  NODARO_MOTION_ENGINES,
  NODARO_MOTION_LEGACY_ENGINES,
  NODARO_MOTION_LEGACY_ENGINE_OF,
  type NodaroMotionEngine,
  type NodaroMotionLegacyEngine,
} from "@nodaro/shared/models"
import { faceMaskingSchema, type FaceMasking } from "./cast-swap-face-masking.js"

export const NODARO_MOTION_MASKING_KEY = "nodaro_motion_masking"

/** The saved setting: one entry per engine an admin saved (an engine left out masks nothing). */
export type NodaroMotionMasking = Partial<Record<NodaroMotionEngine, FaceMasking>>

/** What an admin saves: each engine's setting, strict (an unknown engine key is refused). */
export const nodaroMotionMaskingSchema: z.ZodType<NodaroMotionMasking> = z.strictObject({
  "motion-prism": faceMaskingSchema.optional(),
  "motion-pulse": faceMaskingSchema.optional(),
})

/**
 * What `tk.settings.nodaroMotionMasking()` answers: each engine's entry under
 * its current key and, the same value, its earlier one.
 */
export type NodaroMotionMaskingForPlugin = Partial<Record<NodaroMotionEngine | NodaroMotionLegacyEngine, FaceMasking>>

/**
 * TRANSITION SHIM (the 2026-10-26 rename): the setting with every entry also
 * under its earlier key (`"motion-pro"` beside `"motion-prism"`,
 * `"motion-lite"` beside `"motion-pulse"`), because a plugin up to 0.397.0
 * looks only for the earlier keys, and a newer one for the current keys.
 * Remove once every environment pins a plugin that reads the current keys.
 * Returns new objects (each copy its own).
 */
export function withEarlierMaskingKeys(masking: NodaroMotionMasking): NodaroMotionMaskingForPlugin {
  const out: NodaroMotionMaskingForPlugin = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    const entry = masking[engine]
    if (!entry) continue
    out[engine] = structuredClone(entry)
    out[NODARO_MOTION_LEGACY_ENGINE_OF[engine]] = structuredClone(entry)
  }
  return out
}

/**
 * The tolerant read of the stored row (it may have been written by hand, or
 * by a newer build): an earlier key read as the engine's current one (the
 * current key wins when both are there), each engine's entry validated on its own, an invalid one
 * dropped with a warning (that engine then masks nothing) and the valid ones
 * kept. Not an object at all reads as never saved (null). Returns new objects.
 */
export function parseNodaroMotionMasking(
  value: unknown,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): NodaroMotionMasking | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (value !== undefined && value !== null) warn(`[${NODARO_MOTION_MASKING_KEY}] not an object; read as never saved`)
    return null
  }
  const out: NodaroMotionMasking = {}
  const entries = Object.entries(value as Record<string, unknown>)
  // A current key wins over its earlier one when a row has both, whatever their order.
  const current = new Set(entries.map(([key]) => key).filter((key) => (NODARO_MOTION_ENGINES as readonly string[]).includes(key)))
  for (const [key, entry] of entries) {
    const engine: NodaroMotionEngine | undefined = (NODARO_MOTION_ENGINES as readonly string[]).includes(key)
      ? (key as NodaroMotionEngine)
      : Object.hasOwn(NODARO_MOTION_LEGACY_ENGINES, key)
        ? NODARO_MOTION_LEGACY_ENGINES[key as NodaroMotionLegacyEngine]
        : undefined
    if (!engine) {
      warn(`[${NODARO_MOTION_MASKING_KEY}] unknown engine "${key}" dropped`)
      continue
    }
    if (engine !== key && current.has(engine)) continue
    const parsed = faceMaskingSchema.safeParse(entry)
    if (!parsed.success) {
      warn(`[${NODARO_MOTION_MASKING_KEY}] invalid setting for "${key}" dropped: ${parsed.error.issues[0]?.message ?? "invalid"}`)
      continue
    }
    out[engine] = parsed.data
  }
  return out
}
