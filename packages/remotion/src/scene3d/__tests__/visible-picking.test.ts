import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { raycastVisibleSceneObjects } from "../handle"

describe("scene picking visibility", () => {
  it.each(["mesh", "parent", "scene"])("skips a nearer hit hidden by its %s and selects the visible object behind", (hidden) => {
    const scene = new THREE.Scene()
    const parent = new THREE.Group()
    const geometry = new THREE.BoxGeometry()
    const material = new THREE.MeshBasicMaterial()
    const near = new THREE.Mesh(geometry, material)
    const far = new THREE.Mesh(geometry, material)
    parent.add(near)
    scene.add(parent)
    far.position.z = -3
    scene.add(far)
    scene.updateMatrixWorld(true)
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1))
    expect(raycastVisibleSceneObjects(raycaster, [parent, far])[0].object).toBe(near)
    const target = hidden === "mesh" ? near : hidden === "parent" ? parent : scene
    target.visible = false
    // Native Three still hits the hidden mesh, even when given a recursive group target.
    expect(raycaster.intersectObjects([parent, far], true)[0].object).toBe(near)
    const hits = raycastVisibleSceneObjects(raycaster, [parent, far])
    if (hidden === "scene") expect(hits).toEqual([])
    else expect(hits[0].object).toBe(far)
    target.visible = true
    expect(raycastVisibleSceneObjects(raycaster, [near, far])[0].object).toBe(near)
    geometry.dispose()
    material.dispose()
  })
})
