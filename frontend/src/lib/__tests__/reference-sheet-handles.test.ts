import { describe, it, expect } from "vitest"
import { HANDLE_OUTPUT_TYPES } from "../handle-output-types"
import { IMAGE_PRODUCER_TYPES } from "../generate-image-handles"

describe("reference-sheet handles", () => {
  it("declares sheet=image and panels=reference output pips", () => {
    expect(HANDLE_OUTPUT_TYPES["reference-sheet"]).toEqual({ sheet: "image", panels: "reference" })
  })
  it("is an IMAGE_PRODUCER so sheet/panels can wire into image inputs (generate-image / generate-video)", () => {
    expect(IMAGE_PRODUCER_TYPES.has("reference-sheet")).toBe(true)
  })
})
