/**
 * Scene3D renderer types.
 *
 * The wire contract itself lives in `@nodaro/shared` (packages/shared/src/scene3d.ts)
 * and is the single source of truth — this module only DERIVES the sub-shapes the
 * renderer needs from the three exports the frozen spec guarantees
 * (`Scene3DPlan`, `Scene3DObject`, `Scene3DReference`). Nothing here re-declares a
 * field, so a contract change surfaces as a type error rather than as silent drift.
 */
import type { Scene3DPlan, Scene3DObject, Scene3DReference } from "@nodaro/shared"

export type { Scene3DPlan, Scene3DObject, Scene3DReference }

/** World-space triple. Meters, Y-up. Rotations are Euler radians in XYZ order. */
export type Vec3 = [number, number, number]

export type Scene3DCamera = Scene3DPlan["camera"]
export type Scene3DLighting = Scene3DPlan["lighting"]
export type Scene3DPrimitive = Scene3DObject["primitive"]
export type Scene3DObjectKeyframe = NonNullable<Scene3DObject["keyframes"]>[number]
export type Scene3DCameraKeyframe = NonNullable<Scene3DCamera["keyframes"]>[number]
export type Scene3DEasing = NonNullable<Scene3DObjectKeyframe["easing"]>

/** Sensor width assumed when a plan omits it (35mm full frame). */
export const DEFAULT_SENSOR_WIDTH_MM = 36
