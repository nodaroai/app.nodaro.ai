/**
 * Validate a stored plan against the SHARED schemas before anything expensive
 * touches it — for BOTH schema versions.
 *
 * A `scenePlan` on a node is `Record<string, unknown>`: it can arrive from an
 * imported workflow, an agent's `update_workflow_json`, a template, a parent
 * page's `postMessage`, or a row written by an older schema version. The
 * preview's three.js canvas allocates GPU buffers per object, walks the parent
 * chain, and — for v2 — downloads asset bytes; so handing it unvalidated data
 * is how a hostile or merely wrong plan (a 100k-object array, a 40000px canvas,
 * a parent cycle, a manifest declaring 4 GiB of geometry) turns into a hung
 * tab. Everything the viewport and the pose editors consume goes through here
 * first; a plan that fails is shown as an explained fallback and left on the
 * node UNTOUCHED, because losing the user's data is worse than not drawing it.
 *
 * Two entry points, deliberately:
 *
 *  - `validateScene3DAnyPlan` — the union. Returns a DISCRIMINATED result, so a
 *    caller that handles both versions gets `Scene3DPlanV1` or `Scene3DPlanV2`
 *    narrowed by `version`, never an `any` cast.
 *  - `validateScene3DPlan` — v1 ONLY, with exactly the behaviour (and the exact
 *    issue strings) it has always had. Every v1 consumer — the pose editors,
 *    the v1 numeric panel, the v1 applier — keeps its `Scene3DPlanV1` narrowing
 *    for free, and a v2 plan reaching one of them is a visible refusal rather
 *    than a field-by-field surprise.
 *
 * Dispatch is on `scene3DPlanSchemaVersion` BEFORE parsing, and then with that
 * version's own schema — not with the union schema. A union parse reports
 * discriminator noise for what is really a v1 field error, which would change
 * the message a v1 user sees for a v1 mistake.
 *
 * The result is memoized per plan OBJECT (`WeakMap`), so the viewport, the
 * preview and the pose editor share one parse per revision rather than three.
 */
import {
  SCENE3D_LIMITS,
  SCENE3D_V2_LIMITS,
  scene3DPlanSchemaVersion,
  scene3DPlanV1Schema,
  scene3DPlanV2Schema,
} from "@nodaro/shared"
import type { Scene3DPlanV1, Scene3DPlanV2 } from "@nodaro/shared"

export type Scene3DValidation =
  | { ok: true; plan: Scene3DPlanV1 }
  | { ok: false; issue: string }

export type Scene3DAnyValidation =
  | { ok: true; version: 1; plan: Scene3DPlanV1 }
  | { ok: true; version: 2; plan: Scene3DPlanV2 }
  | { ok: false; issue: string }

const cache = new WeakMap<object, Scene3DAnyValidation>()
/** The v1 VIEW of the same parse. Cached separately so `validateScene3DPlan`
 *  keeps returning one stable object per plan — callers memoize on it. */
const v1Cache = new WeakMap<object, Scene3DValidation>()

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

/**
 * The same idea for v2, where the list that matters is different: entities,
 * assets, shots and overrides are counted first, and only then is the DECLARED
 * asset byte total summed. A manifest that claims 4 GiB of geometry is refused
 * before a single request goes out — the browser must never be talked into
 * allocating from a number it has not checked.
 */
function oversizedV2(plan: Record<string, unknown>): string | null {
  const counts: Array<[string, number]> = [
    ["objects", SCENE3D_V2_LIMITS.maxEntities],
    ["assets", SCENE3D_V2_LIMITS.maxAssets],
    ["shots", SCENE3D_V2_LIMITS.maxShots],
    ["overrides", SCENE3D_V2_LIMITS.maxOverrides],
    ["references", SCENE3D_V2_LIMITS.maxReferences],
  ]
  for (const [key, limit] of counts) {
    const list = plan[key]
    if (Array.isArray(list) && list.length > limit) {
      return `${key}: this scene has ${list.length}; the limit is ${limit}`
    }
  }

  const assets = plan.assets
  if (Array.isArray(assets)) {
    let declared = 0
    for (const entry of assets) {
      const asset = entry as Record<string, unknown> | null
      // `blend-source` is a separately authorized download the renderer never
      // fetches, so it is outside the renderer budget (contract §3).
      if (asset?.kind === "blend-source") continue
      const byteLength = asset?.byteLength
      if (typeof byteLength === "number" && Number.isFinite(byteLength)) declared += byteLength
    }
    if (declared > SCENE3D_V2_LIMITS.maxRendererAssetBytes) {
      return `assets: this scene declares ${declared} bytes of assets; the limit is ${SCENE3D_V2_LIMITS.maxRendererAssetBytes}`
    }
  }
  return null
}

function validate(plan: Record<string, unknown>): Scene3DAnyValidation {
  const version = scene3DPlanSchemaVersion(plan)
  if (version === null) {
    return { ok: false, issue: "this is not a 3D scene plan" }
  }
  if (version === 1) {
    const tooBig = oversized(plan)
    if (tooBig) return { ok: false, issue: tooBig }
    const parsed = scene3DPlanV1Schema.safeParse(plan)
    return parsed.success
      ? { ok: true, version: 1, plan: parsed.data as Scene3DPlanV1 }
      : { ok: false, issue: firstIssue(parsed.error) }
  }
  if (version === 2) {
    const tooBig = oversizedV2(plan)
    if (tooBig) return { ok: false, issue: tooBig }
    const parsed = scene3DPlanV2Schema.safeParse(plan)
    return parsed.success
      ? { ok: true, version: 2, plan: parsed.data as Scene3DPlanV2 }
      : { ok: false, issue: firstIssue(parsed.error) }
  }
  return {
    ok: false,
    issue: `this scene uses schema version ${version}, which this app cannot open — update the app to view it`,
  }
}

/**
 * Parse `plan` with the shared schema for whichever version it declares.
 * Never throws; memoized per plan object.
 */
export function validateScene3DAnyPlan(plan: unknown): Scene3DAnyValidation {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { ok: false, issue: "this node holds no scene data" }
  }
  const cached = cache.get(plan as object)
  if (cached) return cached
  const result = validate(plan as Record<string, unknown>)
  cache.set(plan as object, result)
  return result
}

/**
 * v1 ONLY. Unchanged accept/reject set and unchanged issue strings, so every
 * existing v1 consumer keeps its `Scene3DPlanV1` narrowing.
 */
export function validateScene3DPlan(plan: unknown): Scene3DValidation {
  const result = validateScene3DAnyPlan(plan)
  const view: Scene3DValidation = !result.ok
    ? { ok: false, issue: result.issue }
    : result.version === 1
      ? { ok: true, plan: result.plan }
      : {
          ok: false,
          issue: `this scene uses schema version ${result.version}, which this view cannot edit`,
        }
  if (plan && typeof plan === "object") {
    const cached = v1Cache.get(plan as object)
    if (cached) return cached
    v1Cache.set(plan as object, view)
  }
  return view
}
