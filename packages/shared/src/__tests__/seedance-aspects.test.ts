import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, validateModelInput } from "../index.js"

/**
 * Seedance 2.x exposes the full KIE-supported fixed-ratio set
 * (https://docs.kie.ai/market/bytedance/seedance-2: 1:1, 4:3, 3:4, 16:9,
 * 9:16, 21:9). Validation is catalog-driven (validateModelInput reads
 * MODEL_CATALOG aspectRatios), so these tests pin both the catalog data
 * AND that the wider set does not leak to other models sharing the old
 * VIDEO_RATIOS_HVS const.
 */
describe("seedance-2 aspect ratios", () => {
  const NEW_RATIOS = ["21:9", "4:3", "3:4"] as const

  it.each(["seedance-2", "seedance-2-fast"])("%s accepts the full six-ratio set", (id) => {
    for (const ar of ["16:9", "9:16", "1:1", ...NEW_RATIOS]) {
      expect(MODEL_CATALOG[id]!.aspectRatios).toContain(ar)
      expect(validateModelInput(id, { aspectRatio: ar })).toBeNull()
    }
  })

  it("the wider set does NOT leak to other HVS models", () => {
    for (const ar of NEW_RATIOS) {
      expect(validateModelInput("kling", { aspectRatio: ar })).not.toBeNull()
      expect(validateModelInput("wan-turbo", { aspectRatio: ar })).not.toBeNull()
    }
  })
})
