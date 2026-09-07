/**
 * Validate a stored plan against the SHARED `scene3DPlanSchema` before anything
 * expensive touches it.
 *
 * A `scenePlan` on a node is `Record<string, unknown>`: it can arrive from an
 * imported workflow, an agent's `update_workflow_json`, a template, or a row
 * written by an older schema version. The preview's three.js canvas allocates
 * GPU buffers per object and walks the parent chain — so handing it unvalidated
 * data is how a hostile or merely wrong plan (a 100k-object array, a 40000px
 * canvas, a parent cycle) turns into a hung tab. Everything the viewport and
 * the pose editors consume goes through here first; a plan that fails is shown
 * as an explained fallback and left on the node UNTOUCHED, because losing the
 * user's data is worse than not drawing it.
 *
 * The result is memoized per plan OBJECT (`WeakMap`), so the viewport, the
 * preview and the pose editor share one parse per revision rather than three.
 */
import { SCENE3D_LIMITS, scene3DPlanSchema } from "@nodaro/shared"
import type { Scene3DPlan } from "@nodaro/shared"

export type Scene3DValidation =
  | { ok: true; plan: Scene3DPlan }
  | { ok: false; issue: string }

const cache = new WeakMap<object, Scene3DValidation>()

function firstIssue(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0]
  if (!issue) return "invalid scene"
  const path = issue.path.join(".")
  return path ? `${path}: ${issue.message}` : issue.message
}

/**
 * Cheap structural rejections taken BEFORE `safeParse`.
 *
 * Zod walks every element of an array before reporting that the array is over
 * its `.max()`, so a million-object plan would be fully traversed just to be
 * told it is too big. These two checks are the ones where the input size is
 * itself the attack, so they answer in O(1).
 */
function oversized(plan: Record<string, unknown>): string | null {
  const objects = plan.objects
  if (Array.isArray(objects) && objects.length > SCENE3D_LIMITS.maxObjects) {
    return `objects: this scene has ${objects.length} objects; the limit is ${SCENE3D_LIMITS.maxObjects}`
  }
  if (Array.isArray(objects)) {
    for (const entry of objects) {
      const keyframes = (entry as Record<string, unknown> | null)?.keyframes
      if (Array.isArray(keyframes) && keyframes.length > SCENE3D_LIMITS.maxKeyframes) {
        return `keyframes: an object has ${keyframes.length} keyframes; the limit is ${SCENE3D_LIMITS.maxKeyframes}`
      }
    }
  }
  const cameraKeyframes = (plan.camera as Record<string, unknown> | undefined)?.keyframes
  if (Array.isArray(cameraKeyframes) && cameraKeyframes.length > SCENE3D_LIMITS.maxKeyframes) {
    return `camera.keyframes: ${cameraKeyframes.length} keyframes; the limit is ${SCENE3D_LIMITS.maxKeyframes}`
  }
  return null
}

/** Parse `plan` with the shared schema. Never throws; memoized per plan object. */
export function validateScene3DPlan(plan: unknown): Scene3DValidation {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { ok: false, issue: "this node holds no scene data" }
  }
  const cached = cache.get(plan as object)
  if (cached) return cached

  const record = plan as Record<string, unknown>
  const tooBig = oversized(record)
  const result: Scene3DValidation = tooBig
    ? { ok: false, issue: tooBig }
    : (() => {
        const parsed = scene3DPlanSchema.safeParse(record)
        return parsed.success
          ? ({ ok: true, plan: parsed.data as Scene3DPlan } as const)
          : ({ ok: false, issue: firstIssue(parsed.error) } as const)
      })()

  cache.set(plan as object, result)
  return result
}
