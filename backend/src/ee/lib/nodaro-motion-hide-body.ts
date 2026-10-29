/**
 * A Nodaro Motion setting that hides whole people (`target: "body"` with faces
 * hidden) is saved only once every environment's engine can do it.
 *
 * The Nodaro Motion settings (`nodaro_motion_masking`, and the Motion
 * setting's own `masking`) are one row each, which staging and production
 * share (one database, `engine-environments.ts`). An engine that cannot hide
 * whole people (`castSwap.faceMaskHideTargets` without `"body"`,
 * `faceMaskHideTargetsOf`) refuses such an entry as invalid: its direct runs
 * would then go unmasked (or, for Motion, fall back to the Precise masking),
 * with only a log line to say so. So the save is refused while any
 * environment in `TREND_PUBLISH_ENVIRONMENTS` has no recorded engine, or one
 * that does not declare it: the same rule as publishing a trend.
 */
import { engineMasksTarget, faceMaskingSourceOf, type FaceMasking } from "../../lib/cast-swap-face-masking.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

/** Whether a direct run's setting hides the whole person: on, faces hidden, target `"body"`. */
export function hidesWholePeople(m: Pick<FaceMasking, "mode" | "source" | "target"> | undefined): boolean {
  return !!m && m.mode !== "off" && faceMaskingSourceOf(m) === "faces" && m.target === "body"
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot hide whole people: none recorded, or one that does not
 * declare it. Empty = every one can.
 */
export function environmentsThatCannotHideBodies(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineMasksTarget(env.supports.castSwap, "body", "faces")
  })
}

/** The refusal's sentence, naming the environments that cannot (`environmentsThatCannotHideBodies`). */
export function cannotHideBodiesMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot hide whole people yet, and this setting is shared by every environment: choose Head or Face, or wait for the engine.`
}
