/**
 * Deterministic Scene3D frame sampler.
 *
 * ONE function decides where every object and the camera are at a given frame,
 * and both the browser preview and the Remotion export call it — that shared
 * call is what makes "what you scrubbed" equal "what got encoded". It is pure
 * (no `three`, no DOM, no clock), so a frame number always maps to the same
 * numbers on any host.
 *
 * Interpolation contract (frozen with Task 1's authoring prompt):
 *  - Channels are independent: a keyframe that omits `rotation` does not touch
 *    rotation. Sparse tracks are normal.
 *  - The object's own `position`/`rotation`/`scale` (and the camera's
 *    `position`/`target`/`focalLengthMm`) act as an IMPLICIT keyframe at frame 0.
 *    An explicit frame-0 key wins over it.
 *  - Before the first key: hold the first value. After the last: hold the last.
 *  - `easing` on a keyframe governs the segment ENDING at that keyframe
 *    ("ease INTO this pose"), so an LLM can ease the very first move without
 *    having to emit a redundant frame-0 key. Default `linear`.
 *  - Rotation interpolates component-wise on the Euler triple (not slerp) —
 *    deterministic and matches how the numeric editor shows the values.
 */
import type {
  Scene3DCamera,
  Scene3DEasing,
  Scene3DObject,
  Scene3DPlanV1,
  Vec3,
} from "./types"
import { DEFAULT_SENSOR_WIDTH_MM } from "./types"
import { composeTRS, identityMat4, multiplyMat4, translationOf, type Mat4 } from "./matrix"

export interface Scene3DTransformSample {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

export interface Scene3DObjectSample extends Scene3DTransformSample {
  id: string
  parentId?: string
  /** Local TRS matrix, column-major (three.js element order). */
  localMatrix: Mat4
  /** Local matrix composed with every ancestor's, column-major. */
  worldMatrix: Mat4
  /** Translation column of `worldMatrix` — where the object actually is. */
  worldPosition: Vec3
}

export interface Scene3DCameraSample {
  position: Vec3
  target: Vec3
  focalLengthMm: number
  sensorWidthMm: number
  /** Vertical FOV in degrees, ready for `THREE.PerspectiveCamera.fov`. */
  fovDeg: number
}

export interface Scene3DFrameSample {
  frame: number
  camera: Scene3DCameraSample
  /** Parents always precede their children. */
  objects: Scene3DObjectSample[]
  byId: Record<string, Scene3DObjectSample>
}

type Easing = Scene3DEasing | undefined

// ── channel sampling ────────────────────────────────────────────────────

interface Key<T> {
  frame: number
  value: T
  easing: Easing
}

function easeT(t: number, easing: Easing): number {
  if (easing === "easeInOut") return t * t * (3 - 2 * t)
  return t
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

/**
 * Sample one channel. `keys` need not be sorted; the base value is inserted as
 * the frame-0 key unless the track already defines one there.
 */
function sampleChannel<T>(
  base: T,
  keys: Key<T>[],
  frame: number,
  mix: (a: T, b: T, t: number) => T,
): T {
  const sorted = [...keys].sort((a, b) => a.frame - b.frame)
  if (sorted.length === 0 || sorted[0].frame !== 0) {
    sorted.unshift({ frame: 0, value: base, easing: undefined })
  }

  if (frame <= sorted[0].frame) return sorted[0].value
  const last = sorted[sorted.length - 1]
  if (frame >= last.frame) return last.value

  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i]
    const to = sorted[i + 1]
    if (frame >= from.frame && frame <= to.frame) {
      const span = to.frame - from.frame
      if (span <= 0) return to.value
      // The DESTINATION key owns the easing of the segment ending at it.
      const t = easeT((frame - from.frame) / span, to.easing)
      return mix(from.value, to.value, t)
    }
  }
  return last.value
}

function vec3(input: readonly number[] | undefined, fallback: Vec3): Vec3 {
  if (!input || input.length < 3) return fallback
  return [input[0], input[1], input[2]]
}

/** Shape of any Scene3D keyframe, object or camera — every channel optional. */
interface AnyKeyframe {
  frame: number
  easing?: Scene3DEasing
  position?: readonly number[]
  rotation?: readonly number[]
  scale?: readonly number[]
  target?: readonly number[]
  focalLengthMm?: number
}

function collectVec3Keys(
  keyframes: ReadonlyArray<AnyKeyframe> | undefined,
  pick: (kf: AnyKeyframe) => readonly number[] | undefined,
): Key<Vec3>[] {
  const out: Key<Vec3>[] = []
  for (const kf of keyframes ?? []) {
    const raw = pick(kf)
    if (!raw) continue
    out.push({ frame: kf.frame, value: vec3(raw, [0, 0, 0]), easing: kf.easing })
  }
  return out
}

// ── public API ──────────────────────────────────────────────────────────

/** Local (parent-relative) transform of one object at `frame`. */
export function sampleScene3DObject(object: Scene3DObject, frame: number): Scene3DTransformSample {
  const kfs = object.keyframes as ReadonlyArray<AnyKeyframe> | undefined
  const basePosition = vec3(object.position, [0, 0, 0])
  const baseRotation = vec3(object.rotation, [0, 0, 0])
  const baseScale = vec3(object.scale, [1, 1, 1])

  return {
    position: sampleChannel(
      basePosition,
      collectVec3Keys(kfs, (kf) => kf.position),
      frame,
      lerpVec3,
    ),
    rotation: sampleChannel(
      baseRotation,
      collectVec3Keys(kfs, (kf) => kf.rotation),
      frame,
      lerpVec3,
    ),
    scale: sampleChannel(
      baseScale,
      collectVec3Keys(kfs, (kf) => kf.scale),
      frame,
      lerpVec3,
    ),
  }
}

/**
 * Vertical field of view for `THREE.PerspectiveCamera`.
 *
 * `sensorWidthMm` is the horizontal gauge, so the vertical extent is
 * `sensorWidthMm · height / width`. NOTE: this deliberately does NOT use
 * `PerspectiveCamera.setFocalLength()`, whose film height is
 * `filmGauge / max(aspect, 1)` — that clamps on portrait and would make
 * 9:16 scenes disagree with the numbers the plan states.
 */
export function focalLengthToVerticalFovDeg(
  focalLengthMm: number,
  sensorWidthMm: number,
  width: number,
  height: number,
): number {
  const gauge = sensorWidthMm > 0 ? sensorWidthMm : DEFAULT_SENSOR_WIDTH_MM
  const aspect = width > 0 && height > 0 ? width / height : 16 / 9
  const sensorHeightMm = gauge / aspect
  const f = focalLengthMm > 0 ? focalLengthMm : 1
  return (2 * Math.atan(sensorHeightMm / (2 * f)) * 180) / Math.PI
}

/** Camera state at `frame`, including the FOV the renderer should apply. */
export function sampleScene3DCamera(plan: Scene3DPlanV1, frame: number): Scene3DCameraSample {
  const camera = plan.camera as Scene3DCamera & { keyframes?: ReadonlyArray<AnyKeyframe> }
  const kfs = camera.keyframes

  const position = sampleChannel(
    vec3(camera.position, [0, 0, 5]),
    collectVec3Keys(kfs, (kf) => kf.position),
    frame,
    lerpVec3,
  )
  const target = sampleChannel(
    vec3(camera.target, [0, 0, 0]),
    collectVec3Keys(kfs, (kf) => kf.target),
    frame,
    lerpVec3,
  )
  const focalKeys: Key<number>[] = []
  for (const kf of kfs ?? []) {
    if (typeof kf.focalLengthMm !== "number") continue
    focalKeys.push({ frame: kf.frame, value: kf.focalLengthMm, easing: kf.easing })
  }
  const focalLengthMm = sampleChannel(camera.focalLengthMm, focalKeys, frame, lerp)
  const sensorWidthMm = camera.sensorWidthMm ?? DEFAULT_SENSOR_WIDTH_MM

  return {
    position,
    target,
    focalLengthMm,
    sensorWidthMm,
    fovDeg: focalLengthToVerticalFovDeg(focalLengthMm, sensorWidthMm, plan.width, plan.height),
  }
}

/**
 * Full deterministic sample of a plan at `frame` — the single source both the
 * preview canvas and the Remotion export read.
 */
export function sampleScene3DFrame(plan: Scene3DPlanV1, frame: number): Scene3DFrameSample {
  const objects = plan.objects ?? []
  const byIndex = new Map<string, Scene3DObject>()
  for (const obj of objects) byIndex.set(obj.id, obj)

  const localById = new Map<string, Scene3DTransformSample>()
  for (const obj of objects) localById.set(obj.id, sampleScene3DObject(obj, frame))

  const worldById = new Map<string, Mat4>()
  const resolveWorld = (id: string, seen: Set<string>): Mat4 => {
    const cached = worldById.get(id)
    if (cached) return cached
    const obj = byIndex.get(id)
    const local = localById.get(id)
    if (!obj || !local) return identityMat4()
    const localMatrix = composeTRS(local.position, local.rotation, local.scale)
    const parentId = obj.parentId
    let world = localMatrix
    // Cycles are rejected by the shared contract; guard anyway so a hand-written
    // plan degrades to "parented at the root" instead of hanging the preview.
    if (parentId && byIndex.has(parentId) && !seen.has(parentId)) {
      seen.add(id)
      world = multiplyMat4(resolveWorld(parentId, seen), localMatrix)
    }
    worldById.set(id, world)
    return world
  }

  // Parents before children so consumers can build a hierarchy in one pass.
  const ordered: Scene3DObject[] = []
  const emitted = new Set<string>()
  const emit = (obj: Scene3DObject, seen: Set<string>) => {
    if (emitted.has(obj.id) || seen.has(obj.id)) return
    seen.add(obj.id)
    const parent = obj.parentId ? byIndex.get(obj.parentId) : undefined
    if (parent) emit(parent, seen)
    if (emitted.has(obj.id)) return
    emitted.add(obj.id)
    ordered.push(obj)
  }
  for (const obj of objects) emit(obj, new Set())

  const samples: Scene3DObjectSample[] = ordered.map((obj) => {
    const local = localById.get(obj.id) as Scene3DTransformSample
    const localMatrix = composeTRS(local.position, local.rotation, local.scale)
    const worldMatrix = resolveWorld(obj.id, new Set())
    return {
      id: obj.id,
      parentId: obj.parentId,
      position: local.position,
      rotation: local.rotation,
      scale: local.scale,
      localMatrix,
      worldMatrix,
      worldPosition: translationOf(worldMatrix),
    }
  })

  const byId: Record<string, Scene3DObjectSample> = Object.create(null)
  for (const s of samples) byId[s.id] = s

  return {
    frame,
    camera: sampleScene3DCamera(plan, frame),
    objects: samples,
    byId,
  }
}

/** Frame count of a plan, clamped to at least one frame. */
export function scene3DFrameCount(plan: Scene3DPlanV1): number {
  return Math.max(1, Math.round(plan.durationInFrames))
}
