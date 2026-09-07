/**
 * Bounds and builders for the deterministic `Scene3DEditOperation`s the canvas
 * emits.
 *
 * The panel's numeric controls do NOT hand-patch the plan. Every nudge becomes
 * an operation from the SAME vocabulary the API's `POST /v1/3d-scene/edit`
 * accepts, so a change made by dragging a number and the identical change made
 * by an agent, the SDK or a saved workflow all travel one code path and are
 * validated by one schema.
 *
 * These builders describe an operation, they never apply it. Application (and
 * the new revision id that comes with it) is `applyScene3DEditOperations`' job
 * — see `apply-local-edit.ts`. Deciding WHERE a transform edit lands (the base
 * value or a keyframe at the current frame) is `pose-edit.ts`' job.
 *
 * Every bound below is read from the shared `SCENE3D_LIMITS` rather than
 * restated, so the canvas can never let a user type a value the route's Zod
 * would 400 on — and can never quietly stay behind when a limit moves.
 */
import { SCENE3D_LIMITS } from "@nodaro/shared"
import type { Scene3DEditOperation } from "@nodaro/shared"
import type { Vec3 } from "./plan-view"

/** The wire operation union, straight from the shared contract. */
export type Scene3DEditOperationLike = Scene3DEditOperation

/** The per-object transform channels the numeric editor exposes. */
export type ObjectVectorChannel = "position" | "rotation" | "scale" | "dimensions"

/** The camera vectors the numeric editor exposes. */
export type CameraVectorChannel = "position" | "target"

export const VECTOR_AXES = ["x", "y", "z"] as const
export type VectorAxis = (typeof VECTOR_AXES)[number]

/**
 * Radians. The shared schema bounds rotation at ±1000 (so a runaway value
 * cannot reach the renderer); the canvas is deliberately TIGHTER — two turns
 * either way is the whole useful authoring range for a spin box, and a tighter
 * client bound can only ever produce values the schema accepts.
 */
export const ROTATION_LIMIT = Math.PI * 4

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return value < min ? min : value > max ? max : value
}

/** Clamp one axis of a channel to the range that channel accepts. */
export function clampChannelValue(channel: ObjectVectorChannel, value: number): number {
  switch (channel) {
    case "dimensions":
      return clamp(value, SCENE3D_LIMITS.minSize, SCENE3D_LIMITS.maxSize)
    case "scale":
      return clamp(value, SCENE3D_LIMITS.minScale, SCENE3D_LIMITS.maxScale)
    case "rotation":
      return clamp(value, -ROTATION_LIMIT, ROTATION_LIMIT)
    default:
      return clamp(value, -SCENE3D_LIMITS.maxCoordinate, SCENE3D_LIMITS.maxCoordinate)
  }
}

/** Clamp a camera position/target coordinate. */
export function clampCoordinate(value: number): number {
  return clamp(value, -SCENE3D_LIMITS.maxCoordinate, SCENE3D_LIMITS.maxCoordinate)
}

/** Clamp a focal length to the lens range the schema accepts. */
export function clampFocalLength(value: number): number {
  return clamp(value, SCENE3D_LIMITS.minFocalLengthMm, SCENE3D_LIMITS.maxFocalLengthMm)
}

const AXIS_INDEX: Record<VectorAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }

/** Replace one axis of a vector, returning a NEW triple (never mutates). */
export function withAxis(vector: Vec3, axis: VectorAxis, value: number): Vec3 {
  const next: Vec3 = [vector[0], vector[1], vector[2]]
  next[AXIS_INDEX[axis]] = value
  return next
}

/** A `set-object` operation changing the object's colour. Colour has no
 *  keyframe track, so it is always a plain plan edit. */
export function buildObjectColorOperation(objectId: string, color: string, current: string): Scene3DEditOperationLike | null {
  if (color === current) return null
  return { op: "set-object", objectId, changes: { color } }
}

/** A `set-background` operation. */
export function buildBackgroundOperation(color: string, current: string): Scene3DEditOperationLike | null {
  if (color === current) return null
  return { op: "set-background", color }
}

/** A `remove-object` operation. */
export function buildRemoveObjectOperation(objectId: string): Scene3DEditOperationLike {
  return { op: "remove-object", objectId }
}
