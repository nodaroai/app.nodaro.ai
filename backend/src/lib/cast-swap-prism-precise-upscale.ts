/**
 * Video Remake's Precise upscale (2026-11-22): per output resolution, whether a
 * DIRECT Nodaro Prism run that is Precise (its run shape, decided by the engine)
 * sends its take to Topaz video upscale, and at which size, before the take is
 * scaled back to the run's own frame and delivered. Topaz at a size above the
 * output restores the detail the edit softens. Set by an admin for the whole
 * deployment, never by the person running it.
 *
 * The `app_settings` row `nodaro_motion_precise_upscale`:
 * `{ "480p"?: T | "off"; "720p"?: T | "off"; "1080p"?: T | "off" }`, where T is
 * a Topaz target (`TOPAZ_VIDEO_RESOLUTIONS`): 480p and 720p take "720p",
 * "1080p" or "4k"; 1080p takes "1080p" or "4k" (a target below the output
 * would only blur it). A resolution left out takes its default
 * (`PRECISE_UPSCALE_DEFAULTS`); a row never saved is every default.
 *
 * Who reads it: the Cast Swap engine, through
 * `tk.settings.nodaroMotionPreciseUpscale()` (advertised as
 * `tk.capabilities.nodaroMotionPreciseUpscale`), which answers the EFFECTIVE
 * value (every resolution filled), or null to an engine that does not declare
 * `castSwap.preciseUpscale`. An engine without the flag never reads the row
 * and never runs the step, so no value can be wrong there: the setting saves
 * whatever the engines. The engine decides which runs are Precise (drafts,
 * trend runs and runs made the Flex way take no upscale), records the target
 * on the job at admit time, and quotes the step as the breakdown line `upscale`.
 *
 * Read tolerantly (`parseNodaroMotionPreciseUpscale`): a resolution whose value
 * is not one it takes is dropped alone (its default applies); an unknown key is
 * ignored. The strict schema is what an admin saves. Written only through
 * `nodaro-motion-precise-upscale-store.ts`. This module is pure (no database).
 */
import { z } from "zod"
import { TOPAZ_VIDEO_RESOLUTIONS, type TopazVideoResolution } from "@nodaro/shared/models"
import { CAST_SWAP_PRISM_RESOLUTIONS, type CastSwapPrismResolution } from "./cast-swap-prism-reference-audio.js"

export const NODARO_MOTION_PRECISE_UPSCALE_KEY = "nodaro_motion_precise_upscale"

/** A resolution's choice: no upscale, or the Topaz target. */
export type PreciseUpscaleChoice = TopazVideoResolution | "off"

/** The choices each output resolution takes ("off" first, then the Topaz targets, smallest first). */
export const PRECISE_UPSCALE_CHOICES = {
  "480p": ["off", ...TOPAZ_VIDEO_RESOLUTIONS],
  "720p": ["off", ...TOPAZ_VIDEO_RESOLUTIONS],
  "1080p": ["off", "1080p", "4k"],
} as const satisfies Record<CastSwapPrismResolution, readonly PreciseUpscaleChoice[]>

/** The choice of a resolution left out, or of a setting never saved. */
export const PRECISE_UPSCALE_DEFAULTS = {
  "480p": "1080p",
  "720p": "1080p",
  "1080p": "4k",
} as const satisfies Record<CastSwapPrismResolution, PreciseUpscaleChoice>

/** Every resolution off: what the engine is answered while this deployment does not run Topaz (topaz-video-availability.ts). */
export const PRECISE_UPSCALE_ALL_OFF = { "480p": "off", "720p": "off", "1080p": "off" } as const satisfies Record<CastSwapPrismResolution, PreciseUpscaleChoice>

/** The stored setting: a resolution left out takes its default. */
export type NodaroMotionPreciseUpscale = { [R in CastSwapPrismResolution]?: (typeof PRECISE_UPSCALE_CHOICES)[R][number] }

/** The setting as the engine reads it: every resolution filled. */
export type NodaroMotionPreciseUpscaleEffective = { [R in CastSwapPrismResolution]: (typeof PRECISE_UPSCALE_CHOICES)[R][number] }

/** What an admin saves: strict (an unknown key or a choice the resolution does not take is a 400). */
export const nodaroMotionPreciseUpscaleSchema = z.strictObject({
  "480p": z.enum(PRECISE_UPSCALE_CHOICES["480p"]).optional(),
  "720p": z.enum(PRECISE_UPSCALE_CHOICES["720p"]).optional(),
  "1080p": z.enum(PRECISE_UPSCALE_CHOICES["1080p"]).optional(),
} satisfies Record<CastSwapPrismResolution, unknown>)

/**
 * The stored row, read tolerantly: not an object reads as never saved (null); a
 * resolution whose value it does not take is dropped alone, with a warning (its
 * default applies); any other key is ignored.
 */
export function parseNodaroMotionPreciseUpscale(value: unknown, warn: (msg: string) => void = (msg) => console.warn(msg)): NodaroMotionPreciseUpscale | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const out: Record<string, PreciseUpscaleChoice> = {}
  for (const r of CAST_SWAP_PRISM_RESOLUTIONS) {
    const v = row[r]
    if (v === undefined || v === null) continue
    if ((PRECISE_UPSCALE_CHOICES[r] as readonly unknown[]).includes(v)) out[r] = v as PreciseUpscaleChoice
    else warn(`[${NODARO_MOTION_PRECISE_UPSCALE_KEY}] the ${r} choice is not one it takes: its default (${PRECISE_UPSCALE_DEFAULTS[r]}) applies`)
  }
  return out as NodaroMotionPreciseUpscale
}

/** The effective setting: the stored choices, each resolution left out (or never saved) at its default. A fresh object. */
export function effectivePreciseUpscale(stored: NodaroMotionPreciseUpscale | null | undefined): NodaroMotionPreciseUpscaleEffective {
  const out: Record<string, PreciseUpscaleChoice> = { ...PRECISE_UPSCALE_DEFAULTS }
  for (const r of CAST_SWAP_PRISM_RESOLUTIONS) {
    const v = stored?.[r]
    if (v !== undefined) out[r] = v
  }
  return out as NodaroMotionPreciseUpscaleEffective
}

/** Whether a (loaded or recorded) Cast Swap engine runs the Precise upscale step (`castSwap.preciseUpscale`). An engine without it never reads the row. */
export function engineTakesPreciseUpscale(cs: { readonly preciseUpscale?: boolean } | undefined): boolean {
  return cs?.preciseUpscale === true
}
