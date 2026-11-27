// @reads-none reads the app settings and the loaded engine's declaration, no repo file
/**
 * The sizes a trend run may ask for (stage 4 of Video Remake's delivered resolution).
 *
 * Two ways, decided by the loaded engine alone:
 *
 *   engine     the engine does not declare BOTH `castSwap.deliveredResolution` and
 *              `castSwap.trendDeliveredResolution` (lib/video-remake-delivered-resolution.ts
 *              `engineDeliversTrendResolution`): a trend's sizes are the ones its engine choice MAKES
 *              (`trendResolutions`: Nodaro Prism 480p / 720p / 1080p, Nodaro Pulse 720p / 1080p, each Flash
 *              choice its own), and every page, run and body is exactly as before stage 4. No setting is read.
 *   delivered  the engine declares both: a trend's sizes are exactly the ones `GET /v1/video-remake/style-choice`
 *              answers for its engine choice (`deliveredResolutionsOffered`: the sizes DELIVERED there, less
 *              the steps this deployment's admin switched off), smallest (the default) first. The trend page
 *              says so (`deliveredResolution: true`), and a run is sent the size delivered with
 *              `trendRun.delivered: true` (compose.ts): the engine maps it onto the size it makes, never the
 *              platform.
 *
 * Read once per request (`readTrendSizesHere`), so the guest answer's keep key, the page and the run all use one
 * answer. A settings read that fails, or throws, answers the sizes with no Prism-family step (`precise` null, as
 * style-choice answers then: Nodaro Prism's and Prism Flash's own engine sizes, Nodaro Pulse's as declared) and
 * says it was not read (`settingsRead: false`), so that answer is never kept. Nothing is cached here.
 */
import type { NodaroMotionEngine, VideoRemakeFlashEngine } from "@nodaro/shared/models"
import { getAppSettings, settingsReadFailed } from "../../../lib/app-settings.js"
import { getPluginSupports } from "../../../lib/private-plugins/supports-registry.js"
import type { PluginSupports } from "../../../lib/private-plugins/types.js"
import { enginePreciseUpscale } from "../../../lib/video-remake-upscale-choice.js"
import {
  deliveredResolutionsOffered,
  deliveredResolutionsReadSettings,
  engineDeliversTrendResolution,
  engineMadeSizes,
  type VideoRemakeResolutions,
} from "../../../lib/video-remake-delivered-resolution.js"
import { trendChoiceId, trendResolutions } from "./schemas.js"
import type { TrendRunSize, TrendVersionData } from "./types.js"

/** How this deployment's engine reads a trend run's size, and (read the delivered way) what each engine choice offers. */
export type TrendSizesHere =
  | { readonly delivered: false }
  | {
      readonly delivered: true
      /** Per engine choice, the sizes delivered here, smallest (the default) first. */
      readonly resolutions: VideoRemakeResolutions
      /** False when the settings were needed and could not be read: the answer is then never kept. */
      readonly settingsRead: boolean
    }

/** One trend's sizes: whether they are sizes delivered, and the list, its default first. */
export interface TrendRunSizes {
  readonly delivered: boolean
  readonly sizes: readonly TrendRunSize[]
}

/** The answer from the engine's declaration and the Precise upscale as the engine is handed it (null: unread). Pure. */
export function trendSizesFrom(cs: PluginSupports["castSwap"] | undefined, precise: unknown, settingsRead = true): TrendSizesHere {
  if (!engineDeliversTrendResolution(cs)) return { delivered: false }
  return { delivered: true, resolutions: deliveredResolutionsOffered(cs, precise), settingsRead }
}

/**
 * What this deployment offers a trend run now: the settings read only where the sizes depend on them (an engine
 * that reads trend runs the delivered way and declares a Prism-family step), as style-choice reads them. Never throws.
 */
export async function readTrendSizesHere(): Promise<TrendSizesHere> {
  const cs = getPluginSupports().castSwap
  if (!engineDeliversTrendResolution(cs)) return { delivered: false }
  if (!deliveredResolutionsReadSettings(cs)) return trendSizesFrom(cs, null)
  try {
    const settings = await getAppSettings()
    if (settingsReadFailed(settings)) return trendSizesFrom(cs, null, false)
    return trendSizesFrom(cs, enginePreciseUpscale(settings.nodaro_motion_precise_upscale, cs))
  } catch {
    return trendSizesFrom(cs, null, false)
  }
}

/**
 * A trend's sizes, its default first: the engine choice's sizes delivered here, else (an engine that reads trend runs
 * by the size it makes) the ones its engine choice makes, exactly as before. A new array.
 */
export function trendRunSizes(data: Pick<TrendVersionData, "engine" | "flash">, here: TrendSizesHere): TrendRunSizes {
  if (!here.delivered) return { delivered: false, sizes: [...trendResolutions(data)] }
  const choice: NodaroMotionEngine | VideoRemakeFlashEngine = trendChoiceId(data)
  const listed = here.resolutions[choice]
  return { delivered: true, sizes: listed && listed.length > 0 ? [...listed] : engineMadeSizes(choice) }
}

/**
 * What the guest answers kept for a trend page depend on beyond the catalog: the sizes of every engine choice, read
 * the delivered way (an admin's Precise upscale save moves the catalog stamp; a deployment switch that withholds the
 * step does not). Null the other way (the kept answers' keys stay as they were), or when the answer must not be kept.
 */
export function trendSizesKeepKey(here: TrendSizesHere): { keep: false } | { keep: true; key: string | null } {
  if (!here.delivered) return { keep: true, key: null }
  if (!here.settingsRead) return { keep: false }
  return { keep: true, key: JSON.stringify(here.resolutions) }
}

/** A size in words ("4K" for "4k"). */
export function trendSizeLabel(size: TrendRunSize): string {
  return size === "4k" ? "4K" : size
}
