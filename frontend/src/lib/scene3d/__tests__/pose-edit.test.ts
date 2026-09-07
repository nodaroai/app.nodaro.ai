import { describe, it, expect } from "vitest"
import { SCENE3D_LIMITS } from "@nodaro/shared"
import type { Scene3DCamera, Scene3DObject } from "@nodaro/shared"
import { sampleScene3DObject, sampleScene3DCamera } from "@remotion-pkg/scene3d/sampler"
import { buildObjectPoseEdit, buildCameraPoseEdit, buildCameraFocalPoseEdit, poseEditMode } from "../pose-edit"
import { applyLocalSceneEdits } from "../apply-local-edit"
import { makePlan } from "./fixture"
import { validateScene3DPlan } from "../validate-plan"

/**
 * These run the REAL sampler and the REAL shared applier. The whole point of
 * the module is that what the panel writes changes what the sampler reads at
 * that frame — a stubbed sampler would assert nothing about the bug.
 */
function planWith(objects: unknown[], camera?: unknown): Record<string, unknown> {
  return makePlan({ objects, ...(camera ? { camera } : {}) })
}

/** An object animated with an EXPLICIT frame-0 key — the shape that made a
 *  successful base edit invisible at every frame. */
const ANIMATED: Scene3DObject = {
  id: "hero",
  name: "Hero",
  primitive: "capsule",
  dimensions: [0.5, 1.8, 0.5],
  position: [0, 1, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  color: "#f4a261",
  keyframes: [
    { frame: 0, position: [5, 1, 0] },
    { frame: 48, position: [9, 1, 0], easing: "easeInOut" },
    { frame: 90, rotation: [0, 3, 0] },
  ],
}

const STATIC: Scene3DObject = {
  id: "ground",
  name: "Ground",
  primitive: "plane",
  dimensions: [10, 0.1, 10],
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  color: "#3f3f46",
}

describe("poseEditMode", () => {
  it("updates the explicit key sitting at this frame", () => {
    expect(poseEditMode(ANIMATED.keyframes!, "position", 0, true)).toBe("keyframe-update")
    expect(poseEditMode(ANIMATED.keyframes!, "position", 48, true)).toBe("keyframe-update")
  })

  it("inserts a key on an animated channel past frame 0", () => {
    expect(poseEditMode(ANIMATED.keyframes!, "position", 24, true)).toBe("keyframe-insert")
  })

  it("edits the BASE at frame 0 when the channel has no explicit key there", () => {
    // frame 90 carries only `rotation`, so `position` has no key at 0…
    expect(poseEditMode([{ frame: 90, rotation: [0, 3, 0] }], "position", 0, true)).toBe("base")
  })

  it("edits the BASE for a static channel, even off frame 0", () => {
    expect(poseEditMode([], "position", 30, true)).toBe("base")
    // A channel with no keyframe track at all (dimensions, colour).
    expect(poseEditMode(ANIMATED.keyframes!, "dimensions", 30, false)).toBe("base")
  })
})

describe("buildObjectPoseEdit — the frame-0 override bug", () => {
  it("MOVES THE VISIBLE POSE when an explicit frame-0 key overrides the base", () => {
    // Before the fix this wrote `changes.position` (the base), which the
    // explicit frame-0 key shadows: a successful, history-making, no-op edit.
    const plan = planWith([STATIC, ANIMATED])
    const sampledAt0 = sampleScene3DObject(ANIMATED, 0).position
    expect(sampledAt0).toEqual([5, 1, 0]) // the KEY, not the base [0,1,0]

    const edit = buildObjectPoseEdit({
      object: ANIMATED,
      channel: "position",
      sampled: sampledAt0,
      axis: "x",
      value: 7,
      clampedValue: 7,
      frame: 0,
    })
    expect(edit && edit.ok).toBe(true)
    if (!edit || !edit.ok) return
    expect(edit.mode).toBe("keyframe-update")

    const result = applyLocalSceneEdits(plan, [edit.operation])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const validated = validateScene3DPlan(result.plan)
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const hero = validated.plan.objects.find((o) => o.id === "hero")!
    // The pose the user is looking at actually changed.
    expect(sampleScene3DObject(hero, 0).position).toEqual([7, 1, 0])
    // The base is untouched, and so is every other key and channel.
    expect(hero.position).toEqual([0, 1, 0])
    expect(hero.keyframes).toEqual([
      { frame: 0, position: [7, 1, 0] },
      { frame: 48, position: [9, 1, 0], easing: "easeInOut" },
      { frame: 90, rotation: [0, 3, 0] },
    ])
  })

  it("inserts a SORTED key for a mid-shot edit and leaves the timing alone", () => {
    const plan = planWith([STATIC, ANIMATED])
    const sampledAt24 = sampleScene3DObject(ANIMATED, 24).position
    const edit = buildObjectPoseEdit({
      object: ANIMATED,
      channel: "position",
      sampled: sampledAt24,
      axis: "y",
      value: 3,
      clampedValue: 3,
      frame: 24,
    })
    expect(edit && edit.ok && edit.mode).toBe("keyframe-insert")
    if (!edit || !edit.ok) return

    const result = applyLocalSceneEdits(plan, [edit.operation])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const validated = validateScene3DPlan(result.plan)
    if (!validated.ok) throw new Error(validated.issue)
    const hero = validated.plan.objects.find((o) => o.id === "hero")!

    expect(hero.keyframes!.map((k) => k.frame)).toEqual([0, 24, 48, 90])
    // The edited frame shows the new pose…
    expect(sampleScene3DObject(hero, 24).position[1]).toBe(3)
    // …and the surrounding keys are byte-identical, so timing is unchanged.
    expect(hero.keyframes![0]).toEqual({ frame: 0, position: [5, 1, 0] })
    expect(hero.keyframes![2]).toEqual({ frame: 48, position: [9, 1, 0], easing: "easeInOut" })
    expect(hero.keyframes![3]).toEqual({ frame: 90, rotation: [0, 3, 0] })
    // The untouched ROTATION channel still samples exactly as before.
    expect(sampleScene3DObject(hero, 90).rotation).toEqual(sampleScene3DObject(ANIMATED, 90).rotation)
  })

  it("edits the base for a STATIC object, at any frame — and it is visible there", () => {
    const edit = buildObjectPoseEdit({
      object: STATIC,
      channel: "position",
      sampled: [0, 0, 0],
      axis: "x",
      value: 2,
      clampedValue: 2,
      frame: 30,
    })
    expect(edit && edit.ok && edit.mode).toBe("base")
    if (!edit || !edit.ok) return
    expect(edit.operation).toEqual({ op: "set-object", objectId: "ground", changes: { position: [2, 0, 0] } })
    const moved = { ...STATIC, position: [2, 0, 0] as [number, number, number] }
    expect(sampleScene3DObject(moved, 30).position).toEqual([2, 0, 0])
  })

  it("keeps DIMENSIONS an ordinary plan edit — it has no keyframe channel", () => {
    const edit = buildObjectPoseEdit({
      object: ANIMATED,
      channel: "dimensions",
      sampled: ANIMATED.dimensions,
      axis: "y",
      value: 2,
      clampedValue: 2,
      frame: 48,
    })
    expect(edit && edit.ok && edit.mode).toBe("base")
    if (!edit || !edit.ok) return
    expect(edit.operation).toEqual({ op: "set-object", objectId: "hero", changes: { dimensions: [0.5, 2, 0.5] } })
  })

  it("returns null when the SAMPLED value is already the typed value", () => {
    expect(
      buildObjectPoseEdit({
        object: ANIMATED,
        channel: "position",
        sampled: [5, 1, 0],
        axis: "x",
        value: 5,
        clampedValue: 5,
        frame: 0,
      }),
    ).toBeNull()
  })

  it("REFUSES rather than silently dropping a key when the track is full", () => {
    const full: Scene3DObject = {
      ...ANIMATED,
      keyframes: Array.from({ length: SCENE3D_LIMITS.maxKeyframes }, (_, i) => ({
        frame: i,
        position: [i, 1, 0] as [number, number, number],
      })),
    }
    const edit = buildObjectPoseEdit({
      object: full,
      channel: "position",
      sampled: [0, 1, 0],
      axis: "x",
      value: 4,
      clampedValue: 4,
      frame: SCENE3D_LIMITS.maxKeyframes + 1,
    })
    expect(edit).toEqual({ ok: false, code: "keyframe_limit" })
  })
})

describe("camera pose edits follow the same rule", () => {
  const ANIMATED_CAMERA: Scene3DCamera = {
    position: [0, 2, 6],
    target: [0, 1, 0],
    focalLengthMm: 50,
    sensorWidthMm: 36,
    keyframes: [
      { frame: 0, position: [3, 2, 6], focalLengthMm: 35 },
      { frame: 60, position: [3, 2, 2] },
    ],
  }

  it("updates the explicit frame-0 camera key instead of the shadowed base", () => {
    const plan = planWith([STATIC], ANIMATED_CAMERA)
    const sampled = sampleScene3DCamera(plan as never, 0)
    expect(sampled.position).toEqual([3, 2, 6])

    const edit = buildCameraPoseEdit({
      camera: ANIMATED_CAMERA,
      channel: "position",
      sampled: sampled.position,
      axis: "z",
      clampedValue: 9,
      frame: 0,
    })
    expect(edit && edit.ok && edit.mode).toBe("keyframe-update")
    if (!edit || !edit.ok) return

    const result = applyLocalSceneEdits(plan, [edit.operation])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const validated = validateScene3DPlan(result.plan)
    if (!validated.ok) throw new Error(validated.issue)
    expect(sampleScene3DCamera(validated.plan, 0).position).toEqual([3, 2, 9])
    // The frame-0 key's OTHER channel survives.
    expect(validated.plan.camera.keyframes![0].focalLengthMm).toBe(35)
    expect(validated.plan.camera.position).toEqual([0, 2, 6])
  })

  it("edits the BASE target — that channel has no key, so it is static", () => {
    // Channels are independent: the camera is animated on POSITION, so its
    // TARGET still reads the base at every frame and moving the base is what
    // the user sees change.
    const edit = buildCameraPoseEdit({
      camera: ANIMATED_CAMERA,
      channel: "target",
      sampled: [0, 1, 0],
      axis: "x",
      clampedValue: 2,
      frame: 30,
    })
    expect(edit && edit.ok && edit.mode).toBe("base")
    if (!edit || !edit.ok || edit.operation.op !== "set-camera") return
    expect(edit.operation.changes).toEqual({ target: [2, 1, 0] })
  })

  it("inserts a mid-shot key on an ANIMATED target track, sorted, siblings intact", () => {
    const panning: Scene3DCamera = {
      ...ANIMATED_CAMERA,
      keyframes: [
        { frame: 0, position: [3, 2, 6], focalLengthMm: 35, target: [0, 1, 0] },
        { frame: 60, position: [3, 2, 2], target: [4, 1, 0] },
      ],
    }
    const edit = buildCameraPoseEdit({
      camera: panning,
      channel: "target",
      sampled: [2, 1, 0],
      axis: "x",
      clampedValue: 3,
      frame: 30,
    })
    expect(edit && edit.ok && edit.mode).toBe("keyframe-insert")
    if (!edit || !edit.ok || edit.operation.op !== "set-camera") return
    expect(edit.operation.changes.keyframes!.map((k) => k.frame)).toEqual([0, 30, 60])
    expect(edit.operation.changes.keyframes![1]).toEqual({ frame: 30, target: [3, 1, 0] })
    // Untouched keys, including the position track riding along with them.
    expect(edit.operation.changes.keyframes![0]).toEqual({ frame: 0, position: [3, 2, 6], focalLengthMm: 35, target: [0, 1, 0] })
    expect(edit.operation.changes.keyframes![2]).toEqual({ frame: 60, position: [3, 2, 2], target: [4, 1, 0] })
  })

  it("routes the LENS through the same rule", () => {
    const atKey = buildCameraFocalPoseEdit({ camera: ANIMATED_CAMERA, sampled: 35, clampedValue: 24, frame: 0 })
    expect(atKey && atKey.ok && atKey.mode).toBe("keyframe-update")
    const midShot = buildCameraFocalPoseEdit({ camera: ANIMATED_CAMERA, sampled: 35, clampedValue: 24, frame: 30 })
    expect(midShot && midShot.ok && midShot.mode).toBe("keyframe-insert")
    // A camera whose lens is NOT animated edits the base.
    const staticLens: Scene3DCamera = { ...ANIMATED_CAMERA, keyframes: [{ frame: 60, position: [3, 2, 2] }] }
    const base = buildCameraFocalPoseEdit({ camera: staticLens, sampled: 50, clampedValue: 24, frame: 30 })
    expect(base && base.ok && base.mode).toBe("base")
    if (!base || !base.ok || base.operation.op !== "set-camera") return
    expect(base.operation.changes).toEqual({ focalLengthMm: 24 })
  })
})
