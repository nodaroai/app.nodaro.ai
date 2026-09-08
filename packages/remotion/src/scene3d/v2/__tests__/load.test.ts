import { describe, expect, it, vi } from "vitest"
import { loadScene3DV2, validateScene3DPlanV2Shape } from "../load"
import { SCENE3D_V2_LIMITS } from "../limits"
import type { Scene3DEntityV2, Scene3DPlanV2 } from "../plan-shape"
import { assetRefFor, makeGlb, type MakeGlbOptions } from "./glb-fixtures"
import {
  groupEntity,
  makeCameraTrack,
  makeLoadableScene,
  makeV2Plan,
  memoryResolver,
} from "./v2-fixtures"

const CAR_GLB: MakeGlbOptions = {
  nodes: [
    {
      name: "car",
      entityRootId: "car",
      children: [
        { name: "Body", mesh: true, materialName: "bodyPaint" },
        { name: "Wheel", mesh: true, materialName: "rubber" },
      ],
    },
  ],
}

function carEntity(overrides: Partial<Scene3DEntityV2> = {}): Scene3DEntityV2 {
  return {
    id: "car",
    name: "Car",
    role: "vehicle",
    visual: { kind: "asset", assetId: "glb", rootNodeId: "car" },
    ...overrides,
  }
}

const signal = () => new AbortController().signal

describe("plan-shape validation (no bytes fetched)", () => {
  it("accepts a well-formed v2 plan", () => {
    expect(() => validateScene3DPlanV2Shape(makeV2Plan())).not.toThrow()
  })

  it.each([
    ["odd width", { width: 1921 }],
    ["tiny height", { height: 10 }],
    ["fps below the floor", { fps: 12 }],
    ["fps above the ceiling", { fps: 120 }],
    ["too many frames", { durationInFrames: 4000 }],
  ])("rejects %s", (_label, patch) => {
    expect(() => validateScene3DPlanV2Shape({ ...makeV2Plan(), ...patch } as Scene3DPlanV2)).toThrow()
  })

  it("rejects more than 60 seconds even when the frame count is legal", () => {
    const plan = {
      ...makeV2Plan(),
      fps: 15,
      durationInFrames: 1000,
      shots: [{ id: "only", startFrame: 0, endFrameExclusive: 1000 }],
    } as Scene3DPlanV2
    expect(() => validateScene3DPlanV2Shape(plan)).toThrow(/the limit is 60s/)
  })

  it.each([
    ["units", "feet"],
    ["upAxis", "Z"],
    ["handedness", "left"],
  ])("rejects a plan claiming %s = %s (the renderer never re-converts)", (field, value) => {
    const plan = { ...makeV2Plan(), [field]: value } as unknown as Scene3DPlanV2
    expect(() => validateScene3DPlanV2Shape(plan)).toThrow(new RegExp(field))
  })

  it("rejects an orphaned child rather than reparenting it to the root", () => {
    const plan = makeV2Plan({
      objects: [
        groupEntity({ id: "a", parentId: "ghost" }),
      ],
    })
    expect(() => validateScene3DPlanV2Shape(plan)).toThrow(/references unknown parent "ghost"/)
  })

  it("rejects a cycle in the entity hierarchy", () => {
    const plan = makeV2Plan({
      objects: [
        groupEntity({ id: "a", parentId: "b" }),
        groupEntity({ id: "b", parentId: "a" }),
      ],
    })
    expect(() => validateScene3DPlanV2Shape(plan)).toThrow(/cycle|parent/)
  })

  it("rejects a duplicate entity id", () => {
    const plan = makeV2Plan({
      objects: [
        groupEntity({ id: "a" }),
        groupEntity({ id: "a" }),
      ],
    })
    expect(() => validateScene3DPlanV2Shape(plan)).toThrow(/duplicate|id "a"/)
  })

  it("rejects an entity binding an asset that is not in assets[]", () => {
    const plan = makeV2Plan({ objects: [carEntity()] })
    expect(() => validateScene3DPlanV2Shape(plan)).toThrow(/references unknown asset "glb"/)
  })

  it("rejects a cameraTrackAssetId pointing at the wrong kind", () => {
    const plan = makeV2Plan({
      assets: [
        { assetId: "cam", kind: "glb", role: "entity-geometry", byteLength: 4, sha256: "0".repeat(64) },
      ],
    })
    expect(() => validateScene3DPlanV2Shape(plan)).toThrow(
      /must be camera-track-json/,
    )
  })

  it("rejects an over-budget manifest BEFORE any fetch happens", async () => {
    const resolve = vi.fn()
    const plan = makeV2Plan({
      assets: [
        {
          assetId: "cam",
          kind: "camera-track-json",
          role: "camera-track",
          byteLength: SCENE3D_V2_LIMITS.maxRendererAssetBytes + 1,
          sha256: "0".repeat(64),
        },
      ],
    })
    await expect(loadScene3DV2(plan, { resolver: { resolve }, signal: signal() })).rejects.toThrow(
      /the limit is/,
    )
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe("loading a real scene", () => {
  it("loads a primitives-only plan with just its camera track", async () => {
    const { plan, resolver } = makeLoadableScene({})
    const loaded = await loadScene3DV2(plan, { resolver, signal: signal() })
    expect(loaded.cameraTrack.samples).toHaveLength(48)
    expect(loaded.glbById.size).toBe(0)
    expect(loaded.shots.shots).toHaveLength(1)
    expect(loaded.warnings).toEqual([])
  })

  it("loads, verifies and parses a GLB entity", async () => {
    const { plan, resolver } = makeLoadableScene({
      glb: makeGlb(CAR_GLB),
      objects: [carEntity()],
    })
    const loaded = await loadScene3DV2(plan, { resolver, signal: signal() })
    const asset = loaded.glbById.get("glb")
    expect(asset).toBeDefined()
    expect(asset?.inspection.entityRootsByNodeName.has("car")).toBe(true)
    expect(asset?.scene.children.length).toBeGreaterThan(0)
  })

  it("fails when the declared entity root is not in the file", async () => {
    const { plan, resolver } = makeLoadableScene({
      glb: makeGlb(CAR_GLB),
      objects: [carEntity({ visual: { kind: "asset", assetId: "glb", rootNodeId: "truck" } })],
    })
    await expect(loadScene3DV2(plan, { resolver, signal: signal() })).rejects.toMatchObject({
      code: "SCENE_ASSET_BINDING",
    })
  })

  it("fails when the bound entity root has no mesh (the 'missing mesh' case)", async () => {
    const { plan, resolver } = makeLoadableScene({
      glb: makeGlb({ nodes: [{ name: "car", entityRootId: "car" }] }),
      objects: [carEntity()],
    })
    await expect(loadScene3DV2(plan, { resolver, signal: signal() })).rejects.toThrow(
      /contains no mesh/,
    )
  })

  it("rejects two entities claiming the same exported root", async () => {
    const { plan, resolver } = makeLoadableScene({
      glb: makeGlb(CAR_GLB),
      objects: [carEntity(), carEntity({ id: "car-2" })],
    })
    await expect(loadScene3DV2(plan, { resolver, signal: signal() })).rejects.toThrow(
      /already the root of entity/,
    )
  })

  it("warns when a manifest transform will be ignored in favour of the GLB node", async () => {
    // Per the contract the GLB node transform is authoritative for an asset
    // entity; the manifest values are an informational frame-0 snapshot. The
    // renderer applies exactly one of them — and says so when they disagree,
    // so "the car is not where the manifest says" is not mistaken for a bug.
    const { plan, resolver } = makeLoadableScene({
      glb: makeGlb({ nodes: [{ ...CAR_GLB.nodes[0], translation: [3, 0, 0] }] }),
      objects: [carEntity({ position: [5, 0, 0] })],
    })
    const loaded = await loadScene3DV2(plan, { resolver, signal: signal() })
    expect(loaded.warnings.map((w) => w.code)).toContain("SCENE_ENTITY_TRANSFORM_IGNORED")
  })

  it("stays silent when only the GLB node carries the placement", async () => {
    const { plan, resolver } = makeLoadableScene({
      glb: makeGlb({ nodes: [{ ...CAR_GLB.nodes[0], translation: [3, 0, 0] }] }),
      objects: [carEntity({ position: [0, 0, 0], scale: [1, 1, 1] })],
    })
    const loaded = await loadScene3DV2(plan, { resolver, signal: signal() })
    expect(loaded.warnings).toEqual([])
  })

  it("rejects a material role that cannot be edited because its material is absent", async () => {
    const { plan, resolver } = makeLoadableScene({
      glb: makeGlb(CAR_GLB),
      objects: [
        carEntity({
          materialBindings: [{ role: "identity", materialName: "ghostMaterial", color: "#ff0000" }],
        }),
      ],
    })
    await expect(loadScene3DV2(plan, { resolver, signal: signal() })).rejects.toThrow(
      /ghostMaterial.*not in this entity's asset root/,
    )
  })

  it("fails the load when a GLB's digest does not match the manifest", async () => {
    const good = makeGlb(CAR_GLB)
    const tampered = makeGlb({
      ...CAR_GLB,
      nodes: [{ ...CAR_GLB.nodes[0], name: "CarX" }],
    })
    const track = makeCameraTrack({ frameCount: 48 })
    const trackBytes = new TextEncoder().encode(JSON.stringify(track))
    const trackBuffer = new ArrayBuffer(trackBytes.byteLength)
    new Uint8Array(trackBuffer).set(trackBytes)

    const plan = makeV2Plan({
      objects: [carEntity()],
      assets: [
        assetRefFor("cam", "camera-track-json", "camera-track", trackBuffer),
        assetRefFor("glb", "glb", "entity-geometry", good), // digest of the GOOD file …
      ],
    })
    // … but the resolver hands back the tampered one.
    const resolver = memoryResolver({ cam: trackBuffer, glb: tampered })
    await expect(loadScene3DV2(plan, { resolver, signal: signal() })).rejects.toMatchObject({
      code: "SCENE_ASSET_INVALID",
    })
  })

  it("stops at the first fetch when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const { plan, resolver } = makeLoadableScene({})
    await expect(loadScene3DV2(plan, { resolver, signal: controller.signal })).rejects.toThrow()
  })

  it("does not fetch a second asset after an abort mid-load", async () => {
    const controller = new AbortController()
    const seen: string[] = []
    const { plan, bytes } = makeLoadableScene({
      glb: makeGlb(CAR_GLB),
      objects: [carEntity()],
    })
    const resolver = memoryResolver(bytes, (assetId) => {
      seen.push(assetId)
      if (assetId === "cam") controller.abort()
    })
    await expect(loadScene3DV2(plan, { resolver, signal: controller.signal })).rejects.toThrow()
    expect(seen).toEqual(["cam"])
  })

  it("rejects a camera track whose length disagrees with the plan", async () => {
    const { plan, resolver } = makeLoadableScene({
      durationInFrames: 48,
      track: makeCameraTrack({ frameCount: 24 }),
    })
    await expect(loadScene3DV2(plan, { resolver, signal: signal() })).rejects.toMatchObject({
      code: "SCENE_CAMERA_TRACK_INVALID",
    })
  })

  it("rejects a shot list that does not cover the timeline", async () => {
    const { plan, resolver } = makeLoadableScene({
      durationInFrames: 48,
      shots: [{ id: "a", startFrame: 0, endFrameExclusive: 24 }],
    })
    await expect(loadScene3DV2(plan, { resolver, signal: signal() })).rejects.toThrow(
      /must be covered completely/,
    )
  })
})
