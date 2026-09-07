/**
 * Scene3D edit operations — the ONLY way a Scene3D plan changes.
 *
 * Split out of `scene3d.ts` (which owns the shape) because this file owns the
 * TRANSITION: given a plan, a list of operations and the caller's locks, it
 * produces the next immutable revision or an explained refusal. Both edit
 * lanes go through it — the deterministic one (the caller sent operations) and
 * the instruction one (an LLM authored the operations from a sentence) — so
 * locks, staleness and whole-scene validation cannot be enforced twice and
 * differently. The model never writes a plan and never writes code; it writes
 * operations that this function is free to refuse.
 */
import { z } from "zod"
import {
  SCENE3D_LIMITS,
  newScene3DRevisionId,
  rotationVec3Schema,
  scaleVec3Schema,
  scene3DCameraKeyframeSchema,
  scene3DColorSchema,
  scene3DDeepEqual,
  scene3DIdSchema,
  scene3DObjectKeyframeSchema,
  scene3DObjectSchema,
  scene3DPlanV1Schema,
  scene3DPrimitiveSchema,
  sizeVec3Schema,
  vec3Schema,
  type Scene3DObject,
  type Scene3DPlanV1,
} from "./scene3d.js"


/** Everything about an object EXCEPT its identity. `id` is deliberately absent
 *  (and the schema is strict) so no operation can rename an object out from
 *  under a lock, a parent link or a reference. */
export const scene3DObjectChangesSchema = z
  .object({
    name: z.string().min(1).max(SCENE3D_LIMITS.maxNameLength).optional(),
    primitive: scene3DPrimitiveSchema.optional(),
    /** `null` detaches from the parent; omitted leaves it as-is. */
    parentId: scene3DIdSchema.nullable().optional(),
    dimensions: sizeVec3Schema.optional(),
    position: vec3Schema.optional(),
    rotation: rotationVec3Schema.optional(),
    scale: scaleVec3Schema.optional(),
    color: scene3DColorSchema.optional(),
    keyframes: z.array(scene3DObjectKeyframeSchema).max(SCENE3D_LIMITS.maxKeyframes).optional(),
  })
  .strict()

export const scene3DCameraChangesSchema = z
  .object({
    position: vec3Schema.optional(),
    target: vec3Schema.optional(),
    focalLengthMm: z
      .number()
      .min(SCENE3D_LIMITS.minFocalLengthMm)
      .max(SCENE3D_LIMITS.maxFocalLengthMm)
      .optional(),
    sensorWidthMm: z
      .number()
      .min(SCENE3D_LIMITS.minSensorWidthMm)
      .max(SCENE3D_LIMITS.maxSensorWidthMm)
      .optional(),
    keyframes: z.array(scene3DCameraKeyframeSchema).max(SCENE3D_LIMITS.maxKeyframes).optional(),
  })
  .strict()

export const scene3DLightingChangesSchema = z
  .object({
    ambientIntensity: z.number().min(0).max(SCENE3D_LIMITS.maxIntensity).optional(),
    keyIntensity: z.number().min(0).max(SCENE3D_LIMITS.maxIntensity).optional(),
    keyPosition: vec3Schema.optional(),
  })
  .strict()

export const scene3DEditOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set-object"), objectId: scene3DIdSchema, changes: scene3DObjectChangesSchema }).strict(),
  z.object({ op: z.literal("add-object"), object: scene3DObjectSchema }).strict(),
  z.object({ op: z.literal("remove-object"), objectId: scene3DIdSchema }).strict(),
  z.object({ op: z.literal("set-camera"), changes: scene3DCameraChangesSchema }).strict(),
  z.object({ op: z.literal("set-lighting"), changes: scene3DLightingChangesSchema }).strict(),
  z.object({ op: z.literal("set-background"), color: scene3DColorSchema }).strict(),
])

export const scene3DEditOperationsSchema = z
  .array(scene3DEditOperationSchema)
  .min(1)
  .max(SCENE3D_LIMITS.maxOperations)

export type Scene3DObjectChanges = z.infer<typeof scene3DObjectChangesSchema>
export type Scene3DCameraChanges = z.infer<typeof scene3DCameraChangesSchema>
export type Scene3DLightingChanges = z.infer<typeof scene3DLightingChangesSchema>
export type Scene3DEditOperation = z.infer<typeof scene3DEditOperationSchema>

export type Scene3DEditErrorCode =
  /** `expectedRevisionId` did not match the plan handed in. */
  | "stale_revision"
  /** The operation list itself is malformed or over the cap. */
  | "invalid_operations"
  /** An operation targets an object that is not in the scene. */
  | "unknown_object"
  /** `add-object` collided with an existing id. */
  | "duplicate_object"
  /** An operation touched an id the caller declared locked. */
  | "locked_object"
  /** The plan handed in, or the plan the operations produced, is invalid. */
  | "invalid_plan"

export interface Scene3DEditOptions {
  /** Optimistic concurrency: reject unless the plan is still this revision. */
  expectedRevisionId?: string
  /** Object ids the caller declared untouchable. Enforced as a POST-condition
   *  (see `applyScene3DEditOperations`), which is what makes it total. */
  lockedObjectIds?: readonly string[]
  /** Pin the produced revision id — tests and deterministic replay only. */
  revisionId?: string
}

export type Scene3DEditResult =
  | { ok: true; plan: Scene3DPlanV1; changedObjectIds: string[]; changeSummary: string }
  | { ok: false; code: Scene3DEditErrorCode; message: string; operationIndex?: number }

/** Structural clone that cannot share a reference with its input. `structured-
 *  Clone` is not available in every consumer runtime we ship to, and a plan is
 *  pure JSON by construction. */
function clonePlan(plan: Scene3DPlanV1): Scene3DPlanV1 {
  return JSON.parse(JSON.stringify(plan)) as Scene3DPlanV1
}

/** One human sentence per operation — the deterministic lane's answer to the
 *  LLM lane's `changeSummary`, so both edit paths return the same shape. */
export function summarizeScene3DOperations(operations: readonly Scene3DEditOperation[]): string {
  const lines = operations.map((operation) => {
    switch (operation.op) {
      case "set-object": {
        const fields = Object.keys(operation.changes)
        return `Updated ${fields.length > 0 ? fields.join(", ") : "nothing"} on "${operation.objectId}"`
      }
      case "add-object":
        return `Added ${operation.object.primitive} "${operation.object.name}" (${operation.object.id})`
      case "remove-object":
        return `Removed "${operation.objectId}"`
      case "set-camera":
        return `Updated camera ${Object.keys(operation.changes).join(", ") || "nothing"}`
      case "set-lighting":
        return `Updated lighting ${Object.keys(operation.changes).join(", ") || "nothing"}`
      case "set-background":
        return `Set background to ${operation.color}`
    }
  })
  return lines.join("; ").slice(0, SCENE3D_LIMITS.maxChangeSummaryLength)
}

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return "invalid"
  const path = issue.path.join(".")
  return path ? `${path}: ${issue.message}` : issue.message
}

/**
 * Apply an operation list to a plan, producing a NEW revision.
 *
 * Guarantees, in this order — each one is a distinct failure mode that was
 * cheap to get wrong:
 *
 * 1. The input plan is never mutated (deep clone before the first write).
 * 2. A stale `expectedRevisionId` is refused before anything is applied, so a
 *    late async completion can never overwrite a newer manual edit.
 * 3. Operations are schema-validated as a list; the failing INDEX is reported.
 * 4. Locks are enforced as a POST-CONDITION — every locked object must still
 *    exist and be deep-equal to the original. Reasoning per-operation would
 *    have to anticipate remove + re-add, a reparent from a sibling's `set-
 *    object`, and whatever the next operation kind turns out to be; the
 *    post-condition covers all of them by construction. (`selectedObjectIds`
 *    is CONTEXT for the model, never permission — the caller passes locks
 *    explicitly and they are checked here, after the model has spoken.)
 * 5. The WHOLE resulting plan is re-validated, which is what makes "no silent
 *    orphaning" free: removing a parent leaves a dangling `parentId` and the
 *    plan validator rejects it, as does removing an object a reference points
 *    at.
 */
export function applyScene3DEditOperations(
  plan: Scene3DPlanV1,
  operations: readonly Scene3DEditOperation[] | unknown,
  options: Scene3DEditOptions = {},
): Scene3DEditResult {
  const parsedPlan = scene3DPlanV1Schema.safeParse(plan)
  if (!parsedPlan.success) {
    return { ok: false, code: "invalid_plan", message: `scenePlan is invalid — ${firstIssueMessage(parsedPlan.error)}` }
  }
  const source = parsedPlan.data as Scene3DPlanV1

  if (options.expectedRevisionId !== undefined && options.expectedRevisionId !== source.revisionId) {
    return {
      ok: false,
      code: "stale_revision",
      message: `This scene has moved on — expected revision ${options.expectedRevisionId}, the plan is at ${source.revisionId}.`,
    }
  }

  const parsedOps = scene3DEditOperationsSchema.safeParse(operations)
  if (!parsedOps.success) {
    const issue = parsedOps.error.issues[0]
    const index = typeof issue?.path[0] === "number" ? (issue.path[0] as number) : undefined
    return {
      ok: false,
      code: "invalid_operations",
      message: `operations are invalid — ${firstIssueMessage(parsedOps.error)}`,
      ...(index === undefined ? {} : { operationIndex: index }),
    }
  }
  const ops = parsedOps.data

  const next = clonePlan(source)
  const changed = new Set<string>()

  for (let index = 0; index < ops.length; index++) {
    const operation = ops[index]
    switch (operation.op) {
      case "set-object": {
        const target = next.objects.findIndex((o) => o.id === operation.objectId)
        if (target === -1) {
          return {
            ok: false,
            code: "unknown_object",
            message: `no object "${operation.objectId}" in this scene`,
            operationIndex: index,
          }
        }
        const { parentId, ...rest } = operation.changes
        const updated: Scene3DObject = { ...next.objects[target], ...rest }
        if (parentId !== undefined) {
          if (parentId === null) delete updated.parentId
          else updated.parentId = parentId
        }
        next.objects = next.objects.map((o, i) => (i === target ? updated : o))
        changed.add(operation.objectId)
        break
      }
      case "add-object": {
        if (next.objects.some((o) => o.id === operation.object.id)) {
          return {
            ok: false,
            code: "duplicate_object",
            message: `an object with id "${operation.object.id}" already exists`,
            operationIndex: index,
          }
        }
        next.objects = [...next.objects, operation.object as Scene3DObject]
        changed.add(operation.object.id)
        break
      }
      case "remove-object": {
        if (!next.objects.some((o) => o.id === operation.objectId)) {
          return {
            ok: false,
            code: "unknown_object",
            message: `no object "${operation.objectId}" in this scene`,
            operationIndex: index,
          }
        }
        next.objects = next.objects.filter((o) => o.id !== operation.objectId)
        changed.add(operation.objectId)
        break
      }
      case "set-camera":
        next.camera = { ...next.camera, ...operation.changes }
        break
      case "set-lighting":
        next.lighting = { ...next.lighting, ...operation.changes }
        break
      case "set-background":
        next.backgroundColor = operation.color
        break
    }
  }

  for (const lockedId of options.lockedObjectIds ?? []) {
    const before = source.objects.find((o) => o.id === lockedId)
    const after = next.objects.find((o) => o.id === lockedId)
    if (before === undefined) continue // not in the scene to begin with — nothing to protect
    if (after === undefined) {
      return { ok: false, code: "locked_object", message: `object "${lockedId}" is locked and cannot be removed` }
    }
    if (!scene3DDeepEqual(before, after)) {
      return { ok: false, code: "locked_object", message: `object "${lockedId}" is locked and cannot be modified` }
    }
  }

  next.parentRevisionId = source.revisionId
  next.revisionId = options.revisionId ?? newScene3DRevisionId()

  const validated = scene3DPlanV1Schema.safeParse(next)
  if (!validated.success) {
    return {
      ok: false,
      code: "invalid_plan",
      message: `the edit would leave the scene invalid — ${firstIssueMessage(validated.error)}`,
    }
  }

  return {
    ok: true,
    plan: validated.data as Scene3DPlanV1,
    changedObjectIds: [...changed],
    changeSummary: summarizeScene3DOperations(ops),
  }
}
