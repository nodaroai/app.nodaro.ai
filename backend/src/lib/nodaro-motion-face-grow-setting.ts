/**
 * Video Remake's face grow, per engine (decided 2026-11-23): how far a DIRECT
 * Precise run's face mask is widened, % of each face's height, before it is
 * filled (Mask Composite's `faceGrowPct`, providers/video/mask-face-grow.ts).
 * Set by an admin for the whole deployment, never by the person running it.
 *
 * The `app_settings` row `nodaro_motion_face_grow`:
 * `{ "nodaro-prism"?: number, "nodaro-pulse"?: number }`, keyed by Video
 * Remake's PUBLIC engine ids, each a whole number 1–40
 * (`CAST_SWAP_FACE_GROW_BOUNDS`); 0 is off and never stored.
 *
 * Its OWN row, never a key of `nodaro_motion_masking`: that entry's schema is
 * strict, so a build from before the grow would drop the engine's whole
 * Precise masking on a key it does not know (and a rollback below this build
 * would stop that engine masking). Merged into the masking only where it is
 * answered to the engine (`withFaceGrowMerged`, `tk.settings.nodaroMotionMasking()`),
 * and sent only where it grows (`faceGrowSent`: target "face", a blur or depth
 * fill) to an engine that declares `castSwap.faceGrow`.
 *
 * A row keyed by the earlier ids reads as the new ones (`parseByEngine`).
 * Written only through `nodaro-motion-face-grow-store.ts`. Pure (no database).
 */
import { z } from "zod"
import { NODARO_MOTION_ENGINES } from "@nodaro/shared/models"
import { CAST_SWAP_FACE_GROW_BOUNDS } from "@nodaro/render-rules"
import { byEngineSchema, parseByEngine, type ByEngine } from "./nodaro-motion-engine-keys.js"
import type { FaceMasking } from "./cast-swap-face-masking.js"

export const NODARO_MOTION_FACE_GROW_KEY = "nodaro_motion_face_grow"

/** The saved setting: one grow per engine an admin set (an engine left out does not grow). */
export type NodaroMotionFaceGrow = ByEngine<number>

/** One engine's grow: a whole number within `CAST_SWAP_FACE_GROW_BOUNDS` (0 is accepted and means off). */
export const nodaroMotionFaceGrowEntrySchema: z.ZodType<number> = z.int().min(CAST_SWAP_FACE_GROW_BOUNDS.min).max(CAST_SWAP_FACE_GROW_BOUNDS.max)

/** What an admin saves: strict over the current engine ids. */
export const nodaroMotionFaceGrowSchema: z.ZodType<NodaroMotionFaceGrow> = byEngineSchema(nodaroMotionFaceGrowEntrySchema)

/** The setting with every 0 left out: what is stored and read. A new object. */
export function withoutDefaultFaceGrow(setting: NodaroMotionFaceGrow | null | undefined): NodaroMotionFaceGrow {
  const out: NodaroMotionFaceGrow = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    const v = setting?.[engine]
    if (typeof v === "number" && v > 0) out[engine] = v
  }
  return out
}

/** Whether any engine grows. */
export function anyFaceGrow(setting: NodaroMotionFaceGrow | null | undefined): boolean {
  return Object.keys(withoutDefaultFaceGrow(setting)).length > 0
}

/** The tolerant read of the stored row (`parseByEngine`), the zeros left out; not an object reads as never saved (null). */
export function parseNodaroMotionFaceGrow(value: unknown, warn: (msg: string) => void = (msg) => console.warn(msg)): NodaroMotionFaceGrow | null {
  const parsed = parseByEngine(value, NODARO_MOTION_FACE_GROW_KEY, nodaroMotionFaceGrowEntrySchema, warn)
  return parsed ? withoutDefaultFaceGrow(parsed) : null
}

/**
 * Each engine's Precise masking with its grow merged in as `growPct` (only
 * where the engine has both a masking and a grow above 0); every other entry
 * as it is. New objects; the inputs are not changed. Whether the grow is then
 * sent is `withFaceGrowFor`'s (lib/cast-swap-face-masking.ts).
 */
export function withFaceGrowMerged(
  masking: ByEngine<FaceMasking>,
  grow: NodaroMotionFaceGrow | null | undefined,
): ByEngine<FaceMasking> {
  const out: ByEngine<FaceMasking> = {}
  for (const engine of NODARO_MOTION_ENGINES) {
    const m = masking[engine]
    if (!m) continue
    const { growPct: _stale, ...rest } = m
    const g = grow?.[engine]
    out[engine] = typeof g === "number" && g > 0 ? { ...rest, growPct: g } : rest
  }
  return out
}
