/**
 * Read-only, defensive accessors over a Scene3D plan.
 *
 * The canvas stores a plan as `Record<string, unknown>` (the same shape every
 * other composer node uses for its plan field) because a workflow can be
 * loaded from a row written by an older schema version, imported, or authored
 * by an agent. The panel therefore NEVER dereferences a plan directly: it goes
 * through these readers, each of which returns a usable value for a malformed
 * plan instead of throwing inside a React render.
 *
 * Validation proper is the shared `scene3DPlanSchema`'s job (server side, and
 * on every edit). This module exists so a plan that fails it still PAINTS —
 * the spec requires a missing/unusable scene to keep its data and show an
 * actionable state, not to blank the editor.
 */

export type Vec3 = [number, number, number]

export type Scene3DObjectView = {
  id: string
  name: string
  primitive: string
  parentId?: string
  position: Vec3
  rotation: Vec3
  scale: Vec3
  dimensions: Vec3
  color: string
  keyframeCount: number
}

export type Scene3DCameraView = {
  position: Vec3
  target: Vec3
  focalLengthMm: number
  keyframeCount: number
}

const ORIGIN: Vec3 = [0, 0, 0]
const UNIT: Vec3 = [1, 1, 1]

/** Finite-number coercion — `NaN`/`Infinity`/`"3"` never reach a numeric input. */
export function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

/** A finite triple, or `fallback` when the value is not one. Always a fresh array. */
export function vec3(value: unknown, fallback: Vec3 = ORIGIN): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback]
  const out: Vec3 = [
    finite(value[0], fallback[0]),
    finite(value[1], fallback[1]),
    finite(value[2], fallback[2]),
  ]
  return out
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

export function planRevisionId(plan: Record<string, unknown> | undefined): string | undefined {
  const id = plan?.revisionId
  return typeof id === "string" && id.length > 0 ? id : undefined
}

export function planFps(plan: Record<string, unknown> | undefined, fallback = 24): number {
  const fps = finite(plan?.fps, fallback)
  return fps > 0 ? fps : fallback
}

export function planDurationInFrames(plan: Record<string, unknown> | undefined, fallback = 96): number {
  const frames = Math.round(finite(plan?.durationInFrames, fallback))
  return frames > 0 ? frames : fallback
}

export function planDimensions(plan: Record<string, unknown> | undefined): { width: number; height: number } {
  const width = Math.round(finite(plan?.width, 1920))
  const height = Math.round(finite(plan?.height, 1080))
  return { width: width > 0 ? width : 1920, height: height > 0 ? height : 1080 }
}

export function planBackgroundColor(plan: Record<string, unknown> | undefined): string {
  return str(plan?.backgroundColor, "#111111")
}

/** Every object in the plan, in stored order, each one fully defaulted. */
export function planObjects(plan: Record<string, unknown> | undefined): Scene3DObjectView[] {
  const raw = plan?.objects
  if (!Array.isArray(raw)) return []
  const out: Scene3DObjectView[] = []
  for (let i = 0; i < raw.length; i++) {
    const o = record(raw[i])
    const id = str(o.id, "")
    // An object with no id cannot be addressed by an edit operation, so it is
    // not offered for editing either — showing an uneditable row would be a lie.
    if (!id) continue
    const parentId = typeof o.parentId === "string" && o.parentId.length > 0 ? o.parentId : undefined
    out.push({
      id,
      name: str(o.name, id),
      primitive: str(o.primitive, "box"),
      parentId,
      position: vec3(o.position),
      rotation: vec3(o.rotation),
      scale: vec3(o.scale, UNIT),
      dimensions: vec3(o.dimensions, UNIT),
      color: str(o.color, "#cccccc"),
      keyframeCount: Array.isArray(o.keyframes) ? o.keyframes.length : 0,
    })
  }
  return out
}

export function planCamera(plan: Record<string, unknown> | undefined): Scene3DCameraView {
  const cam = record(plan?.camera)
  return {
    position: vec3(cam.position, [0, 2, 6]),
    target: vec3(cam.target),
    focalLengthMm: finite(cam.focalLengthMm, 50),
    keyframeCount: Array.isArray(cam.keyframes) ? cam.keyframes.length : 0,
  }
}

/** A plan is USABLE by the preview when it has a revision and at least one addressable object. */
export function isRenderableScene(plan: Record<string, unknown> | undefined): boolean {
  if (!plan) return false
  return planRevisionId(plan) !== undefined && planObjects(plan).length > 0
}
