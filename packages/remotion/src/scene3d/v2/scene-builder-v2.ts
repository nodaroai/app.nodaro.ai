/**
 * Builds the three.js graph for a LOADED v2 scene and drives it from a frame
 * number.
 *
 * Layering (this is the whole design):
 *
 *   entity wrapper  ← base transform + entity overrides      (we own it)
 *     └── GLB entity-root node ← baked static/animated transform (the exporter owns it)
 *           └── the rest of the exported subtree
 *
 * Each channel has exactly ONE owner. Two consequences the contract spells out:
 *
 *  - For an `asset` entity the GLB node transform is AUTHORITATIVE and the
 *    manifest's `position/rotation/scale` are an informational frame-0 snapshot
 *    — so the wrapper stays at identity and only the exported node places the
 *    entity. Applying both is the double-transform bug that puts a car at twice
 *    its offset. `group` and `primitive` entities have no exported node, so
 *    there the manifest transform IS the placement.
 *  - An override composes onto the WRAPPER, never onto the baked bytes. An
 *    "offset this car" edit moves the wrapper while the baked drive animation
 *    keeps playing underneath, and two revisions can share the same immutable
 *    asset while differing only in overlays.
 *
 * The camera is not in that hierarchy at all: it is set from the sidecar's
 * baked position/quaternion/projection every frame, with no `lookAt` and no FOV
 * re-derivation.
 */
import * as THREE from "three"
import { SCENE3D_PRIMITIVE_MATERIAL_ROLE } from "@nodaro/shared"
import { buildScene3DGeometry } from "../scene-builder"
import type { Scene3DObject } from "../types"
import type { Scene3DRenderHandle } from "../handle"
import { bindScene3DClip, selectScene3DClip, type Scene3DBoundClip } from "./clip-sampler"
import { check } from "./errors"
import type { Scene3DLoadedScene } from "./load"
import {
  applyCameraShotOverride,
  applyEntityTransformOverride,
  resolveOverlayColor,
  type Scene3DOverlayIndex,
} from "./overlays"
import type { Scene3DAssetAnimation, Scene3DEntityV2 } from "./plan-shape"
import { sampleBakedCamera, type Scene3DCameraSample } from "./camera-track"

/** Pinned clay look — the same numbers the v1 builder uses, on purpose. */
const CLAY_ROUGHNESS = 0.78
const CLAY_METALNESS = 0.02
const CLAY_DEFAULT_COLOR = "#cccccc"
const SELECTION_EMISSIVE = 0x2a6cff

export interface Scene3DV2FrameSample {
  readonly frame: number
  readonly shotId: string
  readonly shotIndex: number
  readonly camera: Scene3DCameraSample
}

export interface Scene3DV2SceneHandle extends Scene3DRenderHandle {
  readonly entities: Map<string, THREE.Object3D>
  applyFrame(frame: number): Scene3DV2FrameSample
}

interface EntityNode {
  readonly entity: Scene3DEntityV2
  readonly wrapper: THREE.Group
  readonly base: {
    position: THREE.Vector3
    quaternion: THREE.Quaternion
    scale: THREE.Vector3
  }
  clip: Scene3DBoundClip | null
  animation: Scene3DAssetAnimation | null
  meshes: THREE.Mesh[]
}

/**
 * The entity's base local transform.
 *
 * Identity for an `asset` entity: its exported node already carries the
 * placement, and re-applying the manifest's copy of it here is the
 * double-transform trap.
 */
function baseTransformOf(entity: Scene3DEntityV2): EntityNode["base"] {
  const identity = {
    position: new THREE.Vector3(0, 0, 0),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
  }
  if (entity.visual.kind === "asset") return identity

  const euler = new THREE.Euler(
    entity.rotation?.[0] ?? 0,
    entity.rotation?.[1] ?? 0,
    entity.rotation?.[2] ?? 0,
    "XYZ",
  )
  return {
    position: new THREE.Vector3(
      entity.position?.[0] ?? 0,
      entity.position?.[1] ?? 0,
      entity.position?.[2] ?? 0,
    ),
    quaternion: new THREE.Quaternion().setFromEuler(euler),
    scale: new THREE.Vector3(entity.scale?.[0] ?? 1, entity.scale?.[1] ?? 1, entity.scale?.[2] ?? 1),
  }
}

/** Parents strictly before children. The hierarchy was already acyclic-checked. */
function topoOrder(entities: readonly Scene3DEntityV2[]): Scene3DEntityV2[] {
  const byId = new Map(entities.map((e) => [e.id, e]))
  const out: Scene3DEntityV2[] = []
  const emitted = new Set<string>()
  const emit = (entity: Scene3DEntityV2): void => {
    if (emitted.has(entity.id)) return
    const parent = entity.parentId ? byId.get(entity.parentId) : undefined
    if (parent) emit(parent)
    if (emitted.has(entity.id)) return
    emitted.add(entity.id)
    out.push(entity)
  }
  for (const entity of entities) emit(entity)
  return out
}

export function buildScene3DV2Scene(loaded: Scene3DLoadedScene): Scene3DV2SceneHandle {
  const { plan, cameraTrack, shots, overlays, glbById } = loaded

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(plan.backgroundColor || "#000000")

  const aspect = plan.height > 0 ? plan.width / plan.height : 16 / 9
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.05, 5000)
  camera.matrixAutoUpdate = true

  // The clay lighting preset, recreated identically in every host. `preset` is
  // a pin, not a switch: a new preset id is a new revision, not a render flag.
  const lighting = plan.lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, lighting.ambientIntensity)
  scene.add(ambientLight)
  const keyLight = new THREE.DirectionalLight(0xffffff, lighting.keyIntensity)
  keyLight.position.set(lighting.keyPosition[0], lighting.keyPosition[1], lighting.keyPosition[2])
  scene.add(keyLight)

  const ordered = topoOrder(plan.objects)
  const nodes = new Map<string, EntityNode>()
  const entities = new Map<string, THREE.Object3D>()
  const meshes = new Map<string, THREE.Mesh>()
  const raycastTargets: THREE.Object3D[] = []
  const ownedGeometries: THREE.BufferGeometry[] = []
  const ownedMaterials: THREE.Material[] = []

  // Pass 1 — a wrapper per entity, plus its geometry or asset subtree.
  for (const entity of ordered) {
    const wrapper = new THREE.Group()
    wrapper.name = entity.name || entity.id
    wrapper.userData.objectId = entity.id
    const node: EntityNode = {
      entity,
      wrapper,
      base: baseTransformOf(entity),
      clip: null,
      animation: null,
      meshes: [],
    }

    const visual = entity.visual
    if (visual.kind === "primitive") {
      const geometry = buildScene3DGeometry({
        primitive: visual.primitive,
        dimensions: visual.dimensions,
      } as unknown as Scene3DObject)
      if (geometry) {
        // A primitive's only editable role is the reserved `identity` one.
        const overrideColor = resolveOverlayColor(
          overlays,
          entity.id,
          SCENE3D_PRIMITIVE_MATERIAL_ROLE,
        )
        const material = clayMaterial(
          overrideColor ?? visual.color,
          visual.primitive === "plane",
        )
        const mesh = new THREE.Mesh(geometry, material)
        mesh.userData.objectId = entity.id
        wrapper.add(mesh)
        ownedGeometries.push(geometry)
        ownedMaterials.push(material)
        node.meshes.push(mesh)
      }
    } else if (visual.kind === "asset") {
      const asset = glbById.get(visual.assetId)
      check(!!asset, "SCENE_ASSET_UNAVAILABLE", "asset was not loaded", visual.assetId)
      const inspected = asset.inspection.entityRootsByNodeName.get(visual.rootNodeId)
      check(
        !!inspected,
        "SCENE_ASSET_BINDING",
        "entity root disappeared between inspection and build",
        entity.id,
      )
      const rootObject = findByRootNodeName(asset.scene, visual.rootNodeId)
      check(
        !!rootObject,
        "SCENE_ASSET_BINDING",
        `no loaded node has the exported name "${visual.rootNodeId}"`,
        entity.id,
      )
      // Detach from the GLB scene and mount under our wrapper. Its own local
      // transform is PRESERVED — it is the authoritative placement.
      rootObject.removeFromParent()
      wrapper.add(rootObject)

      applyClayMaterials(rootObject, entity, overlays, node, ownedMaterials)

      const clip = selectScene3DClip(asset.clips, visual.animation?.clipName, entity.id)
      if (clip && visual.animation) {
        node.animation = visual.animation
        // The allowlist is built from the MOUNTED objects, not from the raw
        // glTF names: `GLTFLoader` sanitizes and de-duplicates node names
        // (`box/body` → `boxbody`) and builds every track path from the
        // resulting `object.name`. Reading it back off the scene is exact by
        // construction; re-implementing the sanitize + dedupe would drift.
        const mountedNames = new Set<string>()
        rootObject.traverse((object) => {
          if (object.name) mountedNames.add(object.name)
        })
        node.clip = bindScene3DClip(wrapper, clip, mountedNames, entity.id)
      }
    }
    // `group` adds no geometry — it is organizational identity only.

    nodes.set(entity.id, node)
    entities.set(entity.id, wrapper)
    if (node.meshes.length > 0) {
      meshes.set(entity.id, node.meshes[0])
      raycastTargets.push(...node.meshes)
    }
  }

  // Pass 2 — parent the wrappers. `ordered` guarantees the parent exists.
  for (const entity of ordered) {
    const node = nodes.get(entity.id) as EntityNode
    const parent = entity.parentId ? entities.get(entity.parentId) : undefined
    if (parent && parent !== node.wrapper) parent.add(node.wrapper)
    else scene.add(node.wrapper)
  }

  const applyFrame = (frame: number): Scene3DV2FrameSample => {
    const f = Number.isFinite(frame) ? Math.floor(frame) : 0

    // 1. Baked asset state — deterministic, absolute-time clip evaluation.
    for (const node of nodes.values()) {
      if (!node.clip || !node.animation) continue
      const { startFrame, endFrameExclusive, loop } = node.animation
      const span = endFrameExclusive - startFrame
      let local = f - startFrame
      if (loop && span > 0) {
        // A modulo, not an accumulator: frame 400 and frame 400 after a scrub
        // to 12 land on exactly the same time.
        local = ((local % span) + span) % span
      } else if (local < 0) {
        local = 0
      } else if (local > span) {
        // Past the window: hold the last sample rather than freezing at 0.
        local = span
      }
      node.clip.apply(local / plan.fps)
    }

    // 2. Entity overrides, parents first so a world-space override can divide
    //    out an already-correct parent world matrix exactly once.
    for (const entity of ordered) {
      const node = nodes.get(entity.id) as EntityNode
      const parentWrapper = node.wrapper.parent
      const parentWorld = parentWrapper && parentWrapper !== scene ? parentWrapper.matrixWorld : null
      applyEntityTransformOverride(
        node.wrapper,
        node.base,
        overlays.entityTransforms.get(entity.id),
        parentWorld,
      )
      const visible = overlays.entityVisibility.get(entity.id)
      node.wrapper.visible = visible ?? true
      node.wrapper.updateMatrix()
      if (parentWorld) node.wrapper.matrixWorld.multiplyMatrices(parentWorld, node.wrapper.matrix)
      else node.wrapper.matrixWorld.copy(node.wrapper.matrix)
    }

    // 3. Camera: the sample IS index f. No interpolation, so a hard cut stays hard.
    const sample = sampleBakedCamera(cameraTrack, f)
    camera.position.set(sample.position[0], sample.position[1], sample.position[2])
    camera.quaternion.set(
      sample.quaternion[0],
      sample.quaternion[1],
      sample.quaternion[2],
      sample.quaternion[3],
    )
    const shotIndex = shots.indexAt(f)
    const shot = shots.shots[shotIndex]
    applyCameraShotOverride(camera, overlays.cameraShots.get(shot.id), sample)
    camera.projectionMatrix.fromArray(sample.projectionMatrix)
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    // Introspection only — the renderer reads `projectionMatrix`, and calling
    // `updateProjectionMatrix()` here would overwrite the baked one with a lens
    // approximation that cannot express sensor fit or lens shift.
    camera.near = sample.near
    camera.far = sample.far
    camera.aspect = aspect
    camera.updateMatrixWorld(true)

    scene.updateMatrixWorld(true)
    return { frame: f, shotId: shot.id, shotIndex, camera: sample }
  }

  const selectionBase = new Map<THREE.Mesh, number>()
  const setSelected = (ids: readonly string[]): void => {
    const selected = new Set(ids)
    for (const node of nodes.values()) {
      const on = selected.has(node.entity.id)
      for (const mesh of node.meshes) {
        const material = mesh.material as THREE.MeshStandardMaterial
        if (!material.emissive) continue
        if (!selectionBase.has(mesh)) selectionBase.set(mesh, material.emissive.getHex())
        if (on) {
          material.emissive.setHex(SELECTION_EMISSIVE)
          material.emissiveIntensity = 0.45
        } else {
          material.emissive.setHex(selectionBase.get(mesh) ?? 0x000000)
          material.emissiveIntensity = 1
        }
      }
    }
  }

  const dispose = (): void => {
    for (const node of nodes.values()) node.clip?.dispose()
    for (const geometry of ownedGeometries) geometry.dispose()
    for (const material of ownedMaterials) material.dispose()
    // Geometry that came from a GLB is owned by the loaded asset, not by this
    // handle — but nothing else will free it, so it is released here too.
    for (const asset of glbById.values()) {
      asset.scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.isMesh) mesh.geometry?.dispose()
      })
    }
    ownedGeometries.length = 0
    ownedMaterials.length = 0
    nodes.clear()
    entities.clear()
    meshes.clear()
    raycastTargets.length = 0
    scene.clear()
  }

  applyFrame(0)

  return { scene, camera, entities, meshes, raycastTargets, applyFrame, setSelected, dispose }
}

/**
 * Locate the mounted entity root by its EXPORTED node name.
 *
 * `GLTFLoader` preserves the raw glTF name in `userData.name` while sanitizing
 * `object.name`, so this matches `visual.rootNodeId` exactly. Searching by
 * `userData.nodaroEntityId` instead would be ambiguous — the root and every
 * mesh it owns carry the same id, and traversal order would decide.
 */
function findByRootNodeName(root: THREE.Object3D, rootNodeId: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null
  root.traverse((object) => {
    if (found) return
    if ((object.userData?.name as string | undefined) === rootNodeId) found = object
  })
  return found
}

/**
 * One pinned clay material implementation, shared by the browser preview, the
 * critic stills and the final export. Imported PBR is a later, separately
 * advertised mode — for a movement reference, identical shading everywhere is
 * worth more than material fidelity.
 */
function clayMaterial(color: string, doubleSided: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    // `THREE.Color` interprets a hex string as sRGB and converts it into the
    // working colour space exactly once (ColorManagement is on by default).
    color: new THREE.Color(color),
    roughness: CLAY_ROUGHNESS,
    metalness: CLAY_METALNESS,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  })
}

/**
 * Replace every material in the entity's subtree with clay, resolving colour
 * per material ROLE so recolouring a car's body paint leaves its tyres alone.
 *
 * Precedence: colour override for the role → the manifest binding's baked
 * colour → the entity's identity colour → the GLB's own base colour → clay
 * default. A binding may only name a material inside this entity's own asset
 * root, which is what stops "recolour the person" from reaching its chair.
 */
function applyClayMaterials(
  root: THREE.Object3D,
  entity: Scene3DEntityV2,
  overlays: Scene3DOverlayIndex,
  node: EntityNode,
  ownedMaterials: THREE.Material[],
): void {
  const roleByMaterialName = new Map<string, string>()
  const bindingByRole = new Map<string, { color?: string; roughness?: number }>()
  for (const binding of entity.materialBindings ?? []) {
    roleByMaterialName.set(binding.materialName, binding.role)
    bindingByRole.set(binding.role, { color: binding.color, roughness: binding.roughness })
  }

  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    const sourceName = source?.name ?? ""
    const role = roleByMaterialName.get(sourceName)
    const binding = role !== undefined ? bindingByRole.get(role) : undefined

    const overrideColor = resolveOverlayColor(overlays, entity.id, role)
    const bakedColor = (source as THREE.MeshStandardMaterial | undefined)?.color

    const material = new THREE.MeshStandardMaterial({
      roughness: binding?.roughness ?? CLAY_ROUGHNESS,
      metalness: CLAY_METALNESS,
      side: THREE.FrontSide,
    })
    material.name = sourceName
    if (overrideColor) material.color.set(new THREE.Color(overrideColor))
    else if (binding?.color) material.color.set(new THREE.Color(binding.color))
    else if (entity.identityColor) material.color.set(new THREE.Color(entity.identityColor))
    else if (bakedColor) material.color.copy(bakedColor) // already in working space
    else material.color.set(new THREE.Color(CLAY_DEFAULT_COLOR))

    // The GLB's materials are replaced wholesale, so free them here rather than
    // leaving them attached to a detached subtree.
    if (Array.isArray(mesh.material)) for (const m of mesh.material) m.dispose()
    else source?.dispose()

    mesh.material = material
    mesh.userData.objectId = entity.id
    ownedMaterials.push(material)
    node.meshes.push(mesh)
  })
}
