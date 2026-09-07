import { describe, it, expect } from "vitest"
import {
  focalLengthToVerticalFovDeg,
  sampleScene3DCamera,
  sampleScene3DFrame,
  sampleScene3DObject,
  scene3DFrameCount,
} from "../sampler"
import { makeObject, makePlan } from "./fixtures"

const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe("sampleScene3DObject — track semantics", () => {
  it("holds the base transform when the object has no keyframes", () => {
    const obj = makeObject({ id: "a", position: [1, 2, 3], rotation: [0, 0.5, 0], scale: [2, 2, 2] })
    for (const frame of [0, 12, 47, 9999]) {
      const s = sampleScene3DObject(obj, frame)
      expect(s.position).toEqual([1, 2, 3])
      expect(s.rotation).toEqual([0, 0.5, 0])
      expect(s.scale).toEqual([2, 2, 2])
    }
  })

  it("treats the base transform as an implicit frame-0 key and interpolates to the first key", () => {
    const obj = makeObject({
      id: "a",
      position: [0, 0, 0],
      keyframes: [{ frame: 20, position: [10, 0, 0] }],
    })
    expect(sampleScene3DObject(obj, 0).position).toEqual([0, 0, 0])
    expect(sampleScene3DObject(obj, 10).position).toEqual([5, 0, 0])
    expect(sampleScene3DObject(obj, 20).position).toEqual([10, 0, 0])
  })

  it("holds the last key past the end of the track", () => {
    const obj = makeObject({ id: "a", keyframes: [{ frame: 10, position: [4, 0, 0] }] })
    expect(sampleScene3DObject(obj, 11).position).toEqual([4, 0, 0])
    expect(sampleScene3DObject(obj, 5000).position).toEqual([4, 0, 0])
  })

  it("lets an explicit frame-0 key override the base transform", () => {
    const obj = makeObject({
      id: "a",
      position: [9, 9, 9],
      keyframes: [
        { frame: 0, position: [0, 0, 0] },
        { frame: 10, position: [10, 0, 0] },
      ],
    })
    expect(sampleScene3DObject(obj, 0).position).toEqual([0, 0, 0])
    expect(sampleScene3DObject(obj, 5).position).toEqual([5, 0, 0])
  })

  it("samples channels independently — a position-only key leaves rotation and scale alone", () => {
    const obj = makeObject({
      id: "a",
      rotation: [0, 1, 0],
      scale: [3, 3, 3],
      keyframes: [
        { frame: 24, position: [0, 6, 0] },
        { frame: 48, rotation: [0, 2, 0] },
      ],
    })
    const mid = sampleScene3DObject(obj, 24)
    expect(mid.position).toEqual([0, 6, 0])
    // rotation's own track starts at the base and ends at frame 48
    expect(mid.rotation[1]).toBeCloseTo(1.5, 10)
    expect(mid.scale).toEqual([3, 3, 3])
    // position holds after its last key even though rotation keeps moving
    const end = sampleScene3DObject(obj, 48)
    expect(end.position).toEqual([0, 6, 0])
    expect(end.rotation).toEqual([0, 2, 0])
  })

  it("sorts unsorted keyframes instead of trusting input order", () => {
    const obj = makeObject({
      id: "a",
      keyframes: [
        { frame: 20, position: [10, 0, 0] },
        { frame: 10, position: [0, 0, 0] },
      ],
    })
    expect(sampleScene3DObject(obj, 15).position).toEqual([5, 0, 0])
  })

  it("applies easeInOut from the DESTINATION key (ease into the pose)", () => {
    const eased = makeObject({
      id: "a",
      keyframes: [{ frame: 10, position: [10, 0, 0], easing: "easeInOut" }],
    })
    const linear = makeObject({
      id: "b",
      keyframes: [{ frame: 10, position: [10, 0, 0], easing: "linear" }],
    })
    // smoothstep is symmetric: midpoint identical, quarter point slower
    expect(sampleScene3DObject(eased, 5).position[0]).toBeCloseTo(5, 10)
    expect(sampleScene3DObject(eased, 2.5).position[0]).toBeLessThan(
      sampleScene3DObject(linear, 2.5).position[0],
    )
    // smoothstep(0.25) = 0.15625 → 1.5625
    expect(sampleScene3DObject(eased, 2.5).position[0]).toBeCloseTo(1.5625, 10)
    expect(sampleScene3DObject(eased, 0).position[0]).toBe(0)
    expect(sampleScene3DObject(eased, 10).position[0]).toBe(10)
  })
})

describe("sampleScene3DCamera", () => {
  it("returns the static camera when no keyframes exist", () => {
    const plan = makePlan()
    const cam = sampleScene3DCamera(plan, 24)
    expect(cam.position).toEqual([0, 2, 8])
    expect(cam.target).toEqual([0, 0, 0])
    expect(cam.focalLengthMm).toBe(35)
  })

  it("interpolates position, target and focal length across keys", () => {
    const plan = makePlan({
      camera: {
        position: [0, 0, 10],
        target: [0, 0, 0],
        focalLengthMm: 20,
        sensorWidthMm: 36,
        keyframes: [{ frame: 40, position: [0, 0, 0], target: [4, 0, 0], focalLengthMm: 60 }],
      },
    } as never)
    const start = sampleScene3DCamera(plan, 0)
    const mid = sampleScene3DCamera(plan, 20)
    const end = sampleScene3DCamera(plan, 40)
    expect(start.position).toEqual([0, 0, 10])
    expect(mid.position).toEqual([0, 0, 5])
    expect(mid.target).toEqual([2, 0, 0])
    expect(mid.focalLengthMm).toBe(40)
    expect(end.position).toEqual([0, 0, 0])
    // longer lens ⇒ narrower FOV
    expect(end.fovDeg).toBeLessThan(start.fovDeg)
  })

  it("derives vertical FOV from the sensor width and the frame aspect", () => {
    // 36mm gauge on 16:9 ⇒ 20.25mm vertical sensor; 2·atan(20.25/(2·35))
    const expected = (2 * Math.atan(20.25 / 70) * 180) / Math.PI
    near(focalLengthToVerticalFovDeg(35, 36, 1920, 1080), expected, 1e-9)
    // portrait is TALLER, so the same lens sees a wider vertical angle
    expect(focalLengthToVerticalFovDeg(35, 36, 1080, 1920)).toBeGreaterThan(
      focalLengthToVerticalFovDeg(35, 36, 1920, 1080),
    )
  })

  it("falls back to a 36mm sensor when the plan omits it", () => {
    const plan = makePlan({
      camera: { position: [0, 0, 5], target: [0, 0, 0], focalLengthMm: 50 },
    } as never)
    expect(sampleScene3DCamera(plan, 0).sensorWidthMm).toBe(36)
  })
})

describe("sampleScene3DFrame — hierarchy", () => {
  it("composes a child's world position through a moving, rotating parent", () => {
    const plan = makePlan({
      durationInFrames: 40,
      objects: [
        // child listed BEFORE its parent on purpose
        makeObject({ id: "child", parentId: "parent", position: [2, 0, 0] }),
        makeObject({
          id: "parent",
          position: [0, 0, 0],
          keyframes: [{ frame: 40, position: [10, 0, 0], rotation: [0, Math.PI / 2, 0] }],
        }),
      ],
    })

    const start = sampleScene3DFrame(plan, 0)
    expect(start.byId.child.position).toEqual([2, 0, 0])
    expect(start.byId.child.worldPosition[0]).toBeCloseTo(2, 10)

    const mid = sampleScene3DFrame(plan, 20)
    // parent at x=5, yawed 45° ⇒ child offset rotates to (√2, 0, -√2)
    expect(mid.byId.parent.worldPosition[0]).toBeCloseTo(5, 10)
    expect(mid.byId.child.worldPosition[0]).toBeCloseTo(5 + Math.SQRT2, 10)
    expect(mid.byId.child.worldPosition[2]).toBeCloseTo(-Math.SQRT2, 10)

    const end = sampleScene3DFrame(plan, 40)
    expect(end.byId.child.worldPosition[0]).toBeCloseTo(10, 10)
    expect(end.byId.child.worldPosition[2]).toBeCloseTo(-2, 10)
  })

  it("propagates parent scale to child world offsets", () => {
    const plan = makePlan({
      objects: [
        makeObject({ id: "root", scale: [3, 3, 3] }),
        makeObject({ id: "kid", parentId: "root", position: [1, 0, 0] }),
      ],
    })
    expect(sampleScene3DFrame(plan, 0).byId.kid.worldPosition).toEqual([3, 0, 0])
  })

  it("orders parents before children regardless of plan order", () => {
    const plan = makePlan({
      objects: [
        makeObject({ id: "c", parentId: "b" }),
        makeObject({ id: "b", parentId: "a" }),
        makeObject({ id: "a" }),
      ],
    })
    expect(sampleScene3DFrame(plan, 0).objects.map((o) => o.id)).toEqual(["a", "b", "c"])
  })

  it("degrades to root-parenting instead of hanging on an unknown parent", () => {
    const plan = makePlan({
      objects: [makeObject({ id: "orphan", parentId: "missing", position: [1, 2, 3] })],
    })
    expect(sampleScene3DFrame(plan, 0).byId.orphan.worldPosition).toEqual([1, 2, 3])
  })

  it("terminates on a parent cycle (contract rejects them; renderer must not hang)", () => {
    const plan = makePlan({
      objects: [
        makeObject({ id: "a", parentId: "b", position: [1, 0, 0] }),
        makeObject({ id: "b", parentId: "a", position: [0, 1, 0] }),
      ],
    })
    const sample = sampleScene3DFrame(plan, 0)
    expect(sample.objects).toHaveLength(2)
    expect(Number.isFinite(sample.byId.a.worldPosition[0])).toBe(true)
  })

  it("is deterministic — the same plan and frame produce identical numbers", () => {
    const plan = makePlan({
      objects: [makeObject({ id: "a", keyframes: [{ frame: 30, position: [3, 4, 5], easing: "easeInOut" }] })],
    })
    const a = sampleScene3DFrame(plan, 17)
    const b = sampleScene3DFrame(plan, 17)
    expect(a.byId.a.worldMatrix).toEqual(b.byId.a.worldMatrix)
    expect(a.camera).toEqual(b.camera)
  })
})

describe("scene3DFrameCount", () => {
  it("mirrors durationInFrames with a one-frame floor", () => {
    expect(scene3DFrameCount(makePlan({ durationInFrames: 96 }))).toBe(96)
    expect(scene3DFrameCount(makePlan({ durationInFrames: 0 }))).toBe(1)
  })
})
