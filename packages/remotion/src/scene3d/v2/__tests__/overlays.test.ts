import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { buildOverlayIndex } from "../overlays"
import { loadScene3DV2 } from "../load"
import { buildScene3DV2Scene } from "../scene-builder-v2"
import type { Scene3DEntityV2, Scene3DOverride } from "../plan-shape"
import { makeGlb } from "./glb-fixtures"
import {
  groupEntity,
  makeCameraTrack,
  makeLoadableScene,
  makeV2Plan,
  override,
  primitiveEntity,
} from "./v2-fixtures"

const signal = () => new AbortController().signal

const PARENTED: Scene3DEntityV2[] = [
  groupEntity({
    id: "rig",
    position: [10, 0, 0],
    rotation: [0, Math.PI / 2, 0],
    scale: [2, 2, 2],
  }),
  primitiveEntity({ id: "prop", parentId: "rig", position: [1, 0, 0] }),
]

async function build(options: Parameters<typeof makeLoadableScene>[0]) {
  const { plan, resolver } = makeLoadableScene(options)
  const loaded = await loadScene3DV2(plan, { resolver, signal: signal() })
  return buildScene3DV2Scene(loaded)
}

function worldOf(handle: { entities: Map<string, THREE.Object3D> }, id: string): THREE.Vector3 {
  const node = handle.entities.get(id)
  if (!node) throw new Error(`no entity ${id}`)
  return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld)
}

describe("overlay index", () => {
  it("rejects an override that targets a missing entity", () => {
    const plan = makeV2Plan({
      overrides: [
        override({ kind: "entity-transform", entityId: "ghost", space: "local", position: [1, 0, 0] }),
      ],
    })
    expect(() => buildOverlayIndex(plan)).toThrow(/not in this plan/)
  })

  it("rejects a camera override that targets a missing shot", () => {
    const plan = makeV2Plan({
      overrides: [override({ kind: "camera-shot-offset", shotId: "ghost", positionOffset: [1, 0, 0] })],
    })
    expect(() => buildOverlayIndex(plan)).toThrow(/not in this plan/)
  })

  it("refuses an override kind this renderer does not implement", () => {
    const plan = makeV2Plan({ overrides: [{ kind: "teleport" } as unknown as Scene3DOverride] })
    expect(() => buildOverlayIndex(plan)).toThrow(/does not implement override kind/)
  })

  it("indexes colours by role and visibility by entity", () => {
    const index = buildOverlayIndex(
      makeV2Plan({
        objects: [groupEntity({ id: "hero" })],
        overrides: [
          override({
            kind: "entity-color",
            entityId: "hero",
            materialRole: "bodyPaint",
            color: "#222222",
          }),
          override({ kind: "entity-visibility", entityId: "hero", visible: false }),
        ],
      }),
    )
    expect(index.entityColors.get("hero")?.get("bodyPaint")).toBe("#222222")
    expect(index.entityVisibility.get("hero")).toBe(false)
  })

  it("flags that a re-aiming override needs the track's target", () => {
    const plain = buildOverlayIndex(
      makeV2Plan({
        overrides: [override({ kind: "camera-shot-offset", shotId: "only", positionOffset: [1, 0, 0] })],
      }),
    )
    expect(plain.needsCameraTarget).toBe(false)
    const aiming = buildOverlayIndex(
      makeV2Plan({
        overrides: [override({ kind: "camera-shot-offset", shotId: "only", targetOffset: [1, 0, 0] })],
      }),
    )
    expect(aiming.needsCameraTarget).toBe(true)
  })
})

describe("entity transform overlays", () => {
  it("leaves the baked transform alone when there is no override", async () => {
    const handle = await build({ objects: PARENTED })
    handle.applyFrame(0)
    // rig: T(10,0,0) R(y 90°) S(2); prop local (1,0,0) → rotated to (0,0,-2) + 10
    const world = worldOf(handle, "prop")
    expect(world.x).toBeCloseTo(10, 6)
    expect(world.z).toBeCloseTo(-2, 6)
    handle.dispose()
  })

  it("a local override replaces only the channels it names", async () => {
    const handle = await build({
      objects: PARENTED,
      overrides: [
        override({ kind: "entity-transform", entityId: "prop", space: "local", position: [0, 5, 0] }),
      ],
    })
    handle.applyFrame(0)
    const node = handle.entities.get("prop") as THREE.Object3D
    expect(node.position.toArray()).toEqual([0, 5, 0])
    // scale was not named, so it keeps its baked value
    expect(node.scale.toArray()).toEqual([1, 1, 1])
    handle.dispose()
  })

  it("a world override lands the entity exactly where it was asked for", async () => {
    // THE parent-double-multiply trap: the prop's parent has a 90° yaw and a 2x
    // scale. Writing a world matrix straight into the local slot would apply
    // that parent a second time and put the prop somewhere else entirely.
    const handle = await build({
      objects: PARENTED,
      overrides: [
        override({ kind: "entity-transform", entityId: "prop", space: "world", position: [7, 3, -1] }),
      ],
    })
    handle.applyFrame(0)
    const world = worldOf(handle, "prop")
    expect(world.x).toBeCloseTo(7, 6)
    expect(world.y).toBeCloseTo(3, 6)
    expect(world.z).toBeCloseTo(-1, 6)
    handle.dispose()
  })

  it("a world override keeps the channels it does not name", async () => {
    const before = await build({ objects: PARENTED })
    before.applyFrame(0)
    const original = worldOf(before, "prop")
    before.dispose()
    expect(original.y).toBeCloseTo(0, 6)

    const handle = await build({
      objects: PARENTED,
      overrides: [
        override({ kind: "entity-transform", entityId: "prop", space: "world", position: [0, 4, 0] }),
      ],
    })
    handle.applyFrame(0)
    expect(worldOf(handle, "prop").y).toBeCloseTo(4, 6)
    // Scale was not named, so the parent's 2x still applies underneath.
    const node = handle.entities.get("prop") as THREE.Object3D
    expect(node.scale.x).toBeCloseTo(1, 6)
    handle.dispose()
  })

  it("moving a parent entity carries its children", async () => {
    const handle = await build({
      objects: PARENTED,
      overrides: [
        override({ kind: "entity-transform", entityId: "rig", space: "local", position: [10, 0, 6] }),
      ],
    })
    handle.applyFrame(0)
    // The rig's local POSITION is replaced; its rotation and scale still apply
    // to everything under it, so the prop keeps its -2z offset.
    const world = worldOf(handle, "prop")
    expect(world.x).toBeCloseTo(10, 6)
    expect(world.z).toBeCloseTo(4, 6)
    handle.dispose()
  })

  it("is idempotent across frames — an override is not re-composed each frame", async () => {
    const handle = await build({
      objects: PARENTED,
      overrides: [
        override({ kind: "entity-transform", entityId: "prop", space: "world", position: [3, 4, 5] }),
      ],
    })
    handle.applyFrame(0)
    const first = worldOf(handle, "prop").clone()
    for (const frame of [1, 2, 3, 20, 0]) handle.applyFrame(frame)
    const again = worldOf(handle, "prop")
    expect(again.x).toBeCloseTo(first.x, 9)
    expect(again.y).toBeCloseTo(first.y, 9)
    expect(again.z).toBeCloseTo(first.z, 9)
    handle.dispose()
  })

  it("composes with baked animation instead of replacing it", async () => {
    const glb = makeGlb({
      nodes: [
        {
          name: "car",
          entityRootId: "car",
          animateTranslation: { clip: "drive", times: [0, 2], values: [[0, 0, 0], [4, 0, 0]] },
          children: [{ name: "Body", mesh: true }],
        },
      ],
    })
    const handle = await build({
      glb,
      objects: [
        {
          id: "car",
          name: "CarEntity",
          visual: {
            kind: "asset",
            assetId: "glb",
            rootNodeId: "car",
            animation: { clipName: "drive", startFrame: 0, endFrameExclusive: 48 },
          },
        },
      ],
      overrides: [
        override({ kind: "entity-transform", entityId: "car", space: "local", position: [0, 0, 100] }),
      ],
    })
    handle.applyFrame(24) // t = 1s → baked x = 2
    const node = handle.scene.getObjectByName("car") as THREE.Object3D
    const world = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld)
    expect(world.x).toBeCloseTo(2, 6) // the baked drive still plays …
    expect(world.z).toBeCloseTo(100, 6) // … and the overlay still offsets it
    handle.dispose()
  })

  it("hides an entity without touching its transform", async () => {
    const handle = await build({
      objects: PARENTED,
      overrides: [override({ kind: "entity-visibility", entityId: "prop", visible: false })],
    })
    handle.applyFrame(0)
    const node = handle.entities.get("prop") as THREE.Object3D
    expect(node.visible).toBe(false)
    expect(worldOf(handle, "prop").x).toBeCloseTo(10, 6)
    handle.dispose()
  })
})

describe("camera shot overlays", () => {
  const SHOTS = [
    { id: "a", startFrame: 0, endFrameExclusive: 24 },
    { id: "b", startFrame: 24, endFrameExclusive: 48 },
  ]

  it("offsets only the frames inside the named shot", async () => {
    const handle = await build({
      track: makeCameraTrack({ frameCount: 48, positionAt: () => [0, 0, 10] }),
      shots: SHOTS,
      overrides: [override({ kind: "camera-shot-offset", shotId: "b", positionOffset: [0, 5, 0] })],
    })
    handle.applyFrame(23)
    expect(handle.camera.position.y).toBeCloseTo(0, 6)
    handle.applyFrame(24)
    expect(handle.camera.position.y).toBeCloseTo(5, 6)
    handle.applyFrame(47)
    expect(handle.camera.position.y).toBeCloseTo(5, 6)
    handle.dispose()
  })

  it("does not accumulate when the same frame is drawn repeatedly", async () => {
    const handle = await build({
      track: makeCameraTrack({ frameCount: 48, positionAt: () => [0, 0, 10] }),
      shots: SHOTS,
      overrides: [override({ kind: "camera-shot-offset", shotId: "b", positionOffset: [0, 5, 0] })],
    })
    for (let i = 0; i < 5; i++) handle.applyFrame(30)
    expect(handle.camera.position.y).toBeCloseTo(5, 6)
    handle.dispose()
  })

  it("re-aims by a DELTA rotation, keeping the exported roll and projection", async () => {
    // A `lookAt` would rebuild the orientation from an up-vector and discard the
    // exporter's roll and handheld component. The overlay rotates the baked
    // quaternion instead, by exactly the angle between the two aim directions.
    const roll = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.3, "XYZ"))
    const track = makeCameraTrack({ frameCount: 48, positionAt: () => [0, 0, 10] })
    const rolled = {
      ...track,
      samples: track.samples.map((sample) => ({
        ...sample,
        quaternion: [roll.x, roll.y, roll.z, roll.w] as [number, number, number, number],
        target: [0, 0, 0] as [number, number, number],
      })),
    }
    const handle = await build({
      track: rolled,
      shots: SHOTS,
      overrides: [override({ kind: "camera-shot-offset", shotId: "a", targetOffset: [3, 0, 0] })],
    })

    handle.applyFrame(0)
    const aimed = handle.camera.quaternion.clone()
    expect(handle.camera.projectionMatrix.toArray()).toEqual(rolled.samples[0].projectionMatrix)
    const from = new THREE.Vector3(0, 0, -10).normalize()
    const to = new THREE.Vector3(3, 0, -10).normalize()
    expect(aimed.angleTo(roll)).toBeCloseTo(from.angleTo(to), 6)

    handle.applyFrame(30) // shot b — untouched
    expect(handle.camera.quaternion.angleTo(roll)).toBeCloseTo(0, 6)
    handle.dispose()
  })

  it("fails the load when a re-aiming override has no target to offset", async () => {
    const { plan, resolver } = makeLoadableScene({
      track: makeCameraTrack({ frameCount: 48, targetAt: null }),
      shots: SHOTS,
      overrides: [override({ kind: "camera-shot-offset", shotId: "a", targetOffset: [1, 0, 0] })],
    })
    await expect(loadScene3DV2(plan, { resolver, signal: signal() })).rejects.toMatchObject({
      code: "SCENE_OVERRIDE_INVALID",
    })
  })
})
