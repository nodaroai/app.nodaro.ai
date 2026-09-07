import { describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { loadScene3DV2 } from "../load"
import { buildScene3DV2Scene } from "../scene-builder-v2"
import type { Scene3DEntityV2, Scene3DPlanV2 } from "../plan-shape"
import { makeGlb, type MakeGlbOptions } from "./glb-fixtures"
import {
  groupEntity,
  makeCameraTrack,
  makeLoadableScene,
  primitiveEntity,
} from "./v2-fixtures"

const signal = () => new AbortController().signal

/** A car whose body slides 0 → 4 metres on x over 2 seconds (48 frames @ 24). */
const DRIVING_CAR: MakeGlbOptions = {
  nodes: [
    {
      name: "car",
      entityRootId: "car",
      animateTranslation: {
        clip: "drive",
        times: [0, 1, 2],
        values: [
          [0, 0, 0],
          [2, 0, 0],
          [4, 0, 0],
        ],
      },
      children: [
        { name: "Body", mesh: true, materialName: "bodyPaint" },
        { name: "WheelFL", mesh: true, materialName: "rubber" },
      ],
    },
  ],
}

function carEntity(overrides: Partial<Scene3DEntityV2> = {}): Scene3DEntityV2 {
  return {
    id: "car",
    // Deliberately NOT "Car": the wrapper takes the entity name, and a
    // collision with the GLB node name would make `getObjectByName` in these
    // tests resolve the (never-animated) wrapper instead of the baked node.
    name: "CarEntity",
    role: "vehicle",
    // The animation binding maps the GLB clip onto public frames; without one
    // the entity holds its baked pose (exercised below).
    visual: {
      kind: "asset",
      assetId: "glb",
      rootNodeId: "car",
      animation: { clipName: "drive", startFrame: 0, endFrameExclusive: 48 },
    },
    ...overrides,
  } as Scene3DEntityV2
}

async function buildScene(options: Parameters<typeof makeLoadableScene>[0]) {
  const { plan, resolver } = makeLoadableScene(options)
  const loaded = await loadScene3DV2(plan, { resolver, signal: signal() })
  return { handle: buildScene3DV2Scene(loaded), plan: plan as Scene3DPlanV2 }
}

function worldXOf(handle: { scene: THREE.Scene }, nodeName: string): number {
  const node = handle.scene.getObjectByName(nodeName)
  if (!node) throw new Error(`no node named ${nodeName}`)
  return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).x
}

describe("v2 scene assembly", () => {
  it("mounts the GLB entity root under its own wrapper", async () => {
    const { handle } = await buildScene({ glb: makeGlb(DRIVING_CAR), objects: [carEntity()] })
    const wrapper = handle.entities.get("car")
    expect(wrapper).toBeDefined()
    expect(wrapper?.getObjectByName("car")).toBeTruthy()
    expect(wrapper?.getObjectByName("Body")).toBeTruthy()
    handle.dispose()
  })

  it("tags every sub-mesh with the SEMANTIC entity id for hit-testing", async () => {
    const { handle } = await buildScene({ glb: makeGlb(DRIVING_CAR), objects: [carEntity()] })
    expect(handle.raycastTargets.length).toBe(2) // Body + WheelFL
    for (const target of handle.raycastTargets) {
      expect(target.userData.objectId).toBe("car")
    }
    handle.dispose()
  })

  it("parents an entity under its declared parent entity", async () => {
    const { handle } = await buildScene({
      objects: [
        groupEntity({ id: "rig", position: [10, 0, 0] }),
        primitiveEntity({ id: "prop", parentId: "rig", position: [1, 0, 0] }),
      ],
    })
    handle.applyFrame(0)
    const prop = handle.entities.get("prop") as THREE.Object3D
    expect(new THREE.Vector3().setFromMatrixPosition(prop.matrixWorld).x).toBeCloseTo(11, 10)
    handle.dispose()
  })

  it("applies the clay material and the entity identity colour", async () => {
    const { handle } = await buildScene({
      glb: makeGlb(DRIVING_CAR),
      objects: [carEntity({ identityColor: "#ff0000" })],
    })
    const mesh = handle.raycastTargets[0] as THREE.Mesh
    const material = mesh.material as THREE.MeshStandardMaterial
    expect(material.roughness).toBeCloseTo(0.78, 6)
    expect(material.metalness).toBeCloseTo(0.02, 6)
    // #ff0000 is sRGB; three converts it into the working space exactly once.
    expect(material.color.getHexString()).toBe("ff0000")
    handle.dispose()
  })

  it("recolours only the bound material role, leaving siblings alone", async () => {
    const { handle } = await buildScene({
      glb: makeGlb(DRIVING_CAR),
      objects: [
        carEntity({
          materialBindings: [{ role: "paint", materialName: "bodyPaint", color: "#00ff00" }],
        }),
      ],
    })
    const byName = new Map(
      handle.raycastTargets.map((t) => [
        ((t as THREE.Mesh).material as THREE.MeshStandardMaterial).name,
        (t as THREE.Mesh).material as THREE.MeshStandardMaterial,
      ]),
    )
    expect(byName.get("bodyPaint")?.color.getHexString()).toBe("00ff00")
    expect(byName.get("rubber")?.color.getHexString()).not.toBe("00ff00")
    handle.dispose()
  })
})

describe("baked animation is deterministic under random-order scrubbing", () => {
  it("gives the same pose for a frame regardless of the order frames were asked for", async () => {
    const { handle } = await buildScene({ glb: makeGlb(DRIVING_CAR), objects: [carEntity()] })

    const sequential = new Map<number, number>()
    for (let frame = 0; frame < 48; frame++) {
      handle.applyFrame(frame)
      sequential.set(frame, worldXOf(handle, "car"))
    }

    // A deterministic shuffle: render-worker frame order, a backward scrub and
    // a pause all reduce to "ask for frames in some order".
    const shuffled = [47, 0, 23, 46, 1, 12, 47, 0, 31, 5, 44, 22]
    for (const frame of shuffled) {
      handle.applyFrame(frame)
      expect(worldXOf(handle, "car")).toBeCloseTo(sequential.get(frame) as number, 10)
    }
    handle.dispose()
  })

  it("returns to the exact frame-0 pose after visiting the last frame", async () => {
    const { handle } = await buildScene({ glb: makeGlb(DRIVING_CAR), objects: [carEntity()] })
    const atZero = worldXOf(handle, "car")
    handle.applyFrame(47)
    handle.applyFrame(0)
    expect(worldXOf(handle, "car")).toBeCloseTo(atZero, 12)
    handle.dispose()
  })

  it("matches a freshly built scene at the same frame", async () => {
    const options = { glb: makeGlb(DRIVING_CAR), objects: [carEntity()] }
    const a = await buildScene(options)
    for (const frame of [40, 3, 17]) a.handle.applyFrame(frame)
    a.handle.applyFrame(19)
    const scrubbed = worldXOf(a.handle, "car")
    a.handle.dispose()

    const b = await buildScene(options)
    b.handle.applyFrame(19)
    expect(worldXOf(b.handle, "car")).toBeCloseTo(scrubbed, 12)
    b.handle.dispose()
  })

  it("samples the clip at time = frame / fps", async () => {
    // 0 → 4 m over 2 s. Frame 24 (t = 1 s) must be exactly half way.
    const { handle } = await buildScene({ glb: makeGlb(DRIVING_CAR), objects: [carEntity()] })
    handle.applyFrame(24)
    expect(worldXOf(handle, "car")).toBeCloseTo(2, 6)
    handle.applyFrame(12)
    expect(worldXOf(handle, "car")).toBeCloseTo(1, 6)
    handle.dispose()
  })

  it("holds the last key past the end of the clip rather than looping", async () => {
    const { handle } = await buildScene({
      glb: makeGlb(DRIVING_CAR),
      objects: [carEntity()],
      durationInFrames: 96,
      track: makeCameraTrack({ frameCount: 96 }),
      shots: [{ id: "only", startFrame: 0, endFrameExclusive: 96 }],
    })
    handle.applyFrame(95) // t = 3.96s, well past the 2s clip
    expect(worldXOf(handle, "car")).toBeCloseTo(4, 6)
    handle.dispose()
  })

  it("rejects a named clip the asset does not contain — at LOAD, not mid-render", async () => {
    // "The car does not move" is far harder to notice in a 720-frame render
    // than a load error, so a missing clip never falls back to clip 0.
    const { plan, resolver } = makeLoadableScene({
      glb: makeGlb(DRIVING_CAR),
      objects: [
        carEntity({
          visual: {
            kind: "asset",
            assetId: "glb",
            rootNodeId: "car",
            animation: { clipName: "reverse", startFrame: 0, endFrameExclusive: 48 },
          },
        }),
      ],
    })
    await expect(loadScene3DV2(plan, { resolver, signal: signal() })).rejects.toThrow(
      /animation clip "reverse" is not in asset/,
    )
  })

  it("holds the baked pose when the entity maps no clip onto frames", async () => {
    const { handle } = await buildScene({
      glb: makeGlb(DRIVING_CAR),
      objects: [
        carEntity({ visual: { kind: "asset", assetId: "glb", rootNodeId: "car" } }),
      ],
    })
    handle.applyFrame(47)
    expect(worldXOf(handle, "car")).toBeCloseTo(0, 6)
    handle.dispose()
  })
})

describe("camera comes from the sidecar, untouched", () => {
  it("copies position, quaternion and projection matrix verbatim", async () => {
    const track = makeCameraTrack({ frameCount: 48 })
    const { handle } = await buildScene({ track })
    handle.applyFrame(17)
    const expected = track.samples[17]
    expect(handle.camera.position.toArray()).toEqual(expected.position)
    expect([
      handle.camera.quaternion.x,
      handle.camera.quaternion.y,
      handle.camera.quaternion.z,
      handle.camera.quaternion.w,
    ]).toEqual(expected.quaternion)
    expect(handle.camera.projectionMatrix.toArray()).toEqual(expected.projectionMatrix)
    handle.dispose()
  })

  it("keeps projectionMatrixInverse consistent with the baked matrix", async () => {
    const { handle } = await buildScene({})
    handle.applyFrame(3)
    const roundTrip = handle.camera.projectionMatrix
      .clone()
      .multiply(handle.camera.projectionMatrixInverse)
    for (const [index, value] of roundTrip.toArray().entries()) {
      expect(value).toBeCloseTo(index % 5 === 0 ? 1 : 0, 6)
    }
    handle.dispose()
  })

  it("never calls lookAt() — that would discard roll and handheld", async () => {
    const { plan, resolver } = makeLoadableScene({})
    const loaded = await loadScene3DV2(plan, { resolver, signal: signal() })
    const spy = vi.spyOn(THREE.Object3D.prototype, "lookAt")
    const handle = buildScene3DV2Scene(loaded)
    for (const frame of [0, 5, 20, 47]) handle.applyFrame(frame)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
    handle.dispose()
  })

  it("never calls updateProjectionMatrix() after construction", async () => {
    const { plan, resolver } = makeLoadableScene({})
    const loaded = await loadScene3DV2(plan, { resolver, signal: signal() })
    const handle = buildScene3DV2Scene(loaded)
    // Spy AFTER construction: three's own constructor legitimately calls it,
    // and what must never happen is a per-frame lens re-derivation.
    const spy = vi.spyOn(handle.camera, "updateProjectionMatrix")
    for (const frame of [0, 5, 20, 47]) handle.applyFrame(frame)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
    handle.dispose()
  })

  it("does not blend across a hard cut", async () => {
    // Two shots with disjoint camera positions: the frame at the cut must be
    // exactly the baked sample, not a mix of the two sides.
    const track = makeCameraTrack({
      frameCount: 48,
      positionAt: (frame) => (frame < 24 ? [0, 0, 10] : [100, 0, 10]),
    })
    const { handle } = await buildScene({
      track,
      shots: [
        { id: "a", startFrame: 0, endFrameExclusive: 24 },
        { id: "b", startFrame: 24, endFrameExclusive: 48 },
      ],
    })
    handle.applyFrame(23)
    expect(handle.camera.position.x).toBe(0)
    const cut = handle.applyFrame(24)
    expect(handle.camera.position.x).toBe(100)
    expect(cut.shotId).toBe("b")
    handle.dispose()
  })

  it("reports the shot each frame belongs to", async () => {
    const { handle } = await buildScene({
      shots: [
        { id: "a", startFrame: 0, endFrameExclusive: 24 },
        { id: "b", startFrame: 24, endFrameExclusive: 48 },
      ],
    })
    expect(handle.applyFrame(0).shotId).toBe("a")
    expect(handle.applyFrame(23).shotId).toBe("a")
    expect(handle.applyFrame(24).shotId).toBe("b")
    expect(handle.applyFrame(47).shotId).toBe("b")
    handle.dispose()
  })
})
