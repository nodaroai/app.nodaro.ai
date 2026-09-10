import { describe, it, expect } from "vitest"
import * as THREE from "three"
import { buildScene3DGeometry, buildScene3DScene } from "../scene-builder"
import { sampleScene3DFrame } from "../sampler"
import { makeObject, makePlan } from "./fixtures"

function extent(geometry: THREE.BufferGeometry): [number, number, number] {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox as THREE.Box3
  return [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z]
}

describe("buildScene3DGeometry — primitives are sized in meters from `dimensions`", () => {
  const cases: Array<[string, [number, number, number]]> = [
    ["box", [2, 3, 4]],
    ["sphere", [2, 3, 4]],
    ["cylinder", [2, 3, 4]],
    ["cone", [2, 3, 4]],
  ]

  for (const [primitive, dimensions] of cases) {
    it(`${primitive} spans its dimensions on every axis`, () => {
      const g = buildScene3DGeometry(makeObject({ id: primitive, primitive, dimensions } as never))
      expect(g).not.toBeNull()
      const [x, y, z] = extent(g as THREE.BufferGeometry)
      expect(x).toBeCloseTo(dimensions[0], 5)
      expect(y).toBeCloseTo(dimensions[1], 5)
      expect(z).toBeCloseTo(dimensions[2], 5)
    })
  }

  it("plane spans x/y and is flat on z", () => {
    const g = buildScene3DGeometry(makeObject({ id: "p", primitive: "plane", dimensions: [5, 2, 1] } as never))
    const [x, y, z] = extent(g as THREE.BufferGeometry)
    expect(x).toBeCloseTo(5, 5)
    expect(y).toBeCloseTo(2, 5)
    expect(z).toBeCloseTo(0, 5)
  })

  it("capsule's total height is dimensions.y with radius dimensions.x/2", () => {
    const g = buildScene3DGeometry(makeObject({ id: "c", primitive: "capsule", dimensions: [1, 3, 1] } as never))
    const [x, y] = extent(g as THREE.BufferGeometry)
    expect(y).toBeCloseTo(3, 2)
    expect(x).toBeCloseTo(1, 2)
  })

  it("preserves a squat capsule's full bounding dimensions", () => {
    const g = buildScene3DGeometry(makeObject({ id: "squat", primitive: "capsule", dimensions: [2, 0.5, 1] }))!
    const [x, y, z] = extent(g)
    expect(x).toBeCloseTo(2, 2)
    expect(y).toBeCloseTo(0.5, 2)
    expect(z).toBeCloseTo(1, 2)
    g.dispose()
  })

  it("group carries no geometry", () => {
    expect(buildScene3DGeometry(makeObject({ id: "g", primitive: "group" } as never))).toBeNull()
  })

  it("never produces degenerate geometry for a zero dimension", () => {
    const g = buildScene3DGeometry(makeObject({ id: "z", primitive: "box", dimensions: [0, 0, 0] } as never))
    const [x, y, z] = extent(g as THREE.BufferGeometry)
    expect(x).toBeGreaterThan(0)
    expect(y).toBeGreaterThan(0)
    expect(z).toBeGreaterThan(0)
  })
})

describe("buildScene3DScene", () => {
  it("mirrors the plan hierarchy in the three graph, even when a child is listed first", () => {
    const plan = makePlan({
      objects: [
        makeObject({ id: "child", parentId: "parent" }),
        makeObject({ id: "parent", primitive: "group" }),
      ],
    })
    const handle = buildScene3DScene(plan)
    const parent = handle.objects.get("parent") as THREE.Object3D
    const child = handle.objects.get("child") as THREE.Object3D
    expect(child.parent).toBe(parent)
    expect(parent.parent).toBe(handle.scene)
    expect(handle.meshes.has("parent")).toBe(false)
    expect(handle.meshes.has("child")).toBe(true)
    handle.dispose()
  })

  it("puts an object with an unknown parent at the scene root", () => {
    const plan = makePlan({ objects: [makeObject({ id: "o", parentId: "nope" })] })
    const handle = buildScene3DScene(plan)
    expect((handle.objects.get("o") as THREE.Object3D).parent).toBe(handle.scene)
    handle.dispose()
  })

  it("PARITY: three's own world matrix equals the sampler's at start, mid and end", () => {
    const plan = makePlan({
      durationInFrames: 48,
      objects: [
        makeObject({
          id: "parent",
          position: [0, 0, 0],
          keyframes: [{ frame: 48, position: [6, 1, -2], rotation: [0.3, Math.PI / 3, -0.2] }],
        }),
        makeObject({ id: "child", parentId: "parent", position: [1.5, 0.5, 0], scale: [2, 2, 2] }),
      ],
    })
    const handle = buildScene3DScene(plan)

    for (const frame of [0, 24, 48]) {
      handle.applyFrame(frame)
      handle.scene.updateMatrixWorld(true)
      const sample = sampleScene3DFrame(plan, frame)

      for (const id of ["parent", "child"]) {
        const node = handle.objects.get(id) as THREE.Object3D
        const expected = sample.byId[id].worldMatrix
        node.matrixWorld.elements.forEach((v, i) => {
          expect(v).toBeCloseTo(expected[i], 9)
        })
        expect(node.getWorldPosition(new THREE.Vector3()).toArray()).toEqual(
          sample.byId[id].worldPosition.map((n) => expect.closeTo(n, 9)) as never,
        )
      }
    }
    handle.dispose()
  })

  it("drives the camera from the plan: position, look direction and vertical FOV", () => {
    const plan = makePlan({
      durationInFrames: 40,
      camera: {
        position: [0, 0, 10],
        target: [0, 0, 0],
        focalLengthMm: 35,
        sensorWidthMm: 36,
        keyframes: [{ frame: 40, position: [10, 0, 0], focalLengthMm: 85 }],
      },
    } as never)
    const handle = buildScene3DScene(plan)

    handle.applyFrame(0)
    expect(handle.camera.position.toArray()).toEqual([0, 0, 10])
    expect(handle.camera.fov).toBeCloseTo(sampleScene3DFrame(plan, 0).camera.fovDeg, 10)

    handle.applyFrame(20)
    expect(handle.camera.position.toArray()).toEqual([5, 0, 5])

    handle.applyFrame(40)
    expect(handle.camera.position.toArray()).toEqual([10, 0, 0])
    // 85mm is much tighter than 35mm
    expect(handle.camera.fov).toBeLessThan(20)
    // camera looks at the target: -Z axis of the camera points at the origin
    const dir = new THREE.Vector3()
    handle.camera.getWorldDirection(dir)
    expect(dir.x).toBeCloseTo(-1, 6)
    handle.dispose()
  })

  it("applies plan lighting", () => {
    const plan = makePlan({ lighting: { ambientIntensity: 0.25, keyIntensity: 2, keyPosition: [1, 2, 3] } })
    const handle = buildScene3DScene(plan)
    expect(handle.ambientLight.intensity).toBe(0.25)
    expect(handle.keyLight.intensity).toBe(2)
    // The clay shadow fit slides the key light along its own axis so the shadow
    // camera can bound the scene. Only the DIRECTION is the plan's to state,
    // and that is preserved exactly.
    const direction = handle.keyLight.position.clone().sub(handle.keyLight.target.position).normalize()
    expect(direction.distanceTo(new THREE.Vector3(1, 2, 3).normalize())).toBeLessThan(1e-12)
    handle.dispose()
  })

  it("renders shadowed and ACES-tonemapped, deterministically", () => {
    const plan = makePlan({ objects: [makeObject({ id: "a" }), makeObject({ id: "b" })] })
    const handle = buildScene3DScene(plan)
    expect(handle.shadowMapEnabled).toBe(true)
    expect(handle.toneMapping).toBe(THREE.ACESFilmicToneMapping)
    expect(handle.toneMappingExposure).toBe(1.15)
    expect(handle.keyLight.castShadow).toBe(true)
    for (const mesh of handle.meshes.values()) {
      expect(mesh.castShadow).toBe(true)
      expect(mesh.receiveShadow).toBe(true)
    }
    // Same frame, same matrices: no wall-clock or RNG input anywhere in the fit.
    const snapshot = () => [
      ...handle.keyLight.shadow.camera.projectionMatrix.elements,
      ...handle.keyLight.shadow.camera.matrixWorld.elements,
    ]
    handle.applyFrame(7)
    const first = snapshot()
    handle.applyFrame(30)
    handle.applyFrame(7)
    expect(snapshot()).toEqual(first)
    handle.dispose()
  })

  it("uses the plan background color", () => {
    const handle = buildScene3DScene(makePlan({ backgroundColor: "#ff0000" }))
    expect((handle.scene.background as THREE.Color).getHexString()).toBe("ff0000")
    handle.dispose()
  })

  it("highlights only the selected meshes and restores the rest", () => {
    const plan = makePlan({ objects: [makeObject({ id: "a" }), makeObject({ id: "b" })] })
    const handle = buildScene3DScene(plan)
    handle.setSelected(["a"])
    const matA = (handle.meshes.get("a") as THREE.Mesh).material as THREE.MeshStandardMaterial
    const matB = (handle.meshes.get("b") as THREE.Mesh).material as THREE.MeshStandardMaterial
    expect(matA.emissive.getHex()).not.toBe(0)
    expect(matB.emissive.getHex()).toBe(0)
    handle.setSelected([])
    expect(matA.emissive.getHex()).toBe(0)
    handle.dispose()
  })

  it("disposes every geometry and material it created", () => {
    const plan = makePlan({ objects: [makeObject({ id: "a" }), makeObject({ id: "b", primitive: "sphere" })] })
    const handle = buildScene3DScene(plan)
    const disposed: string[] = []
    for (const [id, mesh] of handle.meshes) {
      mesh.geometry.addEventListener("dispose", () => disposed.push(`geometry:${id}`))
      ;(mesh.material as THREE.Material).addEventListener("dispose", () => disposed.push(`material:${id}`))
    }
    handle.dispose()
    expect(disposed.sort()).toEqual([
      "geometry:a",
      "geometry:b",
      "material:a",
      "material:b",
    ])
  })

  it("tags meshes with their plan object id for hit-testing", () => {
    const handle = buildScene3DScene(makePlan({ objects: [makeObject({ id: "hit-me" })] }))
    expect((handle.meshes.get("hit-me") as THREE.Mesh).userData.objectId).toBe("hit-me")
    handle.dispose()
  })
})
