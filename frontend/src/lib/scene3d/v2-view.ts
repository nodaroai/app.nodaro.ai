/**
 * The read model and the operation builders for a v2 (baked) scene.
 *
 * v2 is a different authoring object from v1 and the panel has to say so
 * honestly:
 *
 *  - **Geometry is baked.** A v1 object owns its primitive and its keyframes,
 *    so the panel can read and write them. A v2 `asset` entity is a NAME for a
 *    subtree inside a GLB whose node transform is authoritative — the manifest's
 *    `position/rotation/scale` are an informational frame-0 snapshot the
 *    renderer deliberately does not apply. So a transform control on an asset
 *    entity is an OVERLAY, not the object's real transform, and this module
 *    never pretends otherwise (`placementFromAsset`).
 *  - **Edits are overlays.** Every control produces a `Scene3DV2EditOperation`
 *    from the shared vocabulary, which the host applies against a RETAINED
 *    revision. Nothing here mutates a plan or invents a revision: a v2 revision
 *    the server has not stored would draw as if it were saved while its assets
 *    still belong to the revision it came from.
 *  - **An override replaces only the channels it names** (`overlays.ts`), so
 *    editing Y after editing X must MERGE with the existing override rather
 *    than replace it — a `set-override` is per entity, and the contract allows
 *    exactly one transform override per entity.
 *
 * Capability rules are not restated here: `scene3DEntityAcceptsOverlay` from
 * `@nodaro/shared` is the one place that decides whether an entity accepts a
 * kind of edit, and the panel asks it. External locks (the ones the user set on
 * the node, which the model is also held to) are layered on top.
 */
import {
  SCENE3D_PRIMITIVE_MATERIAL_ROLE,
  scene3DEntityAcceptsOverlay,
  scene3DShotIndexForFrame,
} from "@nodaro/shared"
import type {
  Scene3DEntityCapability,
  Scene3DEntityV2,
  Scene3DOverride,
  Scene3DPlanV2,
  Scene3DV2EditOperation,
} from "@nodaro/shared"
import { clampChannelValue, withAxis, type VectorAxis } from "./edit-operations"
import type { Vec3 } from "./plan-view"

export const V2_TRANSFORM_CHANNELS = ["position", "rotation", "scale"] as const
export type V2TransformChannel = (typeof V2_TRANSFORM_CHANNELS)[number]

const NEUTRAL_COLOR = "#cccccc"

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

export interface Scene3DShotView {
  id: string
  index: number
  label: string
  startFrame: number
  endFrameExclusive: number
  frameCount: number
}

/** The shot strip. Shots are validated to tile the timeline, so this is total. */
export function shotViews(plan: Scene3DPlanV2): Scene3DShotView[] {
  return plan.shots.map((shot, index) => ({
    id: shot.id,
    index,
    label: shot.label ?? shot.id,
    startFrame: shot.startFrame,
    endFrameExclusive: shot.endFrameExclusive,
    frameCount: shot.endFrameExclusive - shot.startFrame,
  }))
}

/**
 * Which shot the playhead is in. Derived from the frame every render — the
 * current shot is NEVER stored, because two sources for "where are we" is how
 * a transport and a shot list drift apart.
 */
export function shotIndexAtFrame(plan: Scene3DPlanV2, frame: number): number {
  return scene3DShotIndexForFrame(plan.shots, frame)
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Scene3DEntityView {
  id: string
  name: string
  kind: Scene3DEntityV2["visual"]["kind"]
  role?: string
  /** Indentation depth in the parent chain. The plan is validated acyclic. */
  depth: number
  /** The identity swatch: colour override → `identityColor` → primitive colour. */
  color: string
  visible: boolean
  /**
   * The values the transform controls show. `null` when there is nothing
   * truthful to show — an `asset` entity whose placement lives in its GLB and
   * that carries no override and no manifest snapshot.
   */
  transform: Record<V2TransformChannel, Vec3> | null
  /** The GLB node's transform is authoritative; edits here are overlays. */
  placementFromAsset: boolean
  transformOverridden: boolean
  visibilityOverridden: boolean
  /** Material roles this entity exposes, plus which are overridden. */
  materials: Array<{ role: string; color: string; overridden: boolean }>
  /** What this entity accepts, after its own locks AND the node's lock list. */
  can: Record<Scene3DEntityCapability, boolean>
}

type TransformOverride = Extract<Scene3DOverride, { kind: "entity-transform" }>

function transformOverrideFor(plan: Scene3DPlanV2, entityId: string): TransformOverride | undefined {
  return (plan.overrides ?? []).find(
    (o): o is TransformOverride => o.kind === "entity-transform" && o.entityId === entityId,
  )
}

function colorOverrides(plan: Scene3DPlanV2, entityId: string): Map<string, string> {
  const byRole = new Map<string, string>()
  for (const o of plan.overrides ?? []) {
    if (o.kind === "entity-color" && o.entityId === entityId) byRole.set(o.materialRole, o.color)
  }
  return byRole
}

function visibilityOverrideFor(plan: Scene3DPlanV2, entityId: string): boolean | undefined {
  for (const o of plan.overrides ?? []) {
    if (o.kind === "entity-visibility" && o.entityId === entityId) return o.visible
  }
  return undefined
}

function depthOf(entity: Scene3DEntityV2, byId: Map<string, Scene3DEntityV2>): number {
  let depth = 0
  let parentId = entity.parentId
  // The plan is schema-validated (no cycles, depth ≤ 16); the guard is belt and
  // braces so a hand-built object in a test can never hang a render.
  while (parentId && depth < 64) {
    depth += 1
    parentId = byId.get(parentId)?.parentId
  }
  return depth
}

/** The entity's own material vocabulary: its bindings, or the identity swatch. */
function materialsOf(
  entity: Scene3DEntityV2,
  overrides: Map<string, string>,
): Scene3DEntityView["materials"] {
  if (entity.visual.kind === "asset") {
    return (entity.materialBindings ?? []).map((binding) => ({
      role: binding.role,
      color: overrides.get(binding.role) ?? binding.color ?? NEUTRAL_COLOR,
      overridden: overrides.has(binding.role),
    }))
  }
  if (entity.visual.kind === "primitive") {
    // A primitive has exactly one recolourable surface, under the reserved role.
    const role = SCENE3D_PRIMITIVE_MATERIAL_ROLE
    return [
      {
        role,
        color: overrides.get(role) ?? entity.visual.color,
        overridden: overrides.has(role),
      },
    ]
  }
  // A group has no geometry, so it has no colour to set (the contract rejects
  // an `entity-color` override on one outright).
  return []
}

function baseTransform(entity: Scene3DEntityV2): Record<V2TransformChannel, Vec3> | null {
  if (!entity.position && !entity.rotation && !entity.scale) return null
  return {
    position: [...(entity.position ?? [0, 0, 0])] as Vec3,
    rotation: [...(entity.rotation ?? [0, 0, 0])] as Vec3,
    scale: [...(entity.scale ?? [1, 1, 1])] as Vec3,
  }
}

export function entityViews(
  plan: Scene3DPlanV2,
  options: { lockedObjectIds?: readonly string[] } = {},
): Scene3DEntityView[] {
  const byId = new Map(plan.objects.map((entity) => [entity.id, entity]))
  const externallyLocked = new Set(options.lockedObjectIds ?? [])

  return plan.objects.map((entity) => {
    const override = transformOverrideFor(plan, entity.id)
    const colors = colorOverrides(plan, entity.id)
    const materials = materialsOf(entity, colors)
    const base = baseTransform(entity)
    const transform = base
      ? {
          position: (override?.position ? ([...override.position] as Vec3) : base.position),
          rotation: (override?.rotation ? ([...override.rotation] as Vec3) : base.rotation),
          scale: (override?.scale ? ([...override.scale] as Vec3) : base.scale),
        }
      : override && (override.position || override.rotation || override.scale)
        ? {
            position: (override.position ? ([...override.position] as Vec3) : ([0, 0, 0] as Vec3)),
            rotation: (override.rotation ? ([...override.rotation] as Vec3) : ([0, 0, 0] as Vec3)),
            scale: (override.scale ? ([...override.scale] as Vec3) : ([1, 1, 1] as Vec3)),
          }
        : null
    const visibility = visibilityOverrideFor(plan, entity.id)
    const locked = externallyLocked.has(entity.id)
    const accepts = (capability: Scene3DEntityCapability): boolean =>
      !locked && scene3DEntityAcceptsOverlay(entity, capability)

    return {
      id: entity.id,
      name: entity.name,
      kind: entity.visual.kind,
      role: entity.role,
      depth: depthOf(entity, byId),
      color:
        materials.find((m) => m.role === SCENE3D_PRIMITIVE_MATERIAL_ROLE)?.color ??
        entity.identityColor ??
        materials[0]?.color ??
        NEUTRAL_COLOR,
      visible: visibility ?? true,
      transform,
      placementFromAsset: entity.visual.kind === "asset",
      transformOverridden: override !== undefined,
      visibilityOverridden: visibility !== undefined,
      materials,
      can: {
        transform: accepts("transform"),
        color: accepts("color") && materials.length > 0,
        visibility: accepts("visibility"),
      },
    }
  })
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Move one axis of one transform channel.
 *
 * The emitted override carries the channels that were ALREADY overridden plus
 * the one being edited, and nothing else — an override replaces the channels it
 * names, so naming a channel the user never touched would silently reset it to
 * the value the panel happened to be displaying (for an `asset` entity, that
 * would overwrite the GLB's own rotation with a manifest snapshot).
 */
export function buildEntityTransformOperation(
  plan: Scene3DPlanV2,
  view: Scene3DEntityView,
  channel: V2TransformChannel,
  axis: VectorAxis,
  value: number,
): Scene3DV2EditOperation | null {
  if (!view.can.transform || !view.transform) return null
  const existing = transformOverrideFor(plan, view.id)
  const next = withAxis(view.transform[channel], axis, clampChannelValue(channel, value))
  if (next.every((n, i) => n === view.transform?.[channel][i])) return null

  return {
    op: "set-override",
    override: {
      kind: "entity-transform",
      entityId: view.id,
      space: existing?.space ?? "local",
      ...(existing?.position ? { position: [...existing.position] as Vec3 } : {}),
      ...(existing?.rotation ? { rotation: [...existing.rotation] as Vec3 } : {}),
      ...(existing?.scale ? { scale: [...existing.scale] as Vec3 } : {}),
      [channel]: next,
    },
  }
}

export function buildEntityColorOperation(
  view: Scene3DEntityView,
  materialRole: string,
  color: string,
): Scene3DV2EditOperation | null {
  if (!view.can.color) return null
  const material = view.materials.find((m) => m.role === materialRole)
  if (!material || material.color.toLowerCase() === color.toLowerCase()) return null
  return { op: "set-override", override: { kind: "entity-color", entityId: view.id, materialRole, color } }
}

export function buildEntityVisibilityOperation(
  view: Scene3DEntityView,
  visible: boolean,
): Scene3DV2EditOperation | null {
  if (!view.can.visibility || view.visible === visible) return null
  return { op: "set-override", override: { kind: "entity-visibility", entityId: view.id, visible } }
}
