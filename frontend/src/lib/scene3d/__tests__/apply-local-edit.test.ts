import { describe, it, expect } from "vitest"
import { applyLocalSceneEdits } from "../apply-local-edit"
import { buildRemoveObjectOperation, buildBackgroundOperation } from "../edit-operations"
import { buildObjectPoseEdit } from "../pose-edit"
import type { Scene3DObject } from "@nodaro/shared"

/** The fixture's `ground` object: no keyframes, so an edit lands on the base. */
const GROUND = {
  id: "ground",
  name: "Ground",
  primitive: "plane",
  dimensions: [10, 0.1, 10],
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  color: "#3f3f46",
} as unknown as Scene3DObject

function groundMove(value: number) {
  const plan = buildObjectPoseEdit({
    object: GROUND,
    channel: "position",
    sampled: [0, 0, 0],
    axis: "x",
    value,
    clampedValue: value,
    frame: 0,
  })
  return plan && plan.ok ? plan.operation : null
}
import { planObjects, planRevisionId, planBackgroundColor } from "../plan-view"
import { makePlan, REV_A } from "./fixture"

/**
 * These run the REAL shared applier — the point of the module under test is
 * that the canvas and the API route mint identical revisions, so a stubbed
 * applier would test nothing.
 */
describe("applyLocalSceneEdits", () => {
  it("mints a NEW revision and leaves the input plan untouched", () => {
    const plan = makePlan()
    const before = JSON.stringify(plan)
    const op = groundMove(2)
    const result = applyLocalSceneEdits(plan, [op!])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(planRevisionId(result.plan)).not.toBe(REV_A)
    expect(result.plan.parentRevisionId).toBe(REV_A)
    expect(planObjects(result.plan).find((o) => o.id === "ground")?.position).toEqual([2, 0, 0])
    expect(JSON.stringify(plan)).toBe(before)
    expect(result.changeSummary.length).toBeGreaterThan(0)
  })

  it("is a no-op for an empty operation list (no revision churn)", () => {
    const plan = makePlan()
    const result = applyLocalSceneEdits(plan, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan).toBe(plan)
  })

  it("reports a rejection instead of throwing — removing a parent is refused", () => {
    const result = applyLocalSceneEdits(makePlan(), [buildRemoveObjectOperation("ground")])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBeTruthy()
  })

  it("refuses to edit a LOCKED object, the same rule the model is held to", () => {
    const op = groundMove(2)
    const result = applyLocalSceneEdits(makePlan(), [op!], { lockedObjectIds: ["ground"] })
    expect(result.ok).toBe(false)
  })

  it("rejects an edit whose expected revision has moved on", () => {
    const op = buildBackgroundOperation("#ff0073", "#101014")
    const result = applyLocalSceneEdits(makePlan(), [op!], {
      expectedRevisionId: "99999999-9999-4999-8999-999999999999",
    })
    expect(result.ok).toBe(false)
  })

  it("applies a background change", () => {
    const result = applyLocalSceneEdits(makePlan(), [buildBackgroundOperation("#ff0073", "#101014")!])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(planBackgroundColor(result.plan)).toBe("#ff0073")
  })
})
