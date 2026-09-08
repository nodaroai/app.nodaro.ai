/**
 * Immutable overlays over baked asset state.
 *
 * Defined order (contract §4): baked asset state → entity overrides → camera
 * overrides → selection-only display. This module owns the first three; the
 * canvas owns selection, which by construction touches only emissive and never
 * a transform.
 *
 * Two rules cause almost all of the bugs in this class of feature, and both are
 * structural here rather than conventions:
 *
 *  1. **A world-space override must not multiply the parent transform twice.**
 *     The entity's node is parented, so writing a world matrix into its local
 *     slot would apply the ancestors again on `updateMatrixWorld`. The world
 *     branch converts through `inverse(parentWorld)` exactly once. That is why
 *     the contract makes `space` a REQUIRED, declared field.
 *
 *     `parentWorld` is the TRUE world matrix of the wrapper's parent at this
 *     frame — every ancestor's baked, possibly animated, placement included.
 *     That is what makes `world` mean the SCENE's axes: the declared channels
 *     replace the wrapper's world position/rotation/scale, so a rotated or
 *     scaled ancestor changes where the entity ends up but never what the
 *     numbers mean. `local` is the other half of the same statement — the
 *     wrapper's own slot, which is the parent entity's frame with its baked
 *     placement already in it.
 *
 *     Under an animated ancestor the wrapper value is therefore a DIFFERENT
 *     matrix on every frame, and deliberately so: `world` names a point in the
 *     scene, not a displacement that rides along. What it is not is unbakeable
 *     — the authoring source stores the declared world channels and the
 *     compiler re-derives the same per-frame matrix from its own ancestor
 *     chain (`overlays.py`), which is why the entity stays PARENTED in the
 *     rebuild instead of being flattened to a scene-level one.
 *  2. **The baked bytes are never edited.** An override composes onto the
 *     entity WRAPPER; the mounted GLB subtree keeps whatever the exporter baked
 *     into it, so two revisions can share the same immutable asset and differ
 *     only in overlays.
 *
 * Structural validity (target resolves, one override per entity/role/shot,
 * capability advertised and not locked, operation version understood) is the
 * CONTRACT's job — `scene3DPlanV2Schema` has already rejected a plan that
 * fails any of it by the time this runs.
 */
import * as THREE from "three"
import { check } from "./errors"
import type {
  Scene3DCameraSample,
  Scene3DOverride,
  Scene3DPlanV2,
} from "./plan-shape"

type CameraShotOverride = Extract<Scene3DOverride, { kind: "camera-shot-offset" }>
type EntityTransformOverride = Extract<Scene3DOverride, { kind: "entity-transform" }>

export interface Scene3DOverlayIndex {
  /** entityId → its transform override. */
  readonly entityTransforms: ReadonlyMap<string, EntityTransformOverride>
  /** entityId → materialRole → colour. */
  readonly entityColors: ReadonlyMap<string, ReadonlyMap<string, string>>
  /** entityId → visibility. */
  readonly entityVisibility: ReadonlyMap<string, boolean>
  /** shotId → camera override, scoped to that shot's frames only. */
  readonly cameraShots: ReadonlyMap<string, CameraShotOverride>
  /** True when any camera override re-aims and therefore needs `sample.target`. */
  readonly needsCameraTarget: boolean
}

/**
 * Group the plan's overrides by subject.
 *
 * The lookups a target that does not exist are still checked here: the renderer
 * can be handed an already-parsed object by a host, and an override silently
 * ignored is an edit the user believes they made.
 */
export function buildOverlayIndex(plan: Scene3DPlanV2): Scene3DOverlayIndex {
  const entityIds = new Set(plan.objects.map((entity) => entity.id))
  const shotIds = new Set(plan.shots.map((shot) => shot.id))

  const entityTransforms = new Map<string, EntityTransformOverride>()
  const entityColors = new Map<string, Map<string, string>>()
  const entityVisibility = new Map<string, boolean>()
  const cameraShots = new Map<string, CameraShotOverride>()
  let needsCameraTarget = false

  for (const override of plan.overrides ?? []) {
    switch (override.kind) {
      case "entity-transform": {
        check(
          entityIds.has(override.entityId),
          "SCENE_OVERRIDE_INVALID",
          "transform override targets an entity that is not in this plan",
          override.entityId,
        )
        entityTransforms.set(override.entityId, override)
        break
      }
      case "entity-color": {
        check(
          entityIds.has(override.entityId),
          "SCENE_OVERRIDE_INVALID",
          "colour override targets an entity that is not in this plan",
          override.entityId,
        )
        const byRole = entityColors.get(override.entityId) ?? new Map<string, string>()
        byRole.set(override.materialRole, override.color)
        entityColors.set(override.entityId, byRole)
        break
      }
      case "entity-visibility": {
        check(
          entityIds.has(override.entityId),
          "SCENE_OVERRIDE_INVALID",
          "visibility override targets an entity that is not in this plan",
          override.entityId,
        )
        entityVisibility.set(override.entityId, override.visible)
        break
      }
      case "camera-shot-offset": {
        check(
          shotIds.has(override.shotId),
          "SCENE_OVERRIDE_INVALID",
          "camera override targets a shot that is not in this plan",
          override.shotId,
        )
        cameraShots.set(override.shotId, override)
        if (override.targetOffset) needsCameraTarget = true
        break
      }
      default: {
        // A kind the contract knows and this renderer does not: refuse rather
        // than draw a scene the edit did not describe.
        const unknown = override as { kind?: unknown }
        check(
          false,
          "SCENE_OVERRIDE_INVALID",
          `this renderer does not implement override kind "${String(unknown.kind)}"`,
        )
      }
    }
  }

  return { entityTransforms, entityColors, entityVisibility, cameraShots, needsCameraTarget }
}

const _base = new THREE.Matrix4()
const _target = new THREE.Matrix4()
const _parentInverse = new THREE.Matrix4()
const _position = new THREE.Vector3()
const _quaternion = new THREE.Quaternion()
const _scale = new THREE.Vector3()
const _euler = new THREE.Euler()
const _recomposed = new THREE.Matrix4()

/**
 * Write the entity's base transform, composed with its override, into `node`.
 *
 * The override is a CONSTANT transform in the declared space, and it replaces
 * only the channels it names — an edit that moved an object must not also reset
 * its rotation.
 *
 * `parentWorld` is the world matrix of `node`'s parent, already up to date —
 * the REAL one, ancestors' baked transforms included. The world-space branch is
 * the only consumer, and it uses it exactly once.
 */
export function applyEntityTransformOverride(
  node: THREE.Object3D,
  base: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 },
  override: EntityTransformOverride | undefined,
  parentWorld: THREE.Matrix4 | null,
): void {
  if (!override) {
    node.position.copy(base.position)
    node.quaternion.copy(base.quaternion)
    node.scale.copy(base.scale)
    return
  }

  if (override.space === "local") {
    node.position.set(
      override.position?.[0] ?? base.position.x,
      override.position?.[1] ?? base.position.y,
      override.position?.[2] ?? base.position.z,
    )
    if (override.rotation) {
      _euler.set(override.rotation[0], override.rotation[1], override.rotation[2], "XYZ")
      node.quaternion.setFromEuler(_euler)
    } else {
      node.quaternion.copy(base.quaternion)
    }
    node.scale.set(
      override.scale?.[0] ?? base.scale.x,
      override.scale?.[1] ?? base.scale.y,
      override.scale?.[2] ?? base.scale.z,
    )
    return
  }

  // World space. Start from where the entity WOULD be IN THE SCENE, replace the
  // named channels there, then divide the parent out exactly once so
  // `updateMatrixWorld` puts it back — never twice.
  _base.compose(base.position, base.quaternion, base.scale)
  if (parentWorld) _base.premultiply(parentWorld)
  _base.decompose(_position, _quaternion, _scale)

  if (override.position) _position.set(override.position[0], override.position[1], override.position[2])
  if (override.rotation) {
    _euler.set(override.rotation[0], override.rotation[1], override.rotation[2], "XYZ")
    _quaternion.setFromEuler(_euler)
  }
  if (override.scale) _scale.set(override.scale[0], override.scale[1], override.scale[2])

  _target.compose(_position, _quaternion, _scale)
  if (parentWorld) {
    _parentInverse.copy(parentWorld).invert()
    _target.premultiply(_parentInverse)
  }
  _target.decompose(node.position, node.quaternion, node.scale)
  // An ancestor carrying NON-UNIFORM scale under a rotation can make
  // `inverse(parentWorld) · target` a matrix no position/rotation/scale triple
  // describes. `decompose` answers anyway, dropping the shear — a scene subtly
  // unlike the edit, drawn without complaint, and one the authoring source
  // could not store either. Refuse it here, where the values are still exact.
  _recomposed.compose(node.position, node.quaternion, node.scale)
  check(
    closeEnough(_recomposed, _target),
    "SCENE_OVERRIDE_INVALID",
    "this world-space edit shears the entity — its parent's non-uniform scale and rotation " +
      "leave no position/rotation/scale that draws it, and approximating one would move it",
    override.entityId,
  )
}

/** Same 1e-6 relative tolerance the authoring source's decomposability gate uses. */
function closeEnough(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  for (let i = 0; i < 16; i++) {
    if (Math.abs(a.elements[i] - b.elements[i]) > 1e-6 * Math.max(1, Math.abs(b.elements[i]))) return false
  }
  return true
}

const _aimFrom = new THREE.Vector3()
const _aimTo = new THREE.Vector3()
const _delta = new THREE.Quaternion()

/**
 * Camera overlay for one frame: the baked sample, then the shot's override if
 * the frame is inside that shot.
 *
 * `targetOffset` is applied as a DELTA rotation between "aim at the baked
 * target" and "aim at the offset target" — pre-multiplied onto the exported
 * quaternion. That is deliberately not a `lookAt()`: a `lookAt` would rebuild
 * the whole orientation from an up-vector and throw away the exporter's roll
 * and handheld component, which is exactly what the contract forbids. A delta
 * re-aims and keeps everything else the exporter baked.
 */
export function applyCameraShotOverride(
  camera: THREE.PerspectiveCamera,
  override: CameraShotOverride | undefined,
  sample: Scene3DCameraSample,
): void {
  if (!override) return

  if (override.targetOffset) {
    const target = sample.target
    check(
      !!target,
      "SCENE_OVERRIDE_INVALID",
      "this shot's camera override re-aims the camera, but the track's samples carry no `target` to offset",
      override.shotId,
    )
    _aimFrom
      .set(target[0], target[1], target[2])
      .sub(new THREE.Vector3(sample.position[0], sample.position[1], sample.position[2]))
    _aimTo
      .set(
        target[0] + override.targetOffset[0],
        target[1] + override.targetOffset[1],
        target[2] + override.targetOffset[2],
      )
      .sub(new THREE.Vector3(sample.position[0], sample.position[1], sample.position[2]))
    if (_aimFrom.lengthSq() > 0 && _aimTo.lengthSq() > 0) {
      _delta.setFromUnitVectors(_aimFrom.normalize(), _aimTo.normalize())
      camera.quaternion.premultiply(_delta)
    }
  }

  if (override.positionOffset) {
    camera.position.x += override.positionOffset[0]
    camera.position.y += override.positionOffset[1]
    camera.position.z += override.positionOffset[2]
  }
}

/** Colour for an entity/material role after the colour overrides. */
export function resolveOverlayColor(
  overlays: Scene3DOverlayIndex,
  entityId: string,
  materialRole: string | undefined,
): string | undefined {
  if (materialRole === undefined) return undefined
  return overlays.entityColors.get(entityId)?.get(materialRole)
}
