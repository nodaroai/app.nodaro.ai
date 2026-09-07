/**
 * The MODEL-FACING half of the Scene3D contract.
 *
 * `@nodaro/shared`'s `scene3DPlanSchema` is the wire contract: tuples, a
 * discriminated union of edit operations, server-assigned identity. None of
 * that survives a trip through `z.toJSONSchema` into a provider's constrained
 * decoder intact:
 *
 *  - `z.tuple` emits draft-7 positional `items: [...]`, which the Gemini
 *    `response_format` and OpenAI `text.format` lanes do not accept. A
 *    fixed-length `z.array(z.number()).length(3)` says the same thing in the
 *    subset every lane understands.
 *  - a discriminated union emits `anyOf`, which those same lanes handle
 *    unevenly. The draft operation is therefore FLAT — one `op` enum plus the
 *    optional fields each op uses — and is narrowed here, after the parse.
 *  - `revisionId` / `parentRevisionId` / `planType` / `schemaVersion` and the
 *    render timing (`width`, `height`, `fps`, `durationInFrames`) are NOT the
 *    model's to choose. The caller asked for a duration and an aspect ratio;
 *    the server stamps them and the identity, so a model that hallucinates a
 *    90-second scene cannot make one.
 *
 * Nothing here is a second source of truth for the shape: every draft is
 * converted and then handed to the SHARED validator, which is what actually
 * decides whether a scene is legal.
 */
import { z } from "zod"
import {
  SCENE3D_LIMITS,
  SCENE3D_PLAN_TYPE,
  SCENE3D_SCHEMA_VERSION,
  type Scene3DCamera,
  type Scene3DEditOperation,
  type Scene3DLighting,
  type Scene3DObject,
  type Scene3DPlanV1,
  type Scene3DReference,
  type Vec3,
} from "@nodaro/shared"

/** Fixed-length numeric array — the lane-portable spelling of `Vec3`. */
const draftVec3 = z.array(z.number()).length(3)

function toVec3(values: number[]): Vec3 {
  return [values[0], values[1], values[2]]
}

const draftEasing = z.enum(["linear", "easeInOut"])
const draftPrimitive = z.enum(["box", "sphere", "cylinder", "cone", "plane", "capsule", "group"])

const draftObjectKeyframe = z.object({
  frame: z.number().int().min(0),
  position: draftVec3.optional(),
  rotation: draftVec3.optional(),
  scale: draftVec3.optional(),
  easing: draftEasing.optional(),
})

const draftCameraKeyframe = z.object({
  frame: z.number().int().min(0),
  position: draftVec3.optional(),
  target: draftVec3.optional(),
  focalLengthMm: z.number().optional(),
  easing: draftEasing.optional(),
})

const draftObject = z.object({
  id: z.string(),
  name: z.string(),
  primitive: draftPrimitive,
  parentId: z.string().nullable().optional(),
  dimensions: draftVec3,
  position: draftVec3,
  rotation: draftVec3,
  scale: draftVec3,
  color: z.string(),
  keyframes: z.array(draftObjectKeyframe).max(SCENE3D_LIMITS.maxKeyframes).optional(),
})

const draftCamera = z.object({
  position: draftVec3,
  target: draftVec3,
  focalLengthMm: z.number(),
  keyframes: z.array(draftCameraKeyframe).max(SCENE3D_LIMITS.maxKeyframes).optional(),
})

const draftLighting = z.object({
  ambientIntensity: z.number(),
  keyIntensity: z.number(),
  keyPosition: draftVec3,
})

/** What `generate-3d-scene` asks the model for: the SCENE, never the timing. */
export const scene3DDraftPlanSchema = z.object({
  backgroundColor: z.string(),
  camera: draftCamera,
  objects: z.array(draftObject).min(1).max(SCENE3D_LIMITS.maxObjects),
  lighting: draftLighting,
})

export type Scene3DDraftPlan = z.infer<typeof scene3DDraftPlanSchema>

/** Flat on purpose — see the file header. Narrowed by `toEditOperation`. */
export const scene3DDraftOperationSchema = z.object({
  op: z.enum(["set-object", "add-object", "remove-object", "set-camera", "set-lighting", "set-background"]),
  objectId: z.string().optional(),
  object: draftObject.optional(),
  changes: draftObject.partial().optional(),
  camera: draftCamera.partial().optional(),
  lighting: draftLighting.partial().optional(),
  color: z.string().optional(),
})

export const scene3DDraftEditSchema = z.object({
  operations: z.array(scene3DDraftOperationSchema).min(1).max(SCENE3D_LIMITS.maxOperations),
  /** One sentence per change, in the user's language of the request. */
  changeSummary: z.string(),
})

export type Scene3DDraftEdit = z.infer<typeof scene3DDraftEditSchema>

// ---------------------------------------------------------------------------
// Draft → contract
// ---------------------------------------------------------------------------

function toObjectKeyframes(
  keyframes: readonly z.infer<typeof draftObjectKeyframe>[],
): Scene3DObject["keyframes"] {
  return keyframes.map((kf) => ({
    frame: kf.frame,
    ...(kf.position ? { position: toVec3(kf.position) } : {}),
    ...(kf.rotation ? { rotation: toVec3(kf.rotation) } : {}),
    ...(kf.scale ? { scale: toVec3(kf.scale) } : {}),
    ...(kf.easing ? { easing: kf.easing } : {}),
  }))
}

function toCameraKeyframes(
  keyframes: readonly z.infer<typeof draftCameraKeyframe>[],
): Scene3DCamera["keyframes"] {
  return keyframes.map((kf) => ({
    frame: kf.frame,
    ...(kf.position ? { position: toVec3(kf.position) } : {}),
    ...(kf.target ? { target: toVec3(kf.target) } : {}),
    ...(kf.focalLengthMm !== undefined ? { focalLengthMm: kf.focalLengthMm } : {}),
    ...(kf.easing ? { easing: kf.easing } : {}),
  }))
}

function toObject(draft: z.infer<typeof draftObject>): Scene3DObject {
  const object: Scene3DObject = {
    id: draft.id,
    name: draft.name,
    primitive: draft.primitive,
    dimensions: toVec3(draft.dimensions),
    position: toVec3(draft.position),
    rotation: toVec3(draft.rotation),
    scale: toVec3(draft.scale),
    color: draft.color,
  }
  if (draft.parentId) object.parentId = draft.parentId
  if (draft.keyframes && draft.keyframes.length > 0) {
    object.keyframes = toObjectKeyframes(draft.keyframes)
  }
  return object
}

function toCamera(draft: z.infer<typeof draftCamera>, sensorWidthMm: number): Scene3DCamera {
  return {
    position: toVec3(draft.position),
    target: toVec3(draft.target),
    focalLengthMm: draft.focalLengthMm,
    sensorWidthMm,
    ...(draft.keyframes && draft.keyframes.length > 0
      ? { keyframes: toCameraKeyframes(draft.keyframes) }
      : {}),
  }
}

function toLighting(draft: z.infer<typeof draftLighting>): Scene3DLighting {
  return {
    ambientIntensity: draft.ambientIntensity,
    keyIntensity: draft.keyIntensity,
    keyPosition: toVec3(draft.keyPosition),
  }
}

export interface Scene3DPlanFrame {
  revisionId: string
  parentRevisionId?: string
  width: number
  height: number
  fps: number
  durationInFrames: number
  references?: Scene3DReference[]
}

/**
 * Assemble a full plan from the model's scene and the SERVER's timing and
 * identity. The result is not trusted — the caller parses it with
 * `scene3DPlanSchema` and feeds any issue back to the model.
 */
export function draftToScene3DPlan(draft: Scene3DDraftPlan, frame: Scene3DPlanFrame): Scene3DPlanV1 {
  return {
    planType: SCENE3D_PLAN_TYPE,
    schemaVersion: SCENE3D_SCHEMA_VERSION,
    revisionId: frame.revisionId,
    ...(frame.parentRevisionId ? { parentRevisionId: frame.parentRevisionId } : {}),
    width: frame.width,
    height: frame.height,
    fps: frame.fps,
    durationInFrames: frame.durationInFrames,
    backgroundColor: draft.backgroundColor,
    camera: toCamera(draft.camera, SCENE3D_LIMITS.defaultSensorWidthMm),
    objects: draft.objects.map(toObject),
    lighting: toLighting(draft.lighting),
    ...(frame.references && frame.references.length > 0 ? { references: frame.references } : {}),
  }
}

export type OperationConversion =
  | { ok: true; operation: Scene3DEditOperation }
  | { ok: false; message: string }

/** Narrow ONE flat draft operation into the contract's discriminated union.
 *  A missing field for the chosen `op` is a message the retry loop can feed
 *  back to the model, not a thrown error. */
export function toEditOperation(draft: z.infer<typeof scene3DDraftOperationSchema>): OperationConversion {
  switch (draft.op) {
    case "set-object": {
      if (!draft.objectId) return { ok: false, message: '"set-object" needs an objectId' }
      if (!draft.changes) return { ok: false, message: '"set-object" needs a changes object' }
      const changes: Record<string, unknown> = {}
      if (draft.changes.name !== undefined) changes.name = draft.changes.name
      if (draft.changes.primitive !== undefined) changes.primitive = draft.changes.primitive
      if (draft.changes.parentId !== undefined) changes.parentId = draft.changes.parentId
      if (draft.changes.dimensions) changes.dimensions = toVec3(draft.changes.dimensions)
      if (draft.changes.position) changes.position = toVec3(draft.changes.position)
      if (draft.changes.rotation) changes.rotation = toVec3(draft.changes.rotation)
      if (draft.changes.scale) changes.scale = toVec3(draft.changes.scale)
      if (draft.changes.color !== undefined) changes.color = draft.changes.color
      if (draft.changes.keyframes) changes.keyframes = toObjectKeyframes(draft.changes.keyframes)
      if (Object.keys(changes).length === 0) return { ok: false, message: '"set-object" changed nothing' }
      return { ok: true, operation: { op: "set-object", objectId: draft.objectId, changes } as Scene3DEditOperation }
    }
    case "add-object": {
      if (!draft.object) return { ok: false, message: '"add-object" needs an object' }
      return { ok: true, operation: { op: "add-object", object: toObject(draft.object) } }
    }
    case "remove-object": {
      if (!draft.objectId) return { ok: false, message: '"remove-object" needs an objectId' }
      return { ok: true, operation: { op: "remove-object", objectId: draft.objectId } }
    }
    case "set-camera": {
      if (!draft.camera) return { ok: false, message: '"set-camera" needs a camera object' }
      const changes: Record<string, unknown> = {}
      if (draft.camera.position) changes.position = toVec3(draft.camera.position)
      if (draft.camera.target) changes.target = toVec3(draft.camera.target)
      if (draft.camera.focalLengthMm !== undefined) changes.focalLengthMm = draft.camera.focalLengthMm
      if (draft.camera.keyframes) changes.keyframes = toCameraKeyframes(draft.camera.keyframes)
      if (Object.keys(changes).length === 0) return { ok: false, message: '"set-camera" changed nothing' }
      return { ok: true, operation: { op: "set-camera", changes } as Scene3DEditOperation }
    }
    case "set-lighting": {
      if (!draft.lighting) return { ok: false, message: '"set-lighting" needs a lighting object' }
      const changes: Record<string, unknown> = {}
      if (draft.lighting.ambientIntensity !== undefined) changes.ambientIntensity = draft.lighting.ambientIntensity
      if (draft.lighting.keyIntensity !== undefined) changes.keyIntensity = draft.lighting.keyIntensity
      if (draft.lighting.keyPosition) changes.keyPosition = toVec3(draft.lighting.keyPosition)
      if (Object.keys(changes).length === 0) return { ok: false, message: '"set-lighting" changed nothing' }
      return { ok: true, operation: { op: "set-lighting", changes } as Scene3DEditOperation }
    }
    case "set-background": {
      if (!draft.color) return { ok: false, message: '"set-background" needs a color' }
      return { ok: true, operation: { op: "set-background", color: draft.color } }
    }
  }
}

export type OperationsConversion =
  | { ok: true; operations: Scene3DEditOperation[] }
  | { ok: false; message: string }

/** Narrow the whole list; the first bad entry names its index. */
export function toEditOperations(drafts: readonly z.infer<typeof scene3DDraftOperationSchema>[]): OperationsConversion {
  const operations: Scene3DEditOperation[] = []
  for (let index = 0; index < drafts.length; index++) {
    const converted = toEditOperation(drafts[index])
    if (!converted.ok) return { ok: false, message: `operations[${index}]: ${converted.message}` }
    operations.push(converted.operation)
  }
  return { ok: true, operations }
}
