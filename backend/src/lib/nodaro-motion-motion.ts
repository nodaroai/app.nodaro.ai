/**
 * Nodaro Motion's Motion setting, per engine — how a DIRECT run with
 * `style: "motion"` prepares its clip and words its prompt. Set by an admin
 * for the whole deployment, never by the person running it. A trend run keeps
 * its own trend's setting; a Precise direct run uses `nodaro_motion_masking`.
 *
 * The `app_settings` row `nodaro_motion_motion`:
 * `{ "motion-prism"?: Entry, "motion-pulse"?: Entry }`, keyed by Nodaro
 * Motion's PUBLIC engine ids, each entry
 * `{ masking?: FaceMasking (source "faces" | "full-depth"), promptStyle?: "precise" | "flexible" }`.
 *
 * - `masking` left out: the engine's Precise masking (`nodaro_motion_masking`),
 *   on one video. Full depth is used only when an admin says so here
 *   (`source: "full-depth"`, mode "always", with its `scene`); keep people is a
 *   trend's alone, and marks are a trend's stored mask's alone.
 * - `promptStyle` left out: `"flexible"`.
 * - No row, or an engine left out: both defaults ("Same as Precise, Flexible
 *   prompt") — no clip-preparation charge of its own and no length limit.
 *
 * A row keyed by the earlier ids (`"motion-pro"`, `"motion-lite"`) reads as
 * the new ones (`parseByEngine`). Who reads it: the Cast Swap engine, through
 * `tk.settings.nodaroMotionMotion()` (advertised as
 * `tk.capabilities.nodaroMotionMotion`), which answers each entry under both
 * its current and its earlier key (`withEarlierEngineKeys`). Written only by
 * `PUT /v1/admin/nodaro-motion/motion` (ee/routes), through
 * `nodaro-motion-motion-store.ts`. This module is pure (no database).
 */
import { z } from "zod"
import { CAST_SWAP_PROMPT_STYLES, type CastSwapPromptStyle } from "@nodaro/render-rules"
import type { CastSwapStyle } from "@nodaro/shared/models"
import { faceMaskingMotionSchema, faceMaskingSourceOf, fullDepthSceneOf, type FaceMasking, type FaceMaskingScene } from "./cast-swap-face-masking.js"
import { parseByEngine, withEarlierEngineKeys, type ByEngine, type ByEngineForPlugin } from "./nodaro-motion-engine-keys.js"

export const NODARO_MOTION_MOTION_KEY = "nodaro_motion_motion"

/** A Motion run's masking: a face mask, or full depth (never keep people). */
export type NodaroMotionMotionMasking = FaceMasking & { source?: "faces" | "full-depth" }

/** One engine's Motion setting (each key left out takes its default, above). */
export interface NodaroMotionMotionEntry {
  masking?: NodaroMotionMotionMasking
  promptStyle?: CastSwapPromptStyle
}

/** The saved setting: one entry per engine an admin saved. */
export type NodaroMotionMotion = ByEngine<NodaroMotionMotionEntry>

/** What `tk.settings.nodaroMotionMotion()` answers: each entry under its current and its earlier key. */
export type NodaroMotionMotionForPlugin = ByEngineForPlugin<NodaroMotionMotionEntry>

/** A Motion run's prompt style when the setting names none. */
export const NODARO_MOTION_MOTION_DEFAULT_PROMPT_STYLE: CastSwapPromptStyle = "flexible"

/** One engine's entry: strict; its masking as `faceMaskingMotionSchema` takes it. */
export const nodaroMotionMotionEntrySchema = z.strictObject({
  masking: faceMaskingMotionSchema.optional(),
  promptStyle: z.enum(CAST_SWAP_PROMPT_STYLES).optional(),
}) as unknown as z.ZodType<NodaroMotionMotionEntry>

/** What an admin saves: strict (an unknown engine or key is refused). */
export const nodaroMotionMotionSchema: z.ZodType<NodaroMotionMotion> = z.strictObject({
  "motion-prism": nodaroMotionMotionEntrySchema.optional(),
  "motion-pulse": nodaroMotionMotionEntrySchema.optional(),
})

/** The setting with each entry also under its earlier key (a fresh copy): what the toolkit answers. */
export function withEarlierMotionKeys(motion: NodaroMotionMotion): NodaroMotionMotionForPlugin {
  return withEarlierEngineKeys(motion)
}

/**
 * The tolerant read of the stored row (`parseByEngine`): an earlier key read
 * as the current one, each engine's entry validated on its own, an invalid
 * one dropped with a warning (that engine then takes the defaults). Not an
 * object reads as never saved (null).
 */
export function parseNodaroMotionMotion(
  value: unknown,
  warn: (msg: string) => void = (msg) => console.warn(msg),
): NodaroMotionMotion | null {
  return parseByEngine(value, NODARO_MOTION_MOTION_KEY, nodaroMotionMotionEntrySchema, warn)
}

/** How a direct run of a style words its prompt and prepares its clip, as the engine's prompt parts route is asked. */
export interface DirectRunPromptShape {
  promptStyle: CastSwapPromptStyle
  source: "faces" | "full-depth"
  /** Full depth only, resolved. */
  scene?: FaceMaskingScene
}

/**
 * A direct run's prompt shape: Precise — the Precise prompt on a face mask;
 * Motion — the engine's Motion setting (`entry`; left out = the Precise
 * masking with the Flexible prompt).
 */
export function directRunPromptShape(style: CastSwapStyle, entry: NodaroMotionMotionEntry | undefined): DirectRunPromptShape {
  if (style === "precise") return { promptStyle: "precise", source: "faces" }
  const masking = entry?.masking
  const source = masking && faceMaskingSourceOf(masking) === "full-depth" ? "full-depth" : "faces"
  const scene = masking ? fullDepthSceneOf(masking) : null
  return {
    promptStyle: entry?.promptStyle ?? NODARO_MOTION_MOTION_DEFAULT_PROMPT_STYLE,
    source,
    ...(scene ? { scene } : {}),
  }
}
