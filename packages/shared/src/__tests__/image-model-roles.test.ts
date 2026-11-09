import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import {
  IMAGE_MODEL_ROLE_DEFAULTS,
  IMAGE_MODEL_RATIO_FALLBACKS,
  defaultImageModel,
  defaultImageModelForNode,
  imageModelDrawsRatio,
} from "../image-model-roles.js"

describe("image model role defaults (decided 2026-10-08)", () => {
  it("pins the decided models", () => {
    expect(IMAGE_MODEL_ROLE_DEFAULTS).toEqual({
      character: "gpt-image-2",
      general: "gpt-image-2",
      anchor: "gpt-image-2",
      edit: "gpt-image-2-6-flare-i2i",
    })
  })

  it("names only catalog models", () => {
    for (const id of [...Object.values(IMAGE_MODEL_ROLE_DEFAULTS), ...Object.values(IMAGE_MODEL_RATIO_FALLBACKS).flat()]) {
      expect(MODEL_CATALOG[id], id).toBeDefined()
    }
  })

  it("never defaults to Nano Banana Pro except as the last ratio fallback", () => {
    expect(Object.values(IMAGE_MODEL_ROLE_DEFAULTS)).not.toContain("nano-banana-pro")
    for (const chain of Object.values(IMAGE_MODEL_RATIO_FALLBACKS)) expect(chain.at(-1)).toBe("nano-banana-pro")
  })

  it("keeps the role model for ratios it draws, and for no ratio", () => {
    for (const r of [undefined, null, "", "auto", "1:1", "16:9", "9:16", "4:3", "3:4"]) {
      expect(defaultImageModel("general", r)).toBe("gpt-image-2")
    }
    expect(defaultImageModel("edit", "16:9")).toBe("gpt-image-2-6-flare-i2i")
  })

  it("moves wide and in-between ratios to 2.6 Sunburst", () => {
    for (const r of ["21:9", "3:2", "2:3", "4:5", "5:4"]) {
      expect(defaultImageModel("character", r)).toBe("gpt-image-2-6-sunburst")
      expect(defaultImageModel("anchor", r)).toBe("gpt-image-2-6-sunburst")
    }
    expect(defaultImageModel("general", "4:5")).toBe("gpt-image-2-6-sunburst")
    expect(defaultImageModel("edit", "4:5")).toBe("gpt-image-2-6-flare-i2i")
  })

  it("keeps 2.5 Sunburst behind 2.6 for a ratio only 2.5 draws, and Nano Banana Pro last", () => {
    for (const role of ["character", "general", "anchor"] as const) {
      expect(IMAGE_MODEL_RATIO_FALLBACKS[role]).toEqual(["gpt-image-2-6-sunburst", "gpt-image-2-5-sunburst", "nano-banana-pro"])
    }
    expect(IMAGE_MODEL_RATIO_FALLBACKS.edit).toEqual(["gpt-image-2-6-sunburst-i2i", "gpt-image-2-5-sunburst-i2i", "nano-banana-pro"])
    const only25 = (MODEL_CATALOG["gpt-image-2-5-sunburst"]!.aspectRatios ?? []).filter(
      (r) => !imageModelDrawsRatio("gpt-image-2-6-sunburst", r) && !imageModelDrawsRatio("gpt-image-2", r),
    )
    for (const r of only25) expect(defaultImageModel("general", r)).toBe("gpt-image-2-5-sunburst")
  })

  it("falls back to the role model when nothing draws the ratio", () => {
    expect(defaultImageModel("general", "7:1")).toBe("gpt-image-2")
  })

  it("names each image node's default the way its route does", () => {
    expect(defaultImageModelForNode("generate-image", "1:1")).toBe("gpt-image-2")
    expect(defaultImageModelForNode("generate-image", "21:9")).toBe("gpt-image-2-6-sunburst")
    expect(defaultImageModelForNode("image-to-image")).toBe("gpt-image-2-6-flare-i2i")
    expect(defaultImageModelForNode("modify-image")).toBe("gpt-image-2-6-flare-i2i")
    expect(defaultImageModelForNode("reference-board", "2:3")).toBe("gpt-image-2-6-sunburst")
    expect(defaultImageModelForNode("text-to-speech")).toBeUndefined()
  })

  it("reads ratios from the catalog", () => {
    expect(imageModelDrawsRatio("gpt-image-2", "21:9")).toBe(false)
    expect(imageModelDrawsRatio("gpt-image-2-5-sunburst", "21:9")).toBe(true)
  })
})
