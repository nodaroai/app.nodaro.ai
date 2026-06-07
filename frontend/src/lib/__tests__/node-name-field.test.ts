import { describe, it, expect } from "vitest"
import { getNodeNameField, buildPrefillInitialData } from "../node-name-field"

describe("node-name-field", () => {
  it("defaults to 'label' for prompt producers", () => {
    expect(getNodeNameField("text-prompt")).toBe("label")
    expect(getNodeNameField("generate-image")).toBe("label")
  })

  it("builds { label } initialData for a prefilled name", () => {
    expect(buildPrefillInitialData("text-prompt", "Hero")).toEqual({ label: "Hero" })
  })

  it("returns undefined when there is no prefill name", () => {
    expect(buildPrefillInitialData("text-prompt", undefined)).toBeUndefined()
  })
})
