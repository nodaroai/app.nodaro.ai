import { describe, it, expect } from "vitest"
import { HANDLE_OUTPUT_TYPES } from "../handle-output-types"

describe("reference-sheet handles", () => {
  it("declares sheet=image and panels=reference output pips", () => {
    expect(HANDLE_OUTPUT_TYPES["reference-sheet"]).toEqual({ sheet: "image", panels: "reference" })
  })
})
