/**
 * A Nodaro Motion Motion setting whose full depth blurs the depth map
 * (`depthBlur`, decided 2026-11-02) is saved only once every environment's
 * engine can blur it.
 *
 * The Motion setting (`nodaro_motion_motion`) is one row, which staging and
 * production share (one database, `engine-environments.ts`). An engine that
 * does not declare `castSwap.depthBlur` is answered the setting without the
 * key (`tk.settings`, toolkit.ts), so its direct runs would quietly send the
 * map unblurred. So the save is refused while any environment in
 * `TREND_PUBLISH_ENVIRONMENTS` has no recorded engine, or one that does not
 * declare it: the face mesh's rule (`nodaro-motion-face-mesh.ts`).
 */
import { depthBlurSent, engineBlursDepth, type FaceMasking } from "../../lib/cast-swap-face-masking.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

/** The depth blur a direct run's setting draws its depth map with (on, full depth, above 0; `depthBlurSent`). */
export function depthBlurOfSetting(m: FaceMasking | undefined): number | undefined {
  return depthBlurSent(m)
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

/** The refusal's sentence, naming the environments that cannot (`environmentsThatCannotBlurDepth`). */
export function cannotBlurDepthMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot blur the depth map yet, and this setting is shared by every environment: set the depth blur to 0, or wait for the engine.`
}
