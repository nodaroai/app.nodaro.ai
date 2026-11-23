/**
 * The face grow (`nodaro_motion_face_grow`, lib/nodaro-motion-face-grow-setting.ts)
 * is shared by every environment (one database), so a grow is saved only once
 * every environment can apply it:
 *   - its ENGINE grows (`castSwap.faceGrow`): one that does not is answered
 *     the masking without the key (409 `engine_unsupported`);
 *   - its PLATFORM takes it (`PlatformSupports.faceGrow`, fresh): a build
 *     from before the row ignores it, so that environment's runs would
 *     silently not grow (422 `platform_unsupported`). The row is its own, so
 *     an older build never loses anything by reading it (the masking row
 *     stays readable by every build): the hold is about applying the setting
 *     everywhere, never about data.
 * Setting every engine back to 0 (nothing grows) is always saved.
 */
import { engineGrowsFaceMask } from "../../lib/cast-swap-face-masking.js"
import { TREND_PUBLISH_ENVIRONMENTS, platformOf, type EngineEnvironment } from "./engine-environments.js"
import { PLATFORM_UNSUPPORTED, type PlatformHold } from "./nodaro-motion-face-mesh.js"

/** The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose engine does not grow a face mask: none recorded, or one that does not declare it. */
export function environmentsThatCannotGrowFaceMask(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineGrowsFaceMask(env.supports.castSwap)
  })
}

/** The refusal's sentence, naming the environments whose engine cannot (`environmentsThatCannotGrowFaceMask`). */
export function cannotGrowFaceMaskMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot grow the face mask yet, and this setting is shared by every environment: set the grow to 0, or wait for the engine.`
}

/** The environments whose platform does not claim (fresh, `platformOf`) that it takes the face grow. Empty = every one does, now. */
export function environmentsWhosePlatformCannotTakeFaceGrow(environments: readonly EngineEnvironment[], now: number = Date.now()): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => platformOf(environments.find((e) => e.env === name), now)?.faceGrow !== true)
}

/** The hold of a save that grows while an environment's platform does not take the setting, or null. */
export function platformHoldOfFaceGrow(environments: readonly EngineEnvironment[], now: number = Date.now()): PlatformHold | null {
  const lacking = environmentsWhosePlatformCannotTakeFaceGrow(environments, now)
  if (lacking.length === 0) return null
  const list = lacking.join(" and ")
  return {
    code: PLATFORM_UNSUPPORTED,
    message: `The platform in ${list} does not take the face grow yet, and this setting is shared by every environment: set the grow to 0, or wait until ${list} ${lacking.length === 1 ? "is" : "are"} updated.`,
    envs: lacking,
  }
}
