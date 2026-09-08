/**
 * The Scene3D v2 PLAN: whole-manifest schema, every cross-field rule, and the
 * V1|V2 union the rest of the platform reads.
 *
 * `scene3d-v2.ts` says what a v2 entity, asset, shot or override looks like on
 * its own. Nothing there can catch the failures that actually reach a renderer,
 * because every one of them is a relationship:
 *
 * - an entity whose GLB is not in `assets`, or two entities claiming the same
 *   exported root node;
 * - a parent chain that loops, or nests deeper than the transform walk allows;
 * - shots with a one-frame gap, so some frame belongs to no shot at all;
 * - a colour override naming a material role its entity never declared — the
 *   bug where recolouring a person also repaints its chair;
 * - two overrides driving one channel, or one driving a locked entity;
 * - declared asset bytes over the download budget.
 *
 * All of it runs in `scene3DPlanV2Issues`, which the schema calls from a
 * `superRefine` and a caller holding an already-parsed plan can call directly —
 * the same split v1 uses, so both versions report failures identically.
 */
import { z } from "zod"
import {
  SCENE3D_ASSET_ROLE_KINDS,
  SCENE3D_DEFAULT_ENTITY_CAPABILITIES,
  SCENE3D_ENTITY_CAPABILITIES,
  SCENE3D_PRIMITIVE_MATERIAL_ROLE,
  SCENE3D_RENDERER_ASSET_KINDS,
  SCENE3D_SCHEMA_VERSION_V2,
  SCENE3D_SUPPORTED_SCHEMA_VERSIONS,
  SCENE3D_V2_ENGINES,
  SCENE3D_V2_LIMITS,
  SCENE3D_V2_OVERRIDE_OPERATION_VERSION,
  scene3DAssetIdSchema,
  scene3DAssetRefSchema,
  scene3DClayLightingSchema,
  scene3DEntityV2Schema,
  scene3DOverrideSchema,
  scene3DProvenanceSchema,
  scene3DShotSchema,
  type Scene3DAssetRef,
  type Scene3DEntityCapability,
  type Scene3DEntityV2,
  type Scene3DKnownEngine,
  type Scene3DPlanV2,
  type Scene3DShot,
  type Scene3DSupportedSchemaVersion,
} from "./scene3d-v2.js"
import {
  SCENE3D_PLAN_TYPE,
  scene3DColorSchema,
  scene3DPlanV1Issues,
  scene3DPlanV1ObjectSchema,
  scene3DReferenceSchema,
  type Scene3DPlanV1,
  type Scene3DSemanticIssue,
} from "./scene3d.js"

/** THE plan type. Narrow with `isScene3DPlanV1` / `isScene3DPlanV2` before
 *  reading version-specific fields. */
export type Scene3DPlan = Scene3DPlanV1 | Scene3DPlanV2

export interface Scene3DJobOutputV2 {
  scenePlan: Scene3DPlanV2
  changeSummary?: string
}

/** Job output when either version may come back. */
export interface Scene3DJobOutputAny {
  scenePlan: Scene3DPlan
  changeSummary?: string
}

// ---------------------------------------------------------------------------
// Semantic (cross-field) validation
// ---------------------------------------------------------------------------

type Issue = Scene3DSemanticIssue

function entityCapabilities(entity: Scene3DEntityV2): readonly Scene3DEntityCapability[] {
  return entity.capabilities ?? SCENE3D_DEFAULT_ENTITY_CAPABILITIES
}

/** An overlay is accepted iff the entity advertises the capability AND has not
 *  frozen it. One rule, checked in exactly one place. */
export function scene3DEntityAcceptsOverlay(
  entity: Scene3DEntityV2,
  capability: Scene3DEntityCapability,
): boolean {
  return entityCapabilities(entity).includes(capability) && !(entity.locks ?? []).includes(capability)
}

function checkEntities(plan: Scene3DPlanV2, byId: Map<string, Scene3DEntityV2>, issues: Issue[]): void {
  const rootNodeOwners = new Map<string, string>()

  plan.objects.forEach((entity, index) => {
    const at = (...rest: (string | number)[]) => ["objects", index, ...rest]

    if (entity.visual.kind !== "asset") {
      // A group/primitive with no transform has no defined place in the world;
      // an asset entity gets its transform from its GLB node instead.
      for (const field of ["position", "rotation", "scale"] as const) {
        if (entity[field] === undefined) {
          issues.push({
            path: at(field),
            message: `entity "${entity.id}" is a ${entity.visual.kind} and must declare ${field}`,
          })
        }
      }
    }

    if (entity.visual.kind === "asset") {
      const owner = rootNodeOwners.get(entity.visual.rootNodeId)
      if (owner !== undefined) {
        issues.push({
          path: at("visual", "rootNodeId"),
          message: `root node "${entity.visual.rootNodeId}" is already the root of entity "${owner}"`,
        })
      } else {
        rootNodeOwners.set(entity.visual.rootNodeId, entity.id)
      }

      const animation = entity.visual.animation
      if (animation) {
        if (animation.endFrameExclusive <= animation.startFrame) {
          issues.push({
            path: at("visual", "animation", "endFrameExclusive"),
            message: `entity "${entity.id}" animation ends at or before it starts`,
          })
        }
        if (animation.endFrameExclusive > plan.durationInFrames) {
          issues.push({
            path: at("visual", "animation", "endFrameExclusive"),
            message: `entity "${entity.id}" animation runs past the scene (${plan.durationInFrames} frames)`,
          })
        }
      }
    } else if (entity.materialBindings && entity.materialBindings.length > 0) {
      issues.push({
        path: at("materialBindings"),
        message: `entity "${entity.id}" is a ${entity.visual.kind}; material bindings name materials in an asset root`,
      })
    }

    const roles = new Set<string>()
    ;(entity.materialBindings ?? []).forEach((binding, bindingIndex) => {
      if (roles.has(binding.role)) {
        issues.push({
          path: at("materialBindings", bindingIndex, "role"),
          message: `entity "${entity.id}" binds material role "${binding.role}" twice`,
        })
      }
      roles.add(binding.role)
    })

    const anchorNames = new Set<string>()
    ;(entity.anchors ?? []).forEach((anchor, anchorIndex) => {
      if (anchorNames.has(anchor.name)) {
        issues.push({
          path: at("anchors", anchorIndex, "name"),
          message: `entity "${entity.id}" declares anchor "${anchor.name}" twice`,
        })
      }
      anchorNames.add(anchor.name)
    })
  })

  // Hierarchy: resolvable, acyclic and bounded.
  plan.objects.forEach((entity, index) => {
    if (entity.parentId === undefined) return
    if (entity.parentId === entity.id) {
      issues.push({ path: ["objects", index, "parentId"], message: `entity "${entity.id}" cannot parent itself` })
      return
    }
    if (!byId.has(entity.parentId)) {
      issues.push({
        path: ["objects", index, "parentId"],
        message: `entity "${entity.id}" references unknown parent "${entity.parentId}"`,
      })
      return
    }
    const seen = new Set<string>([entity.id])
    let cursor: Scene3DEntityV2 | undefined = byId.get(entity.parentId)
    let depth = 1
    while (cursor) {
      if (seen.has(cursor.id)) {
        issues.push({ path: ["objects", index, "parentId"], message: `parent cycle through entity "${cursor.id}"` })
        break
      }
      seen.add(cursor.id)
      depth += 1
      if (depth > SCENE3D_V2_LIMITS.maxHierarchyDepth) {
        issues.push({
          path: ["objects", index, "parentId"],
          message: `hierarchy deeper than ${SCENE3D_V2_LIMITS.maxHierarchyDepth} levels`,
        })
        break
      }
      cursor = cursor.parentId === undefined ? undefined : byId.get(cursor.parentId)
    }
  })
}

function checkAssets(
  plan: Scene3DPlanV2,
  assetsById: Map<string, Scene3DAssetRef>,
  issues: Issue[],
): void {
  let rendererBytes = 0
  let sourceCount = 0

  plan.assets.forEach((asset, index) => {
    const at = (...rest: (string | number)[]) => ["assets", index, ...rest]

    const expectedKind = SCENE3D_ASSET_ROLE_KINDS[asset.role]
    if (asset.kind !== expectedKind) {
      issues.push({
        path: at("kind"),
        message: `asset "${asset.assetId}" has role "${asset.role}", which requires kind "${expectedKind}" (got "${asset.kind}")`,
      })
    }
    if (asset.kind === "camera-track-json" && asset.byteLength > SCENE3D_V2_LIMITS.maxCameraTrackBytes) {
      issues.push({
        path: at("byteLength"),
        message: `camera track "${asset.assetId}" is ${asset.byteLength} bytes; the limit is ${SCENE3D_V2_LIMITS.maxCameraTrackBytes}`,
      })
    }
    if (SCENE3D_RENDERER_ASSET_KINDS.includes(asset.kind)) {
      rendererBytes += asset.byteLength
      if (asset.byteLength > SCENE3D_V2_LIMITS.maxRendererAssetBytes) {
        issues.push({
          path: at("byteLength"),
          message: `asset "${asset.assetId}" is ${asset.byteLength} bytes; a downloaded scene asset may not exceed ${SCENE3D_V2_LIMITS.maxRendererAssetBytes}`,
        })
      }
    }
    if (asset.kind === "blend-source") {
      sourceCount += 1
      if (sourceCount > 1) {
        issues.push({ path: at("kind"), message: "a revision may retain at most one blend-source asset" })
      }
    }
  })

  if (rendererBytes > SCENE3D_V2_LIMITS.maxRendererAssetBytes) {
    issues.push({
      path: ["assets"],
      message: `downloaded scene assets total ${rendererBytes} bytes; the limit is ${SCENE3D_V2_LIMITS.maxRendererAssetBytes}`,
    })
  }

  const track = assetsById.get(plan.cameraTrackAssetId)
  if (!track) {
    issues.push({
      path: ["cameraTrackAssetId"],
      message: `cameraTrackAssetId "${plan.cameraTrackAssetId}" is not in assets`,
    })
  } else if (track.kind !== "camera-track-json") {
    issues.push({
      path: ["cameraTrackAssetId"],
      message: `cameraTrackAssetId "${plan.cameraTrackAssetId}" is kind "${track.kind}"; a camera track must be camera-track-json`,
    })
  }

  // Every GLB must be reachable from an entity: an unreferenced one is dead
  // weight the renderer would download for nothing.
  const referencedGlbs = new Set<string>()
  for (const entity of plan.objects) {
    if (entity.visual.kind === "asset") referencedGlbs.add(entity.visual.assetId)
  }
  plan.assets.forEach((asset, index) => {
    if (asset.kind === "glb" && !referencedGlbs.has(asset.assetId)) {
      issues.push({
        path: ["assets", index, "assetId"],
        message: `glb asset "${asset.assetId}" is not referenced by any entity`,
      })
    }
  })

  // ...and every entity asset reference must resolve to a GLB.
  plan.objects.forEach((entity, index) => {
    if (entity.visual.kind !== "asset") return
    const asset = assetsById.get(entity.visual.assetId)
    if (!asset) {
      issues.push({
        path: ["objects", index, "visual", "assetId"],
        message: `entity "${entity.id}" references unknown asset "${entity.visual.assetId}"`,
      })
    } else if (asset.kind !== "glb") {
      issues.push({
        path: ["objects", index, "visual", "assetId"],
        message: `entity "${entity.id}" references asset "${asset.assetId}" of kind "${asset.kind}"; geometry must be glb`,
      })
    }
  })

  if (plan.provenance.sourceArtifactId !== undefined) {
    const source = assetsById.get(plan.provenance.sourceArtifactId)
    if (!source) {
      issues.push({
        path: ["provenance", "sourceArtifactId"],
        message: `sourceArtifactId "${plan.provenance.sourceArtifactId}" is not in assets`,
      })
    } else if (source.kind !== "blend-source") {
      issues.push({
        path: ["provenance", "sourceArtifactId"],
        message: `sourceArtifactId "${source.assetId}" is kind "${source.kind}"; a retained source must be blend-source`,
      })
    }
  }
}

function checkShots(plan: Scene3DPlanV2, byId: Map<string, Scene3DEntityV2>, issues: Issue[]): void {
  const seenIds = new Set<string>()
  let expectedStart = 0

  plan.shots.forEach((shot, index) => {
    const at = (...rest: (string | number)[]) => ["shots", index, ...rest]

    if (seenIds.has(shot.id)) {
      issues.push({ path: at("id"), message: `duplicate shot id "${shot.id}"` })
    }
    seenIds.add(shot.id)

    if (shot.endFrameExclusive <= shot.startFrame) {
      issues.push({
        path: at("endFrameExclusive"),
        message: `shot "${shot.id}" ends at or before it starts (${shot.startFrame}..${shot.endFrameExclusive})`,
      })
    }
    if (shot.startFrame !== expectedStart) {
      issues.push({
        path: at("startFrame"),
        message:
          index === 0
            ? `shots must start at frame 0 (got ${shot.startFrame})`
            : `shot "${shot.id}" starts at ${shot.startFrame}; the previous shot ends at ${expectedStart} — every frame belongs to exactly one shot`,
      })
    }
    expectedStart = Math.max(expectedStart, shot.endFrameExclusive)

    for (const field of ["subjectEntityIds", "foregroundEntityIds"] as const) {
      ;(shot[field] ?? []).forEach((entityId, entityIndex) => {
        if (!byId.has(entityId)) {
          issues.push({
            path: at(field, entityIndex),
            message: `shot "${shot.id}" references unknown entity "${entityId}"`,
          })
        }
      })
    }
  })

  const last = plan.shots[plan.shots.length - 1]
  if (last && last.endFrameExclusive !== plan.durationInFrames) {
    issues.push({
      path: ["shots", plan.shots.length - 1, "endFrameExclusive"],
      message: `shots end at frame ${last.endFrameExclusive}; the scene is ${plan.durationInFrames} frames and must be covered completely`,
    })
  }
}

function checkOverrides(
  plan: Scene3DPlanV2,
  byId: Map<string, Scene3DEntityV2>,
  shotIds: Set<string>,
  issues: Issue[],
): void {
  const overrideIds = new Set<string>()
  const transformTargets = new Set<string>()
  const visibilityTargets = new Set<string>()
  const colorTargets = new Set<string>()
  const offsetTargets = new Set<string>()

  ;(plan.overrides ?? []).forEach((override, index) => {
    const at = (...rest: (string | number)[]) => ["overrides", index, ...rest]

    if (overrideIds.has(override.id)) {
      issues.push({ path: at("id"), message: `duplicate override id "${override.id}"` })
    }
    overrideIds.add(override.id)

    if (override.operationVersion > SCENE3D_V2_OVERRIDE_OPERATION_VERSION) {
      issues.push({
        path: at("operationVersion"),
        message: `override "${override.id}" uses operation version ${override.operationVersion}; this reader understands up to ${SCENE3D_V2_OVERRIDE_OPERATION_VERSION}`,
      })
    }

    if (override.kind === "camera-shot-offset") {
      if (!shotIds.has(override.shotId)) {
        issues.push({ path: at("shotId"), message: `override "${override.id}" targets unknown shot "${override.shotId}"` })
      } else if (offsetTargets.has(override.shotId)) {
        issues.push({
          path: at("shotId"),
          message: `shot "${override.shotId}" already has a camera offset; one owner per channel`,
        })
      }
      offsetTargets.add(override.shotId)
      if (override.positionOffset === undefined && override.targetOffset === undefined) {
        issues.push({ path: at(), message: `override "${override.id}" offsets nothing` })
      }
      return
    }

    const entity = byId.get(override.entityId)
    if (!entity) {
      issues.push({ path: at("entityId"), message: `override "${override.id}" targets unknown entity "${override.entityId}"` })
      return
    }

    if (override.kind === "entity-transform") {
      if (transformTargets.has(override.entityId)) {
        issues.push({
          path: at("entityId"),
          message: `entity "${override.entityId}" already has a transform override; one owner per channel`,
        })
      }
      transformTargets.add(override.entityId)
      if (!scene3DEntityAcceptsOverlay(entity, "transform")) {
        issues.push({
          path: at("entityId"),
          message: `entity "${override.entityId}" does not accept a transform overlay (locked or not advertised)`,
        })
      }
      if (override.position === undefined && override.rotation === undefined && override.scale === undefined) {
        issues.push({ path: at(), message: `override "${override.id}" changes nothing` })
      }
      return
    }

    if (override.kind === "entity-visibility") {
      if (visibilityTargets.has(override.entityId)) {
        issues.push({
          path: at("entityId"),
          message: `entity "${override.entityId}" already has a visibility override; one owner per channel`,
        })
      }
      visibilityTargets.add(override.entityId)
      if (!scene3DEntityAcceptsOverlay(entity, "visibility")) {
        issues.push({
          path: at("entityId"),
          message: `entity "${override.entityId}" does not accept a visibility overlay (locked or not advertised)`,
        })
      }
      return
    }

    // entity-color
    const key = `${override.entityId}\u0000${override.materialRole}`
    if (colorTargets.has(key)) {
      issues.push({
        path: at("materialRole"),
        message: `entity "${override.entityId}" already recolours material role "${override.materialRole}"`,
      })
    }
    colorTargets.add(key)
    if (!scene3DEntityAcceptsOverlay(entity, "color")) {
      issues.push({
        path: at("entityId"),
        message: `entity "${override.entityId}" does not accept a colour overlay (locked or not advertised)`,
      })
    }
    if (entity.visual.kind === "group") {
      issues.push({
        path: at("materialRole"),
        message: `entity "${override.entityId}" is a group and has no geometry to recolour`,
      })
    } else if (entity.visual.kind === "primitive") {
      if (override.materialRole !== SCENE3D_PRIMITIVE_MATERIAL_ROLE) {
        issues.push({
          path: at("materialRole"),
          message: `entity "${override.entityId}" is a primitive; its only material role is "${SCENE3D_PRIMITIVE_MATERIAL_ROLE}"`,
        })
      }
    } else if (!(entity.materialBindings ?? []).some((binding) => binding.role === override.materialRole)) {
      issues.push({
        path: at("materialRole"),
        message: `entity "${override.entityId}" declares no material role "${override.materialRole}"; a binding may only name materials in that entity's asset root`,
      })
    }
  })
}

/**
 * Every v2 rule that needs more than one field: timing, identity, hierarchy,
 * asset resolution and budgets, shot coverage, overlay ownership and locks.
 *
 * Split out of the schema's `superRefine` (exactly as v1 does) so a caller
 * holding an already-parsed plan can re-check it without re-parsing.
 */
export function scene3DPlanV2Issues(plan: Scene3DPlanV2): Issue[] {
  const issues: Issue[] = []

  const seconds = plan.durationInFrames / plan.fps
  if (seconds > SCENE3D_V2_LIMITS.maxDurationSeconds) {
    issues.push({
      path: ["durationInFrames"],
      message: `scene is ${seconds.toFixed(2)}s; the limit is ${SCENE3D_V2_LIMITS.maxDurationSeconds}s`,
    })
  }
  for (const axis of ["width", "height"] as const) {
    if (plan[axis] % 2 !== 0) {
      issues.push({ path: [axis], message: `${axis} must be an even number of pixels (got ${plan[axis]})` })
    }
  }

  const byId = new Map<string, Scene3DEntityV2>()
  plan.objects.forEach((entity, index) => {
    if (byId.has(entity.id)) {
      issues.push({ path: ["objects", index, "id"], message: `duplicate entity id "${entity.id}"` })
      return
    }
    byId.set(entity.id, entity)
  })

  const assetsById = new Map<string, Scene3DAssetRef>()
  plan.assets.forEach((asset, index) => {
    if (assetsById.has(asset.assetId)) {
      issues.push({ path: ["assets", index, "assetId"], message: `duplicate asset id "${asset.assetId}"` })
      return
    }
    assetsById.set(asset.assetId, asset)
  })

  checkEntities(plan, byId, issues)
  checkAssets(plan, assetsById, issues)
  checkShots(plan, byId, issues)
  checkOverrides(plan, byId, new Set(plan.shots.map((shot) => shot.id)), issues)

  const referenceIds = new Set<string>()
  ;(plan.references ?? []).forEach((reference, index) => {
    if (referenceIds.has(reference.id)) {
      issues.push({ path: ["references", index, "id"], message: `duplicate reference id "${reference.id}"` })
    }
    referenceIds.add(reference.id)
    if (reference.objectId !== undefined && !byId.has(reference.objectId)) {
      issues.push({
        path: ["references", index, "objectId"],
        message: `reference "${reference.id}" points at unknown entity "${reference.objectId}"`,
      })
    }
    if (
      reference.startSeconds !== undefined &&
      reference.endSeconds !== undefined &&
      reference.endSeconds <= reference.startSeconds
    ) {
      issues.push({
        path: ["references", index, "endSeconds"],
        message: `reference "${reference.id}" ends at or before it starts`,
      })
    }
    if (reference.kind === "image" && (reference.startSeconds !== undefined || reference.endSeconds !== undefined)) {
      issues.push({
        path: ["references", index, "startSeconds"],
        message: `reference "${reference.id}" is an image; a time window applies to video only`,
      })
    }
  })

  return issues
}

/**
 * The v2 object shape WITHOUT the cross-field pass. Exported so
 * `scene3DAnyPlanSchema` can discriminate on `schemaVersion`; parse with
 * `scene3DPlanV2Schema`.
 *
 * Deliberately free of `.default()`: `parse(x)` must deep-equal `x`, or a
 * producer hashing raw JSON and a consumer hashing parsed output would compute
 * different content hashes for the same revision.
 */
export const scene3DPlanV2ObjectSchema = z
  .object({
    planType: z.literal(SCENE3D_PLAN_TYPE),
    schemaVersion: z.literal(SCENE3D_SCHEMA_VERSION_V2),
    revisionId: z.uuid(),
    parentRevisionId: z.uuid().optional(),
    width: z.number().int().min(SCENE3D_V2_LIMITS.minDimensionPx).max(SCENE3D_V2_LIMITS.maxDimensionPx),
    height: z.number().int().min(SCENE3D_V2_LIMITS.minDimensionPx).max(SCENE3D_V2_LIMITS.maxDimensionPx),
    fps: z.number().int().min(SCENE3D_V2_LIMITS.minFps).max(SCENE3D_V2_LIMITS.maxFps),
    durationInFrames: z
      .number()
      .int()
      .min(SCENE3D_V2_LIMITS.minDurationInFrames)
      .max(SCENE3D_V2_LIMITS.maxDurationInFrames),
    units: z.literal("meters"),
    upAxis: z.literal("Y"),
    handedness: z.literal("right"),
    objects: z
      .array(scene3DEntityV2Schema)
      .min(SCENE3D_V2_LIMITS.minEntities)
      .max(SCENE3D_V2_LIMITS.maxEntities),
    assets: z.array(scene3DAssetRefSchema).min(1).max(SCENE3D_V2_LIMITS.maxAssets),
    cameraTrackAssetId: scene3DAssetIdSchema,
    shots: z.array(scene3DShotSchema).min(1).max(SCENE3D_V2_LIMITS.maxShots),
    lighting: scene3DClayLightingSchema,
    backgroundColor: scene3DColorSchema,
    references: z.array(scene3DReferenceSchema).max(SCENE3D_V2_LIMITS.maxReferences).optional(),
    overrides: z.array(scene3DOverrideSchema).max(SCENE3D_V2_LIMITS.maxOverrides).optional(),
    provenance: scene3DProvenanceSchema,
  })
  .strict()

/** THE v2 plan validator: structure first, then the cross-field rules. */
export const scene3DPlanV2Schema = scene3DPlanV2ObjectSchema.superRefine((plan, ctx) => {
  for (const issue of scene3DPlanV2Issues(plan as Scene3DPlanV2)) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message })
  }
})

/**
 * Either version, discriminated on `schemaVersion` — so an unknown version
 * reports "Invalid discriminator value. Expected '1' | '2'" instead of a pile
 * of unknown-key errors from whichever branch failed last.
 */
export const scene3DAnyPlanSchema = z
  .discriminatedUnion("schemaVersion", [scene3DPlanV1ObjectSchema, scene3DPlanV2ObjectSchema])
  .superRefine((plan, ctx) => {
    const issues =
      plan.schemaVersion === SCENE3D_SCHEMA_VERSION_V2
        ? scene3DPlanV2Issues(plan as Scene3DPlanV2)
        : scene3DPlanV1Issues(plan as Scene3DPlanV1)
    for (const issue of issues) {
      ctx.addIssue({ code: "custom", path: issue.path, message: issue.message })
    }
  })

/** Zod for a client's `acceptedSceneSchemaVersions`. */
export const scene3DAcceptedSchemaVersionsSchema = z
  .array(z.union([z.literal(1), z.literal(2)]))
  .min(1)
  .max(SCENE3D_SUPPORTED_SCHEMA_VERSIONS.length)
// ---------------------------------------------------------------------------
// Narrowing and version negotiation
// ---------------------------------------------------------------------------

export function isScene3DPlanV2(value: unknown): value is Scene3DPlanV2 {
  return scene3DPlanV2Schema.safeParse(value).success
}

/** Accepts EITHER version. `isScene3DPlanV1` (in `scene3d.ts`) is the v1-only
 *  form; narrow with one of them before reading version-specific fields. */
export function isScene3DPlan(value: unknown): value is Scene3DPlan {
  return scene3DAnyPlanSchema.safeParse(value).success
}

/**
 * The schema version a value CLAIMS, without validating the rest of it.
 *
 * Returns the number even when this package cannot handle it, so an SDK
 * consumer can say "this scene is v3, upgrade to render it" instead of "invalid
 * plan". `null` means it is not a Scene3D plan at all.
 */
export function scene3DPlanSchemaVersion(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as { planType?: unknown; schemaVersion?: unknown }
  if (record.planType !== SCENE3D_PLAN_TYPE) return null
  if (typeof record.schemaVersion !== "number" || !Number.isInteger(record.schemaVersion)) return null
  return record.schemaVersion
}

export function isScene3DSchemaVersionSupported(version: number): version is Scene3DSupportedSchemaVersion {
  return (SCENE3D_SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(version)
}

export function isKnownScene3DEngine(engine: string): engine is Scene3DKnownEngine {
  return (SCENE3D_V2_ENGINES as readonly string[]).includes(engine)
}

// ---------------------------------------------------------------------------
// Shot lookup
// ---------------------------------------------------------------------------

/**
 * The shot owning `frame`, or `-1`. Ranges are half-open and contiguous, so
 * this is total over `[0, durationInFrames)` on a validated plan — and it is
 * the ONLY place a renderer decides which side of a cut a frame is on.
 */
export function scene3DShotIndexForFrame(shots: readonly Scene3DShot[], frame: number): number {
  for (let index = 0; index < shots.length; index++) {
    const shot = shots[index]
    if (frame >= shot.startFrame && frame < shot.endFrameExclusive) return index
  }
  return -1
}

export function scene3DShotForFrame(
  shots: readonly Scene3DShot[],
  frame: number,
): Scene3DShot | undefined {
  const index = scene3DShotIndexForFrame(shots, frame)
  return index === -1 ? undefined : shots[index]
}
