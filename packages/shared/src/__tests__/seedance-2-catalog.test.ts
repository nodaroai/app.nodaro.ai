import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"

describe("seedance-2 catalog", () => {
  it("full seedance-2 exposes 4k", () => {
    expect(MODEL_CATALOG["seedance-2"].resolutions).toContain("4k")
  })
  it("seedance-2 offers the adaptive aspect ratio", () => {
    expect(MODEL_CATALOG["seedance-2"].aspectRatios).toContain("adaptive")
  })
  it("fast and mini do NOT get 4k (separate KIE models, 480p/720p only)", () => {
    expect(MODEL_CATALOG["seedance-2-fast"].resolutions).not.toContain("4k")
    expect(MODEL_CATALOG["seedance-2-mini"].resolutions).not.toContain("4k")
  })
})
