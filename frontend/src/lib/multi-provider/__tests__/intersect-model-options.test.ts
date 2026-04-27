import { describe, it, expect } from "vitest"
import { intersectModelOptions } from "../intersect-model-options"

// nano-banana-pro and flux both support 1:1, 16:9, 9:16, 4:3, 3:4 (per IMAGE_ASPECT_RATIOS).
// nano-banana-pro additionally supports 21:9 (cinematic). Their intersection drops 21:9.
describe("intersectModelOptions", () => {
  it("returns single-provider full set when only one provider", () => {
    const result = intersectModelOptions(["nano-banana-pro"])
    const values = result.aspectRatios.map((o) => o.value)
    expect(values).toContain("1:1")
    expect(values.length).toBeGreaterThan(0)
  })

  it("returns the empty set for unknown providers", () => {
    expect(intersectModelOptions(["__unknown__"]).aspectRatios).toEqual([])
  })

  it("intersects aspect-ratio options across two known providers", () => {
    const result = intersectModelOptions(["nano-banana-pro", "flux"])
    const values = result.aspectRatios.map((o) => o.value)
    // Both share 1:1 / 16:9 / 9:16 — intersection must include them.
    expect(values).toContain("1:1")
    expect(values).toContain("16:9")
    expect(values).toContain("9:16")
  })

  it("returns supportsReferenceImage=false when any provider lacks it", () => {
    // imagen4 has no ref support and no i2i sibling, so it's excluded from
    // MODELS_WITH_REFERENCE_IMAGE_SUPPORT. nano-banana-pro is in the set.
    const result = intersectModelOptions(["nano-banana-pro", "imagen4"])
    expect(result.supportsReferenceImage).toBe(false)
  })

  it("returns empty resolutions when one provider has no resolution config", () => {
    // gpt-image has no IMAGE_RESOLUTION_OPTIONS entry → intersection collapses.
    const result = intersectModelOptions(["nano-banana-pro", "gpt-image"])
    expect(result.resolutions).toEqual([])
  })

  it("handles empty providers array gracefully", () => {
    expect(intersectModelOptions([])).toEqual({
      aspectRatios: [],
      resolutions: [],
      qualities: [],
      supportsReferenceImage: false,
    })
  })
})
