import { describe, it, expect } from "vitest"
import { SCENE3D_LIMITS } from "@nodaro/shared"
import { validateScene3DPlan } from "../validate-plan"
import { makePlan } from "./fixture"

/** One object the schema accepts, cloneable into a huge array. */
function obj(id: string, parentId?: string) {
  return {
    id,
    name: id,
    primitive: "box",
    dimensions: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#ffffff",
    ...(parentId ? { parentId } : {}),
  }
}

describe("validateScene3DPlan", () => {
  it("accepts a plan the shared schema accepts, and hands back the PARSED plan", () => {
    const result = validateScene3DPlan(makePlan())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.objects).toHaveLength(2)
    // Parsed, not the raw record: schema defaults are applied.
    expect(result.plan.camera.sensorWidthMm).toBe(36)
  })

  it("rejects a non-plan without throwing", () => {
    for (const value of [undefined, null, "a scene", 42, []]) {
      const result = validateScene3DPlan(value)
      expect(result.ok).toBe(false)
    }
  })

  /**
   * The size checks answer in O(1) instead of letting zod walk every element
   * to report a `.max()` breach — an imported/agent-authored plan is exactly
   * where a 200k-object array comes from, and the GPU allocation the viewport
   * would then do is per object.
   */
  it("rejects an oversized object array immediately, and says the count", () => {
    const objects = Array.from({ length: SCENE3D_LIMITS.maxObjects + 500 }, (_, i) => obj(`o${i}`))
    const started = Date.now()
    const result = validateScene3DPlan(makePlan({ objects }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issue).toContain(String(SCENE3D_LIMITS.maxObjects))
    expect(Date.now() - started).toBeLessThan(500)
  })

  it("rejects an over-long keyframe track (object and camera)", () => {
    const keyframes = Array.from({ length: SCENE3D_LIMITS.maxKeyframes + 2 }, (_, i) => ({ frame: i, position: [0, 0, 0] }))
    expect(validateScene3DPlan(makePlan({ objects: [{ ...obj("a"), keyframes }] })).ok).toBe(false)
    const camera = { position: [0, 2, 6], target: [0, 1, 0], focalLengthMm: 50, sensorWidthMm: 36, keyframes }
    expect(validateScene3DPlan(makePlan({ camera })).ok).toBe(false)
  })

  it("rejects an out-of-range canvas rather than sizing a viewport to it", () => {
    expect(validateScene3DPlan(makePlan({ width: 40000, height: 40000 })).ok).toBe(false)
  })

  /**
   * A parent cycle is what turns the renderer's transform walk into a hang.
   * The shared schema is the guard; this pins that it actually is one, because
   * the frontend deliberately does NOT keep its own cycle walker.
   */
  it("rejects a parent cycle", () => {
    const cyclic = validateScene3DPlan(makePlan({ objects: [obj("a", "b"), obj("b", "a")] }))
    expect(cyclic.ok).toBe(false)
    const selfParent = validateScene3DPlan(makePlan({ objects: [obj("a", "a")] }))
    expect(selfParent.ok).toBe(false)
  })

  it("memoizes per plan object so the viewport and the editors share one parse", () => {
    const plan = makePlan()
    expect(validateScene3DPlan(plan)).toBe(validateScene3DPlan(plan))
  })

  it("leaves an invalid plan's DATA intact — validation never mutates", () => {
    const plan = makePlan({ backgroundColor: "not-a-colour" })
    const before = JSON.stringify(plan)
    expect(validateScene3DPlan(plan).ok).toBe(false)
    expect(JSON.stringify(plan)).toBe(before)
  })
})
