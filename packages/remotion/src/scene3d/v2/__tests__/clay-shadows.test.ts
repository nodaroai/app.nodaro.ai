import { expect, it, vi } from "vitest"
import * as THREE from "three"
import { createClayShadows } from "../../clay-shadows"
import { buildScene3DV2Scene } from "../scene-builder-v2"
import { loadScene3DV2 } from "../load"
import { makeLoadableScene, primitiveEntity } from "./v2-fixtures"

it("keeps reflected, scaled and translated geometry inside the shadow camera on every scrub", () => {
  const scene = new THREE.Scene()
  const parent = new THREE.Group()
  parent.scale.set(-2, 0.5, 3)
  parent.rotation.set(0.2, 0.8, 0.1)
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4))
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  hidden.position.set(10000, 10000, 10000)
  const hiddenParent = new THREE.Group()
  hiddenParent.visible = false
  hiddenParent.add(hidden)
  parent.add(mesh)
  scene.add(parent, hiddenParent)
  const light = new THREE.DirectionalLight()
  light.position.set(6, 8, 5)
  scene.add(light, light.target)
  const shadows = createClayShadows(light)
  const snapshots = new Map<number, number[]>()
  for (const x of [0, 300, -200, 0, -200, 300]) {
    parent.position.set(x, 10, -40)
    scene.updateMatrixWorld(true)
    shadows.update([mesh, hidden])
    const camera = light.shadow.camera
    const snapshot = [...camera.projectionMatrix.elements, ...camera.matrixWorld.elements]
    if (snapshots.has(x)) expect(snapshot).toEqual(snapshots.get(x))
    else snapshots.set(x, snapshot)
    expect(camera.right - camera.left).toBeLessThan(30)
    for (const cx of [-1, 1]) for (const cy of [-1.5, 1.5]) for (const cz of [-2, 2]) {
      const projected = new THREE.Vector3(cx, cy, cz).applyMatrix4(mesh.matrixWorld).project(camera)
      expect(Math.max(Math.abs(projected.x), Math.abs(projected.y), Math.abs(projected.z))).toBeLessThan(1)
    }
    expect(light.position.clone().sub(light.target.position).normalize().distanceTo(new THREE.Vector3(6, 8, 5).normalize())).toBeLessThan(1e-12)
  }
  shadows.update([])
  expect(light.castShadow).toBe(false)
  const dispose = vi.spyOn(light.shadow, "dispose")
  shadows.dispose()
  expect(dispose).toHaveBeenCalledOnce()
  mesh.geometry.dispose()
  hidden.geometry.dispose()
})

for (const preset of ["clay-studio-v1", "clay-studio-v2"] as const) {
  it(`wires ${preset} through the loaded scene without changing the legacy preset`, async () => {
    const { plan, resolver } = makeLoadableScene({ objects: [primitiveEntity({ id: "box" })] })
    const loaded = await loadScene3DV2({ ...plan, lighting: { ...plan.lighting, preset } }, {
      resolver, signal: new AbortController().signal,
    })
    const handle = buildScene3DV2Scene(loaded)
    try {
      expect(handle.shadowMapEnabled).toBe(preset === "clay-studio-v2")
      for (const mesh of handle.meshes.values()) {
        expect(mesh.castShadow).toBe(preset === "clay-studio-v2")
        expect(mesh.receiveShadow).toBe(preset === "clay-studio-v2")
      }
      const light = handle.scene.children.find(child => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight
      expect(light.castShadow).toBe(preset === "clay-studio-v2")
      if (preset === "clay-studio-v1") expect(light.position.toArray()).toEqual(plan.lighting.keyPosition)
    } finally { handle.dispose() }
  })
}
