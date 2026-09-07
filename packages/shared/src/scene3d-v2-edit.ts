/** Immutable, deterministic edits over a baked scene. No asset bytes are mutated. */
import { z } from "zod"
import {
  newScene3DRevisionId, rotationVec3Schema, scaleVec3Schema,
  scene3DColorSchema, scene3DIdSchema, vec3Schema,
} from "./scene3d.js"
import {
  SCENE3D_V2_OVERRIDE_OPERATION_VERSION, scene3DMaterialRoleSchema,
  type Scene3DEntityCapability, type Scene3DOverride, type Scene3DPlanV2,
} from "./scene3d-v2.js"
import { scene3DPlanV2Schema } from "./scene3d-v2-plan.js"
import { computeScene3DPlanV2ContentHash, verifyScene3DPlanV2ContentHash } from "./scene3d-v2-resources.js"

/** Callers describe values. Revision identity and provenance are assigned here. */
export const scene3DV2OverrideInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entity-transform"), entityId: scene3DIdSchema,
    space: z.enum(["local", "world"]), position: vec3Schema.optional(),
    rotation: rotationVec3Schema.optional(), scale: scaleVec3Schema.optional(),
  }).strict(),
  z.object({ kind: z.literal("entity-color"), entityId: scene3DIdSchema,
    materialRole: scene3DMaterialRoleSchema, color: scene3DColorSchema,
  }).strict(),
  z.object({ kind: z.literal("entity-visibility"), entityId: scene3DIdSchema, visible: z.boolean() }).strict(),
  z.object({ kind: z.literal("camera-shot-offset"), shotId: scene3DIdSchema,
    positionOffset: vec3Schema.optional(), targetOffset: vec3Schema.optional(),
  }).strict(),
])
export const scene3DV2EditOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set-override"), override: scene3DV2OverrideInputSchema }).strict(),
  z.object({ op: z.literal("remove-override"), overrideId: scene3DIdSchema }).strict(),
])
export const scene3DV2EditOperationsSchema = z.array(scene3DV2EditOperationSchema).min(1).max(100)
export type Scene3DV2OverrideInput = z.infer<typeof scene3DV2OverrideInputSchema>
export type Scene3DV2EditOperation = z.infer<typeof scene3DV2EditOperationSchema>

export interface Scene3DV2EditOptions {
  expectedRevisionId: string
  expectedContentHash?: string
  lockedObjectIds?: readonly string[]
  /** Hosts may allocate identity at admission for idempotent job replay. */
  newRevisionId?: string
}
export type Scene3DV2EditResult =
  | { ok: true; plan: Scene3DPlanV2; changeSummary: string }
  | { ok: false; code: "invalid_plan" | "invalid_operations" | "stale_revision" | "locked"; message: string }

function channel(override: Scene3DV2OverrideInput): string {
  switch (override.kind) {
    case "entity-transform": return `transform:${override.entityId}`
    case "entity-color": return `color:${override.entityId}:${override.materialRole}`
    case "entity-visibility": return `visibility:${override.entityId}`
    case "camera-shot-offset": return `camera:${override.shotId}`
  }
}
function capability(override: Scene3DV2OverrideInput): Scene3DEntityCapability | null {
  switch (override.kind) {
    case "entity-transform": return "transform"
    case "entity-color": return "color"
    case "entity-visibility": return "visibility"
    case "camera-shot-offset": return null
  }
}

/** A parent's transform or visibility changes its descendants too. */
function lockIssue(plan: Scene3DPlanV2, override: Scene3DV2OverrideInput, externalLocks: ReadonlySet<string>): string | null {
  if (override.kind === "camera-shot-offset") return null
  const target = plan.objects.find((o) => o.id === override.entityId)
  if (!target) return `Unknown entity: ${override.entityId}`
  const cap = capability(override)!
  if (target.capabilities && !target.capabilities.includes(cap)) return `Entity ${target.id} does not allow ${cap} edits`
  if (externalLocks.has(target.id) || target.locks?.includes(cap)) return `Entity ${target.id} is locked for ${cap}`
  if (cap !== "transform" && cap !== "visibility") return null
  const byId = new Map(plan.objects.map((entity) => [entity.id, entity]))
  for (const entity of plan.objects) {
    if (!externalLocks.has(entity.id) && !entity.locks?.includes(cap)) continue
    let parent = entity.parentId
    while (parent) {
      if (parent === target.id) return `Changing ${target.id} would change locked descendant ${entity.id}`
      parent = byId.get(parent)?.parentId
    }
  }
  return null
}

/**
 * Edits are all-or-nothing. The expected revision and content hash are checked
 * before writing, and the result is validated and hashed before acceptance.
 * A source file belongs to its exact base revision: until the host materializes
 * these edits, the new revision must not advertise the old native download.
 */
export async function applyScene3DV2EditOperations(
  input: Scene3DPlanV2,
  operations: readonly Scene3DV2EditOperation[],
  options: Scene3DV2EditOptions,
): Promise<Scene3DV2EditResult> {
  const parsed = scene3DPlanV2Schema.safeParse(input)
  if (!parsed.success) return { ok: false, code: "invalid_plan", message: parsed.error.issues[0]?.message ?? "Invalid scene" }
  const base = parsed.data as Scene3DPlanV2
  if (base.revisionId !== options.expectedRevisionId ||
      (options.expectedContentHash !== undefined && base.provenance.contentHash !== options.expectedContentHash)) {
    return { ok: false, code: "stale_revision", message: "The scene changed since this edit was prepared" }
  }
  if (!await verifyScene3DPlanV2ContentHash(base)) {
    return { ok: false, code: "invalid_plan", message: "The scene content does not match its digest" }
  }
  const ops = scene3DV2EditOperationsSchema.safeParse(operations)
  if (!ops.success) return { ok: false, code: "invalid_operations", message: ops.error.issues[0]?.message ?? "Invalid edit" }
  const revisionId = options.newRevisionId ?? newScene3DRevisionId()
  if (revisionId === base.revisionId) return { ok: false, code: "invalid_operations", message: "An edit requires a new revision identity" }
  const externalLocks = new Set(options.lockedObjectIds ?? [])
  for (const id of externalLocks) {
    if (!base.objects.some((entity) => entity.id === id)) return { ok: false, code: "invalid_operations", message: `Unknown locked entity: ${id}` }
  }
  let overrides = [...(base.overrides ?? [])]
  for (const [index, operation] of ops.data.entries()) {
    if (operation.op === "remove-override") {
      const existing = overrides.find((override) => override.id === operation.overrideId)
      if (!existing) return { ok: false, code: "invalid_operations", message: `Unknown override: ${operation.overrideId}` }
      const issue = lockIssue(base, existing, externalLocks)
      if (issue) return { ok: false, code: "locked", message: issue }
      overrides = overrides.filter((override) => override.id !== existing.id)
      continue
    }
    const issue = lockIssue(base, operation.override, externalLocks)
    if (issue) return { ok: false, code: "locked", message: issue }
    const previous = overrides.find((override) => channel(override) === channel(operation.override))
    const compatible = previous && (previous.kind !== "entity-transform" ||
      (operation.override.kind === "entity-transform" && previous.space === operation.override.space))
    const next: Scene3DOverride = {
      ...(compatible ? previous : {}),
      ...operation.override,
      id: `edit-${revisionId}-${index}`,
      sourceRevisionId: base.revisionId,
      sourceContentHash: base.provenance.contentHash,
      operationVersion: SCENE3D_V2_OVERRIDE_OPERATION_VERSION,
    }
    const key = channel(next)
    overrides = [...overrides.filter((override) => channel(override) !== key), next]
  }
  const { sourceArtifactId: _sourceArtifactId, ...provenance } = base.provenance
  const next: Scene3DPlanV2 = {
    ...base, revisionId, parentRevisionId: base.revisionId,
    // Geometry and cameras are reused; derived images, validation and native
    // exports describe the old revision until regenerated for these overlays.
    assets: base.assets.filter((asset) => asset.kind === "glb" || asset.kind === "camera-track-json").map((asset) => ({
      ...asset, originRevisionId: asset.originRevisionId ?? base.revisionId,
    })),
    overrides,
    provenance: { ...provenance, sourceRevisionId: base.revisionId },
  }
  const validated = scene3DPlanV2Schema.safeParse(next)
  if (!validated.success) return { ok: false, code: "invalid_operations", message: validated.error.issues[0]?.message ?? "Invalid edited scene" }
  const plan = validated.data as Scene3DPlanV2
  const contentHash = await computeScene3DPlanV2ContentHash(plan)
  return { ok: true, plan: { ...plan, provenance: { ...plan.provenance, contentHash } }, changeSummary: `Applied ${ops.data.length} scene edit${ops.data.length === 1 ? "" : "s"}` }
}
