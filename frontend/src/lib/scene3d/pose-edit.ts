/**
 * Frame-aware pose editing: make a numeric nudge change what the user can SEE.
 *
 * The bug this exists to close: the sampler treats an object's own
 * `position`/`rotation`/`scale` (and the camera's `position`/`target`/
 * `focalLengthMm`) as an IMPLICIT keyframe at frame 0, and an EXPLICIT frame-0
 * key wins over it. So on any animated object, writing the base value — which
 * is what a plain `set-object` does — is a successful, billed, history-making
 * edit with NO visible effect at any frame. The user drags a number, the scene
 * does not move, and nothing reports an error.
 *
 * The rule, applied identically to objects and to the camera:
 *
 *  1. An explicit key AT the current frame carrying this channel → update that
 *     key (its other channels and its `easing` are preserved).
 *  2. Frame 0 with no explicit key for the channel → edit the base. The base IS
 *     the frame-0 pose in that case.
 *  3. The channel is animated (some key defines it) and we are past frame 0 →
 *     INSERT a key at this frame, leaving every other key byte-identical.
 *  4. The channel is static → edit the base. A static channel reads the same at
 *     every frame, so moving the base moves the visible pose; turning a static
 *     object into an animated one because the playhead happened to sit at frame
 *     30 would be a surprise, not a feature.
 *
 * Channels with no keyframe representation at all (`dimensions`, `color`,
 * background) fall through rule 4 by construction and stay ordinary plan edits.
 *
 * The VALUES the controls show come from the shared sampler, not from the plan,
 * so what is displayed, what is compared against for "did this change
 * anything", and what is written all describe the same instant.
 */
import { SCENE3D_LIMITS } from "@nodaro/shared"
import type {
  Scene3DCamera,
  Scene3DCameraChanges,
  Scene3DCameraKeyframe,
  Scene3DEditOperation,
  Scene3DObject,
  Scene3DObjectChanges,
  Scene3DObjectKeyframe,
  Vec3,
} from "@nodaro/shared"
import { withAxis, type CameraVectorChannel, type ObjectVectorChannel, type VectorAxis } from "./edit-operations"

/** The object channels that have a keyframe track. */
export type AnimatableObjectChannel = Extract<ObjectVectorChannel, "position" | "rotation" | "scale">

const ANIMATABLE_OBJECT_CHANNELS: ReadonlySet<string> = new Set(["position", "rotation", "scale"])

/** How an edit at the current frame will be written — surfaced in the UI so the
 *  behaviour is labelled rather than inferred. */
export type PoseEditMode =
  /** Writes the object's/camera's own value (the implicit frame-0 pose). */
  | "base"
  /** Updates the explicit key already sitting at this frame. */
  | "keyframe-update"
  /** Adds a key at this frame to an already-animated channel. */
  | "keyframe-insert"

export type PoseEditPlan =
  | { ok: true; operation: Scene3DEditOperation; mode: PoseEditMode }
  /** Refused before anything is applied — `code` is localized by the caller. */
  | { ok: false; code: "keyframe_limit" }
  /** The value is already what it is; nothing to write. */
  | null

/** Either keyframe kind, read structurally — both are `{ frame } + optional
 *  channels`, and this module only ever asks "does key K define channel C". */
export type Scene3DKeyframeLike = Scene3DObjectKeyframe | Scene3DCameraKeyframe

function channelOf(keyframe: Scene3DKeyframeLike, channel: string): unknown {
  return (keyframe as unknown as Record<string, unknown>)[channel]
}

function keyframesOf(source: { keyframes?: ReadonlyArray<Scene3DKeyframeLike> }): ReadonlyArray<Scene3DKeyframeLike> {
  return Array.isArray(source.keyframes) ? source.keyframes : []
}

/** True when some explicit key defines this channel. */
export function channelIsAnimated(
  keyframes: ReadonlyArray<Scene3DKeyframeLike>,
  channel: string,
): boolean {
  return keyframes.some((kf) => channelOf(kf, channel) !== undefined)
}

/** Which of the four writes an edit to `channel` at `frame` would perform. */
export function poseEditMode(
  keyframes: ReadonlyArray<Scene3DKeyframeLike>,
  channel: string,
  frame: number,
  animatable: boolean,
): PoseEditMode {
  if (!animatable) return "base"
  const atFrame = keyframes.find((kf) => kf.frame === frame)
  if (atFrame && channelOf(atFrame, channel) !== undefined) return "keyframe-update"
  if (frame === 0) return "base"
  return channelIsAnimated(keyframes, channel) ? "keyframe-insert" : "base"
}

/**
 * The keyframe array that results from writing `value` into `channel` at
 * `frame`, or `null` when the write belongs on the base instead.
 *
 * Sorted by frame, every untouched key preserved by identity-equal content.
 */
function writeKeyframe<K extends Scene3DKeyframeLike>(
  keyframes: ReadonlyArray<K>,
  channel: string,
  frame: number,
  value: Vec3 | number,
  mode: PoseEditMode,
): K[] | null {
  if (mode === "base") return null
  const next = keyframes.map((kf) => (kf.frame === frame ? ({ ...kf, [channel]: value } as K) : kf))
  if (mode === "keyframe-insert") {
    next.push({ frame, [channel]: value } as unknown as K)
  }
  return next.sort((a, b) => a.frame - b.frame)
}

function overKeyframeCap(next: ReadonlyArray<unknown> | null): boolean {
  return next !== null && next.length > SCENE3D_LIMITS.maxKeyframes
}

export type ObjectPoseEditParams = {
  object: Scene3DObject
  channel: ObjectVectorChannel
  /** The SAMPLED value of this channel at `frame` — what the user is looking at. */
  sampled: Vec3
  axis: VectorAxis
  value: number
  frame: number
}

const AXIS_INDEX: Record<VectorAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }

/**
 * A `set-object` operation moving one axis of one channel so the pose CHANGES
 * at `frame`. `clampedValue` must already be inside the channel's bounds
 * (`clampChannelValue`), so this function only decides base-vs-keyframe.
 */
export function buildObjectPoseEdit(params: ObjectPoseEditParams & { clampedValue: number }): PoseEditPlan {
  const { object, channel, sampled, axis, clampedValue, frame } = params
  if (clampedValue === sampled[AXIS_INDEX[axis]]) return null

  const nextVector = withAxis(sampled, axis, clampedValue)
  const keyframes = keyframesOf(object)
  const animatable = ANIMATABLE_OBJECT_CHANNELS.has(channel)
  const mode = poseEditMode(keyframes, channel, frame, animatable)

  const changes: Scene3DObjectChanges = {}
  if (mode === "base") {
    changes[channel] = nextVector
  } else {
    const next = writeKeyframe(keyframes as ReadonlyArray<Scene3DObjectKeyframe>, channel, frame, nextVector, mode)
    if (overKeyframeCap(next)) return { ok: false, code: "keyframe_limit" }
    changes.keyframes = next as Scene3DObjectKeyframe[]
  }
  return { ok: true, operation: { op: "set-object", objectId: object.id, changes }, mode }
}

export type CameraPoseEditParams = {
  camera: Scene3DCamera
  channel: CameraVectorChannel
  sampled: Vec3
  axis: VectorAxis
  clampedValue: number
  frame: number
}

/** The camera's positional twin of `buildObjectPoseEdit`. */
export function buildCameraPoseEdit(params: CameraPoseEditParams): PoseEditPlan {
  const { camera, channel, sampled, axis, clampedValue, frame } = params
  if (clampedValue === sampled[AXIS_INDEX[axis]]) return null

  const nextVector = withAxis(sampled, axis, clampedValue)
  const keyframes = keyframesOf(camera)
  const mode = poseEditMode(keyframes, channel, frame, true)

  const changes: Scene3DCameraChanges = {}
  if (mode === "base") {
    changes[channel] = nextVector
  } else {
    const next = writeKeyframe(keyframes as ReadonlyArray<Scene3DCameraKeyframe>, channel, frame, nextVector, mode)
    if (overKeyframeCap(next)) return { ok: false, code: "keyframe_limit" }
    changes.keyframes = next as Scene3DCameraKeyframe[]
  }
  return { ok: true, operation: { op: "set-camera", changes }, mode }
}

/** Focal length is a scalar camera channel; same rule, no axis. */
export function buildCameraFocalPoseEdit(params: {
  camera: Scene3DCamera
  sampled: number
  clampedValue: number
  frame: number
}): PoseEditPlan {
  const { camera, sampled, clampedValue, frame } = params
  if (clampedValue === sampled) return null

  const keyframes = keyframesOf(camera)
  const mode = poseEditMode(keyframes, "focalLengthMm", frame, true)

  const changes: Scene3DCameraChanges = {}
  if (mode === "base") {
    changes.focalLengthMm = clampedValue
  } else {
    const next = writeKeyframe(keyframes as ReadonlyArray<Scene3DCameraKeyframe>, "focalLengthMm", frame, clampedValue, mode)
    if (overKeyframeCap(next)) return { ok: false, code: "keyframe_limit" }
    changes.keyframes = next as Scene3DCameraKeyframe[]
  }
  return { ok: true, operation: { op: "set-camera", changes }, mode }
}
