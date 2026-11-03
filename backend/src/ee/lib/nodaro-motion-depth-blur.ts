/**
 * A Nodaro Motion setting whose depth is blurred (`depthBlur`, decided
 * 2026-11-02) is saved only once every environment's engine can blur it:
 * Full depth's map (the Motion setting; `castSwap.depthBlur`) and a Faces
 * hidden depth fill (the Precise and the Motion setting;
 * `castSwap.depthFillBlur`), each its own declaration.
 *
 * The Nodaro Motion settings (`nodaro_motion_masking`, and the Motion
 * setting's own `masking`) are one row each, which staging and production
 * share (one database, `engine-environments.ts`). An engine that does not
 * declare the blur is answered the setting without the key (`tk.settings`,
 * toolkit.ts), so its direct runs would quietly send the depth unblurred. So
 * the save is refused while any environment in `TREND_PUBLISH_ENVIRONMENTS`
 * has no recorded engine, or one that does not declare it: the face mesh's
 * rule (`nodaro-motion-face-mesh.ts`).
 */
import { depthBlurKindOf, depthBlurSent, engineBlursDepth, engineBlursDepthFill, type FaceMasking } from "../../lib/cast-swap-face-masking.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

/** The depth blur a direct run's setting draws its Full depth map with (on, full depth, above 0; `depthBlurSent`). */
export function depthBlurOfSetting(m: FaceMasking | undefined): number | undefined {
  return m && depthBlurKindOf(m) === "full-depth" ? depthBlurSent(m) : undefined
}

/** The depth blur a direct run's setting draws its Faces hidden depth fill with (on, the depth fill, above 0; `depthBlurSent`). */
export function depthFillBlurOfSetting(m: FaceMasking | undefined): number | undefined {
  return m && depthBlurKindOf(m) === "depth-fill" ? depthBlurSent(m) : undefined
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot blur the depth map: none recorded, or one that does not
 * declare it. Empty = every one can.
 */
export function environmentsThatCannotBlurDepth(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineBlursDepth(env.supports.castSwap)
  })
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot blur a Faces hidden depth fill: none recorded, or one that
 * does not declare `castSwap.depthFillBlur`. Empty = every one can.
 */
export function environmentsThatCannotBlurDepthFill(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineBlursDepthFill(env.supports.castSwap)
  })
}

/** The refusal's sentence, naming the environments that cannot (`environmentsThatCannotBlurDepth`). */
export function cannotBlurDepthMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot blur the depth map yet, and this setting is shared by every environment: set the depth blur to 0, or wait for the engine.`
}

/** The refusal's sentence, naming the environments that cannot (`environmentsThatCannotBlurDepthFill`). */
export function cannotBlurDepthFillMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot blur the depth fill yet, and this setting is shared by every environment: set the depth blur to 0, or wait for the engine.`
}
