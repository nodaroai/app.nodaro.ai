/**
 * A Nodaro Motion setting whose Faces hidden fill is `"none"` (decided
 * 2026-11-02: the faces found but kept as filmed, only the face mesh drawn on
 * them) is saved only once every environment's engine can draw it.
 *
 * The Nodaro Motion settings (`nodaro_motion_masking`, and the Motion
 * setting's own `masking`) are one row each, which staging and production
 * share (one database, `engine-environments.ts`). An engine that does not
 * declare `castSwap.maskFillNone` is answered such an entry as
 * `{ mode: "off" }` (`tk.settings`, toolkit.ts `withFillNoneFor`), so its
 * direct runs would quietly go without the mesh. So the save is refused while
 * any environment in `TREND_PUBLISH_ENVIRONMENTS` has no recorded engine, or
 * one that does not declare it: the face mesh's rule
 * (`nodaro-motion-face-mesh.ts`), which a fill `"none"` also passes (it always
 * draws the mesh).
 */
import { depthBlurKindOf, engineDrawsFillNone, faceMaskingSourceOf, fillNoneOn, type FaceMasking } from "../../lib/cast-swap-face-masking.js"
import { TREND_PUBLISH_ENVIRONMENTS, type EngineEnvironment } from "./engine-environments.js"

/** Whether a direct run's setting keeps the faces as filmed, with the face mesh alone (on, faces hidden, `fill: "none"`). */
export function fillsNone(m: FaceMasking | undefined): boolean {
  return fillNoneOn(m)
}

/**
 * The environments (of `TREND_PUBLISH_ENVIRONMENTS`, in that order) whose
 * engine cannot draw the fill `"none"`: none recorded, or one that does not
 * declare it. Empty = every one can.
 */
export function environmentsThatCannotFillNone(environments: readonly EngineEnvironment[]): string[] {
  return TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
    const env = environments.find((e) => e.env === name)
    return !env || !engineDrawsFillNone(env.supports.castSwap)
  })
}

/** The refusal's sentence, naming the environments that cannot (`environmentsThatCannotFillNone`). */
export function cannotFillNoneMessage(envs: readonly string[]): string {
  return `The Cast Swap engine in ${envs.join(" and ")} cannot keep the faces as filmed with only the face mesh (the fill "None") yet, and this setting is shared by every environment: choose the blur or depth fill, or wait for the engine.`
}

/**
 * What the Motion setting's own masking may not name (decided 2026-11-02:
 * the Precise setting's alone): the fill `"none"` and a blur on a Faces
 * hidden depth fill. A direct Motion run does not draw either, so a save
 * naming one is refused (400) rather than kept and never used. Null when the
 * masking names neither; a stale value that is not read (a `"none"` under
 * Full depth, a blur of 0) is not a problem.
 */
export function motionMaskingPreciseOnlyProblem(m: FaceMasking | undefined): { field: "fill" | "depthBlur"; message: string } | null {
  if (!m) return null
  if (m.fill === "none" && faceMaskingSourceOf(m) === "faces") {
    return { field: "fill", message: 'The fill "none" (the faces as filmed, only the face mesh) is the Precise setting\'s alone: choose the blur or depth fill here, or set it in the Precise column.' }
  }
  if (depthBlurKindOf(m) === "depth-fill" && typeof m.depthBlur === "number" && m.depthBlur > 0) {
    return { field: "depthBlur", message: "A blur on the depth fill is the Precise setting's alone: set the depth blur to 0 here, or set it in the Precise column." }
  }
  return null
}
