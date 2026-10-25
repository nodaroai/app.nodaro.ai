/**
 * Nodaro Motion's face masking, per engine — set by an admin for the whole
 * deployment, never by the person running it (decided 2026-10-25).
 *
 * The `app_settings` row `nodaro_motion_masking`:
 * `{ "motion-pro"?: FaceMasking, "motion-lite"?: FaceMasking }`, keyed by
 * Nodaro Motion's PUBLIC engine ids, each entry a Cast Swap `faceMasking`
 * setting (`faceMaskingSchema`). No row = never saved: every direct run is
 * unmasked ("off", what a run that sends no masking always did).
 *
 * Who reads it: the Cast Swap engine, through `tk.settings.nodaroMotionMasking()`
 * (advertised as `tk.capabilities.nodaroMotionMasking`), for every DIRECT run
 * (no `trendRun`) and its estimate. A trend run keeps its own trend's setting.
 * Written only by `PUT /v1/admin/nodaro-motion/masking` (ee/routes), through
 * `nodaro-motion-masking-store.ts`. This module is pure (no database).
 *
 * Read through `getAppSettings()` (its 60 s cache, its stampede guard, and
 * `invalidateSettingsCache()` after a write), parsed here.
 */
import { z } from "zod"
import { NODARO_MOTION_ENGINES, type NodaroMotionEngine } from "@nodaro/shared/models"
import { faceMaskingSchema, type FaceMasking } from "./cast-swap-face-masking.js"

export const NODARO_MOTION_MASKING_KEY = "nodaro_motion_masking"

/** The saved setting: one entry per engine an admin saved (an engine left out masks nothing). */
export type NodaroMotionMasking = Partial<Record<NodaroMotionEngine, FaceMasking>>

/** What an admin saves: each engine's setting, strict (an unknown engine key is refused). */
export const nodaroMotionMaskingSchema: z.ZodType<NodaroMotionMasking> = z.strictObject({
  "motion-pro": faceMaskingSchema.optional(),
  "motion-lite": faceMaskingSchema.optional(),
})

/**
 * The tolerant read of the stored row (it may have been written by hand, or
 * by a newer build): each engine's entry validated on its own, an invalid one
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
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!(NODARO_MOTION_ENGINES as readonly string[]).includes(key)) {
      warn(`[${NODARO_MOTION_MASKING_KEY}] unknown engine "${key}" dropped`)
      continue
    }
    const parsed = faceMaskingSchema.safeParse(entry)
    if (!parsed.success) {
      warn(`[${NODARO_MOTION_MASKING_KEY}] invalid setting for "${key}" dropped: ${parsed.error.issues[0]?.message ?? "invalid"}`)
      continue
    }
    out[key as NodaroMotionEngine] = parsed.data
  }
  return out
}
