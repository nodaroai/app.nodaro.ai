/**
 * Builds the three.js object graph for a Scene3DPlanV1 and drives it from the
 * frame sampler.
 *
 * Split out of the canvas component on purpose: everything here is testable in
 * plain node (three's scene graph math needs no WebGL), so the hierarchy and
 * primitive contracts are covered without a browser. Only `Scene3DCanvas`
 * instantiates a `WebGLRenderer`.
 */
import * as THREE from "three"
import type { Scene3DObject, Scene3DPlanV1, Vec3 } from "./types"
import type { Scene3DRenderHandle } from "./handle"
import { sampleScene3DFrame, type Scene3DFrameSample } from "./sampler"

export interface Scene3DSceneHandle extends Scene3DRenderHandle {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** Every plan object, including `group` nodes (which carry no mesh). */
  objects: Map<string, THREE.Object3D>
  meshes: Map<string, THREE.Mesh>
  /** v1 has one mesh per object, so this is just `meshes.values()`. */
  raycastTargets: THREE.Object3D[]
  ambientLight: THREE.AmbientLight
  keyLight: THREE.DirectionalLight
  /** Apply the sampled state of `frame`. Returns the sample that was applied. */
  applyFrame(frame: number): Scene3DFrameSample
  /** Highlight the given ids (selection affordance for the canvas UI). */
  setSelected(ids: readonly string[]): void
  dispose(): void
}

/** Geometry must never be degenerate — a zero dimension crashes normals math. */
const MIN_DIM = 1e-4

function dims(object: Scene3DObject): Vec3 {
  const d = object.dimensions as readonly number[] | undefined
  const read = (i: number, fallback: number) => {
    const v = d && typeof d[i] === "number" ? Math.abs(d[i]) : fallback
    return Math.max(MIN_DIM, v)
  }
  return [read(0, 1), read(1, 1), read(2, 1)]
}

/**
 * Primitive → geometry, sized in METERS from `dimensions` (a unit primitive
 * scaled by the dimension triple), so `scale` stays free for animation.
 * `dimensions` = the full bounding extent on each axis for every primitive.
 */
export function buildScene3DGeometry(object: Scene3DObject): THREE.BufferGeometry | null {
  const [dx, dy, dz] = dims(object)

  switch (object.primitive) {
    case "box":
      return new THREE.BoxGeometry(dx, dy, dz)
    case "sphere": {
      const g = new THREE.SphereGeometry(0.5, 32, 16)
      g.scale(dx, dy, dz)
      return g
    }
    case "cylinder": {
      const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
      g.scale(dx, dy, dz)
      return g
    }
    case "cone": {
      const g = new THREE.ConeGeometry(0.5, 1, 32)
      g.scale(dx, dy, dz)
      return g
    }
    case "plane": {
      // Spans dimensions.x × dimensions.y in the XY plane facing +Z; rotate it
      // (-PI/2 on X) to get a floor. DoubleSide so a floor stays visible from below.
      return new THREE.PlaneGeometry(dx, dy)
    }
    case "capsule": {
      // Total height = dimensions.y, radius = dimensions.x / 2, then squashed
      // on Z so a non-uniform dimensions triple is still honoured.
      const radius = dx / 2
      const length = Math.max(0, dy - dx)
      const g = new THREE.CapsuleGeometry(radius, length, 8, 24)
      // A squat capsule still honors its requested height; without this
      // factor its hemispheres force a minimum height equal to its width.
      g.scale(1, dy / (length + dx), dz / dx)
      return g
    }
    case "group":
      return null
    default:
      return new THREE.BoxGeometry(dx, dy, dz)
  }
}

function materialFor(object: Scene3DObject): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(object.color || "#cccccc"),
    // Clay look: matte, barely any specular — previz, not a beauty render.
    roughness: 0.78,
    metalness: 0.02,
    side: object.primitive === "plane" ? THREE.DoubleSide : THREE.FrontSide,
  })
}

/**
 * Build scene, camera and lights for a plan. The returned handle owns every
 * GPU-backed resource it created — call `dispose()` on unmount.
 */
export function buildScene3DScene(plan: Scene3DPlanV1): Scene3DSceneHandle {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(plan.backgroundColor || "#000000")

  const aspect = plan.height > 0 ? plan.width / plan.height : 16 / 9
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.05, 5000)

  const lighting = plan.lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, lighting?.ambientIntensity ?? 0.6)
  scene.add(ambientLight)

  const keyPos = (lighting?.keyPosition as readonly number[] | undefined) ?? [5, 8, 6]
  const keyLight = new THREE.DirectionalLight(0xffffff, lighting?.keyIntensity ?? 1)
  keyLight.position.set(keyPos[0] ?? 5, keyPos[1] ?? 8, keyPos[2] ?? 6)
  scene.add(keyLight)

  const objects = new Map<string, THREE.Object3D>()
  const meshes = new Map<string, THREE.Mesh>()
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.MeshStandardMaterial[] = []
  const baseEmissive = new Map<string, number>()

  // Pass 1 — create every node. `objects` may list a child before its parent,
  // so parenting cannot happen here.
  for (const obj of plan.objects ?? []) {
    const geometry = buildScene3DGeometry(obj)
    let node: THREE.Object3D
    if (geometry) {
      const material = materialFor(obj)
      const mesh = new THREE.Mesh(geometry, material)
      geometries.push(geometry)
      materials.push(material)
      meshes.set(obj.id, mesh)
      baseEmissive.set(obj.id, material.emissive.getHex())
      node = mesh
    } else {
      node = new THREE.Group()
    }
    node.name = obj.name || obj.id
    node.userData.objectId = obj.id
    node.matrixAutoUpdate = true
    objects.set(obj.id, node)
  }

  // Pass 2 — parent. Unknown parentId falls back to the scene root.
  for (const obj of plan.objects ?? []) {
    const node = objects.get(obj.id)
    if (!node) continue
    const parent = obj.parentId ? objects.get(obj.parentId) : undefined
    if (parent && parent !== node) parent.add(node)
    else scene.add(node)
  }

  const applyFrame = (frame: number): Scene3DFrameSample => {
    const sample = sampleScene3DFrame(plan, frame)
    for (const objSample of sample.objects) {
      const node = objects.get(objSample.id)
      if (!node) continue
      node.position.set(objSample.position[0], objSample.position[1], objSample.position[2])
      node.rotation.set(
        objSample.rotation[0],
        objSample.rotation[1],
        objSample.rotation[2],
        "XYZ",
      )
      node.scale.set(objSample.scale[0], objSample.scale[1], objSample.scale[2])
    }

    const cam = sample.camera
    camera.position.set(cam.position[0], cam.position[1], cam.position[2])
    camera.up.set(0, 1, 0)
    camera.lookAt(cam.target[0], cam.target[1], cam.target[2])
    camera.fov = cam.fovDeg
    camera.aspect = aspect
    camera.updateProjectionMatrix()

    scene.updateMatrixWorld(true)
    return sample
  }

  const setSelected = (ids: readonly string[]): void => {
    const selected = new Set(ids)
    for (const [id, mesh] of meshes) {
      const material = mesh.material as THREE.MeshStandardMaterial
      if (selected.has(id)) {
        material.emissive.setHex(0x2a6cff)
        material.emissiveIntensity = 0.45
      } else {
        material.emissive.setHex(baseEmissive.get(id) ?? 0x000000)
        material.emissiveIntensity = 1
      }
    }
  }

  const dispose = (): void => {
    for (const g of geometries) g.dispose()
    for (const m of materials) m.dispose()
    geometries.length = 0
    materials.length = 0
    objects.clear()
    meshes.clear()
    scene.clear()
  }

  applyFrame(0)

  return {
    scene,
    camera,
    objects,
    meshes,
    raycastTargets: [...meshes.values()],
    ambientLight,
    keyLight,
    applyFrame,
    setSelected,
    dispose,
  }
}
