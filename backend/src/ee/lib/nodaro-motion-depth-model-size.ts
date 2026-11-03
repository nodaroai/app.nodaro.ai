/**
 * A Nodaro Motion setting that names a depth model size (`depthModelSize`,
 * decided 2026-11-02: small or base, wherever it draws depth) is saved only
 * once every environment's engine can draw with it.
 *
 * The Nodaro Motion settings (`nodaro_motion_masking`, and the Motion
 * setting's own `masking`) are one row each, which staging and production
 * share (one database, `engine-environments.ts`). An engine that does not
 * declare the size in `castSwap.depthModelSizes` is answered the settings
 * without the key (`tk.settings`, toolkit.ts), so its direct runs would
 * quietly draw with the large model. So the save is refused while any
 * environment in `TREND_PUBLISH_ENVIRONMENTS` has no recorded engine, or one
 * that does not declare it: the depth colormap's rule
 * (`nodaro-motion-depth-colormap.ts`) and publishing a trend's.
 */
import { depthModelSizeSent, engineDrawsDepthModelSize, type FaceMasking, type FaceMaskingDepthModelSize } from "../../lib/cast-swap-face-masking.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

/** The model size a direct run's setting draws its depth with, when it changes the render (masking on; `depthModelSizeSent`). */
export function depthModelSizeOfSetting(m: FaceMasking | undefined): FaceMaskingDepthModelSize | undefined {
  return m && m.mode !== "off" ? depthModelSizeSent(m) : undefined
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot draw with every one of `sizes`: none recorded, or one that
 * does not declare each. Empty = every one can (and when none is asked).
 */
export function environmentsThatCannotDrawModelSizes(
  environments: readonly EngineEnvironment[],
  sizes: readonly FaceMaskingDepthModelSize[],
): string[] {
  if (sizes.length === 0) return []
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || sizes.some((s) => !engineDrawsDepthModelSize(env.supports.castSwap, s))
  })
}

/** The refusal's sentence, naming the sizes and the environments that cannot (`environmentsThatCannotDrawModelSizes`). */
export function cannotDrawModelSizesMessage(sizes: readonly FaceMaskingDepthModelSize[], envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot draw the depth with the ${sizes.join(" or ")} depth model yet, and this setting is shared by every environment: choose the default (large), or wait for the engine.`
}
