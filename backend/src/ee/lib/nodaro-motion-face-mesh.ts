/**
 * A Nodaro Motion setting that draws the face mesh (`faceMesh: true`, faces
 * hidden or full depth) is saved only once every environment's engine can
 * draw it.
 *
 * The Nodaro Motion settings (`nodaro_motion_masking`, and the Motion
 * setting's own `masking`) are one row each, which staging and production
 * share (one database, `engine-environments.ts`). An engine that does not
 * declare `castSwap.faceMesh` is answered the settings without the key
 * (`tk.settings`, toolkit.ts: its strict schema would refuse the whole entry),
 * so its direct runs would quietly go without the mesh. So the save is
 * refused while any environment in `TREND_PUBLISH_ENVIRONMENTS` has no
 * recorded engine, or one that does not declare it: the same rule as hiding
 * whole people (`nodaro-motion-hide-body.ts`) and as publishing a trend.
 */
import { engineDrawsFaceMesh, faceMeshOn, type FaceMasking } from "../../lib/cast-swap-face-masking.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

/** Whether a direct run's setting draws the face mesh: on, and `faceMesh: true` with faces hidden or full depth. */
export function drawsFaceMesh(m: Pick<FaceMasking, "mode" | "source" | "faceMesh"> | undefined): boolean {
  return !!m && m.mode !== "off" && faceMeshOn(m)
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot draw the face mesh: none recorded, or one that does not
 * declare it. Empty = every one can.
 */
export function environmentsThatCannotDrawFaceMesh(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineDrawsFaceMesh(env.supports.castSwap)
  })
}

/** The refusal's sentence, naming the environments that cannot (`environmentsThatCannotDrawFaceMesh`). */
export function cannotDrawFaceMeshMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot draw the face mesh yet, and this setting is shared by every environment: turn the face mesh off, or wait for the engine.`
}
