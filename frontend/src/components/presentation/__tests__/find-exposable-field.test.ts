import { describe, it, expect } from "vitest"
import type { WorkflowNode } from "@/types/nodes"
import { findExposableField } from "../helpers"

/** Minimal motion-graphics node carrying a lottie-graphic plan with two slots. */
function lottieNode(slots: Record<string, unknown>): WorkflowNode {
  return {
    id: "mg1",
    type: "motion-graphics",
    position: { x: 0, y: 0 },
    data: {
      motionPlan: {
        planType: "lottie-graphic",
        slots,
        slotValues: {},
      },
    },
  } as unknown as WorkflowNode
}

describe("findExposableField", () => {
  it("resolves a static exposable field from NODE_DEFINITIONS (generate-image provider)", () => {
    const node = {
      id: "gi1",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: {},
    } as unknown as WorkflowNode
    const field = findExposableField(node, "provider")
    expect(field?.key).toBe("provider")
    expect(field?.type).toBe("select")
  })

  it("derives a color slot field for a lottie motion-graphics node", () => {
    const node = lottieNode({
      primaryColor: { p: { a: 0, k: [1, 0, 0, 1] } },
    })
    const field = findExposableField(node, "slot:primaryColor")
    expect(field).toBeDefined()
    expect(field?.key).toBe("slot:primaryColor")
    expect(field?.type).toBe("color")
    expect(field?.label).toBe("Primary Color")
    expect(field?.defaultValue).toBe("#ff0000")
  })

  it("derives a text slot field", () => {
    const node = lottieNode({ nameText: { p: "Jane Doe" } })
    const field = findExposableField(node, "slot:nameText")
    expect(field?.type).toBe("text")
    expect(field?.defaultValue).toBe("Jane Doe")
  })

  it("derives a slider slot field for a numeric slot", () => {
    const node = lottieNode({ barSize: { p: { a: 0, k: 40 } } })
    const field = findExposableField(node, "slot:barSize")
    expect(field?.type).toBe("slider")
    expect(field?.min).toBe(0)
    expect(field?.max).toBe(80)
  })

  it("returns undefined for a slot key that is not in the plan", () => {
    const node = lottieNode({ primaryColor: { p: { a: 0, k: [1, 0, 0, 1] } } })
    expect(findExposableField(node, "slot:ghost")).toBeUndefined()
  })

  it("returns undefined for a slot field on an elements-engine motion-graphics node", () => {
    const node = {
      id: "mg2",
      type: "motion-graphics",
      position: { x: 0, y: 0 },
      data: { motionPlan: { planType: "motion-graphics" } },
    } as unknown as WorkflowNode
    expect(findExposableField(node, "slot:primaryColor")).toBeUndefined()
  })

  it("returns undefined for an unknown field on a node without a matching static def", () => {
    const node = lottieNode({ primaryColor: { p: { a: 0, k: [1, 0, 0, 1] } } })
    // Non-slot field that motion-graphics does not statically expose.
    expect(findExposableField(node, "nonexistentField")).toBeUndefined()
  })
})
