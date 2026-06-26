import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, validateModelInput, defaultVideoAspectRatio } from "../index.js"

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

/**
 * `defaultVideoAspectRatio` is the single source of truth for the no-explicit-
 * aspectRatio run/display default. Seedance 2.x → "adaptive" (output matches
 * the wired input); every other provider keeps the historical "16:9". Pinning
 * this here keeps the run-defaults (execute-node, payload-builder) and the
 * config-panel display fallbacks in lock-step (preview = run).
 */
describe("defaultVideoAspectRatio", () => {
  it.each(["seedance-2", "seedance-2-fast", "seedance-2-mini"])(
    "%s defaults to adaptive",
    (id) => {
      expect(defaultVideoAspectRatio(id)).toBe("adaptive")
      // adaptive must be a value the model actually validates against.
      expect(validateModelInput(id, { aspectRatio: "adaptive" })).toBeNull()
    },
  )

  it("non-Seedance providers default to 16:9", () => {
    expect(defaultVideoAspectRatio("minimax")).toBe("16:9")
    expect(defaultVideoAspectRatio("kling")).toBe("16:9")
    expect(defaultVideoAspectRatio(undefined)).toBe("16:9")
  })
})
