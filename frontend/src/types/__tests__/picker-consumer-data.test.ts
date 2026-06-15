import { describe, it, expect } from "vitest"
import { NODE_DEFINITIONS } from "@/types/nodes"

describe("describe-to-picker node definition", () => {
  it("default data no longer carries targetPicker (edge-derived now)", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "describe-to-picker")!
    expect(def.defaultData).not.toHaveProperty("targetPicker")
    expect((def.defaultData as { label: string }).label).toBe("Describe to Picker")
  })
})
