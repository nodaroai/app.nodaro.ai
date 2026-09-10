/**
 * Deterministic, bounded shadow mapping for the clay look.
 *
 * Shared by BOTH scene builders — v1 (`../scene-builder.ts`, unconditionally)
 * and v2 (`v2/scene-builder-v2.ts`, under the `clay-studio-v2` preset) — which
 * is why it sits beside them rather than under `v2/`. One implementation is the
 * point: the shadow camera is fitted from the frame's own world-space bounds
 * and nothing else, so the browser preview and the Remotion export derive the
 * identical matrices from the identical frame. No wall-clock input, no RNG.
 */
import * as THREE from "three"

const MAP_SIZE = 2048

function visible(object: THREE.Object3D): boolean {
  for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
    if (!parent.visible) return false
  }
  return true
}

/** Fit the light's shadow camera to the current frame without changing its direction. */
export function createClayShadows(light: THREE.DirectionalLight) {
  const direction = light.position.clone().normalize()
  const bounds = new THREE.Box3()
  const lightBounds = new THREE.Box3()
  const localBounds = new THREE.Box3()
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  const corner = new THREE.Vector3()
  const camera = light.shadow.camera
  light.shadow.mapSize.set(MAP_SIZE, MAP_SIZE)
  light.shadow.bias = -0.00001
  light.shadow.normalBias = 0.005

  return {
    update(meshes: Iterable<THREE.Mesh>): void {
      bounds.makeEmpty()
      for (const mesh of meshes) {
        if (!visible(mesh)) continue
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
          const skinned = mesh as THREE.SkinnedMesh
          skinned.computeBoundingBox()
          if (skinned.boundingBox) localBounds.copy(skinned.boundingBox)
          else continue
        } else {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
          if (mesh.geometry.boundingBox) localBounds.copy(mesh.geometry.boundingBox)
          else continue
        }
        bounds.union(localBounds.applyMatrix4(mesh.matrixWorld))
      }
      light.castShadow = !bounds.isEmpty() && direction.lengthSq() > 0 && light.intensity > 0
      if (!light.castShadow) return

      bounds.getCenter(center)
      const radius = Math.max(0.1, bounds.getSize(size).length() / 2)
      light.position.copy(center).addScaledVector(direction, radius * 2 + 1)
      light.target.position.copy(center)
      light.updateMatrixWorld(true)
      light.target.updateMatrixWorld(true)
      camera.position.copy(light.position)
      camera.lookAt(center)
      camera.updateMatrixWorld(true)

      lightBounds.makeEmpty()
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            lightBounds.expandByPoint(corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse))
          }
        }
      }
      const padding = Math.max(0.05, radius * 0.05)
      camera.left = lightBounds.min.x - padding
      camera.right = lightBounds.max.x + padding
      camera.bottom = lightBounds.min.y - padding
      camera.top = lightBounds.max.y + padding
      camera.near = Math.max(0.01, -lightBounds.max.z - padding)
      camera.far = Math.max(camera.near + 0.1, -lightBounds.min.z + padding)
      camera.updateProjectionMatrix()
    },
    dispose(): void { light.shadow.dispose() },
  }
}
