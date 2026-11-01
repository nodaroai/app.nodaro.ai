/**
 * A Nodaro Motion setting that names a depth colormap (`depthColormap`,
 * decided 2026-11-01: full depth, or a faces-hidden depth fill) is saved only
 * once every environment's engine can draw it.
 *
 * The Nodaro Motion settings (`nodaro_motion_masking`, and the Motion
 * setting's own `masking`) are one row each, which staging and production
 * share (one database, `engine-environments.ts`). An engine that does not
 * declare the map in `castSwap.depthColormaps` is answered the settings
 * without the key (`tk.settings`, toolkit.ts), so its direct runs would
 * quietly draw the source's default. So the save is refused while any
 * environment in `TREND_PUBLISH_ENVIRONMENTS` has no recorded engine, or one
 * that does not declare it: the face mesh's rule (`nodaro-motion-face-mesh.ts`)
 * and publishing a trend's.
 */
import { depthColormapSent, engineDrawsDepthColormap, type FaceMasking, type FaceMaskingDepthColormap } from "../../lib/cast-swap-face-masking.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

/** The colormap a direct run's setting draws its depth with, when it changes what is drawn (masking on; `depthColormapSent`). */
export function depthColormapOfSetting(m: FaceMasking | undefined): FaceMaskingDepthColormap | undefined {
  return m && m.mode !== "off" ? depthColormapSent(m) : undefined
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot draw every one of `colormaps`: none recorded, or one that
 * does not declare each. Empty = every one can (and when none is asked).
 */
export function environmentsThatCannotDrawColormaps(
  environments: readonly EngineEnvironment[],
  colormaps: readonly FaceMaskingDepthColormap[],
): string[] {
  if (colormaps.length === 0) return []
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || colormaps.some((c) => !engineDrawsDepthColormap(env.supports.castSwap, c))
  })
}

/** The refusal's sentence, naming the colormaps and the environments that cannot (`environmentsThatCannotDrawColormaps`). */
export function cannotDrawColormapsMessage(colormaps: readonly FaceMaskingDepthColormap[], envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot draw the depth in ${colormaps.join(" or ")} yet, and this setting is shared by every environment: choose the default colormap, or wait for the engine.`
}
