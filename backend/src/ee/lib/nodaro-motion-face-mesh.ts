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
import { engineDrawsFaceMesh, engineDrawsFaceMeshParts, faceMeshOn, faceMeshPartsSent, type FaceMasking, type FaceMaskingFaceMeshParts } from "../../lib/cast-swap-face-masking.js"
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

/**
 * The parts a direct run's setting draws its face mesh with when they are not
 * the full mesh (`faceMeshPartsSent`, the masking on): saved, like the mesh
 * itself, only once every environment's engine lists them
 * (`castSwap.faceMeshParts`); an engine that does not is answered the setting
 * without the key and would draw the full mesh.
 */
export function faceMeshPartsOfSetting(m: FaceMasking | undefined): Exclude<FaceMaskingFaceMeshParts, "full"> | undefined {
  return m && m.mode !== "off" ? faceMeshPartsSent(m) : undefined
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot draw every one of `parts`: none recorded, or one that does
 * not list each. Empty = every one can (and when none is asked).
 */
export function environmentsThatCannotDrawFaceMeshParts(environments: readonly EngineEnvironment[], parts: readonly FaceMaskingFaceMeshParts[]): string[] {
  if (parts.length === 0) return []
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || parts.some((p) => !engineDrawsFaceMeshParts(env.supports.castSwap, p))
  })
}

/** The words a refusal names each part by. */
const PARTS_NAME: Readonly<Record<FaceMaskingFaceMeshParts, string>> = { full: "the full mesh", features: "only the eyes and mouth", mouth: "only the mouth" }

/** The refusal's sentence, naming the parts and the environments that cannot (`environmentsThatCannotDrawFaceMeshParts`). */
export function cannotDrawFaceMeshPartsMessage(parts: readonly FaceMaskingFaceMeshParts[], envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot draw ${parts.map((p) => PARTS_NAME[p]).join(" or ")} of the face mesh yet, and this setting is shared by every environment: choose the full face mesh, or wait for the engine.`
}
