import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import {
  IMAGE_MODEL_ROLE_DEFAULTS,
  IMAGE_MODEL_RATIO_FALLBACKS,
  defaultImageModel,
  imageModelDrawsRatio,
} from "../image-model-roles.js"

describe("image model role defaults (decided 2026-10-08)", () => {
  it("pins the decided models", () => {
    expect(IMAGE_MODEL_ROLE_DEFAULTS).toEqual({
      character: "gpt-image-2",
      general: "gpt-image-2",
      anchor: "gpt-image-2",
      edit: "gpt-image-2-5-flare-i2i",
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
    expect(defaultImageModel("edit", "16:9")).toBe("gpt-image-2-5-flare-i2i")
  })

  it("moves wide and in-between ratios to Sunburst, and 4:5 / 5:4 to Nano Banana Pro", () => {
    for (const r of ["21:9", "3:2", "2:3", "27:16", "9:8"]) {
      expect(defaultImageModel("character", r)).toBe("gpt-image-2-5-sunburst")
      expect(defaultImageModel("anchor", r)).toBe("gpt-image-2-5-sunburst")
    }
    for (const r of ["4:5", "5:4"]) {
      expect(defaultImageModel("general", r)).toBe("nano-banana-pro")
      expect(defaultImageModel("edit", r)).toBe("nano-banana-pro")
    }
  })

  it("falls back to the role model when nothing draws the ratio", () => {
    expect(defaultImageModel("general", "7:1")).toBe("gpt-image-2")
  })

  it("reads ratios from the catalog", () => {
    expect(imageModelDrawsRatio("gpt-image-2", "21:9")).toBe(false)
    expect(imageModelDrawsRatio("gpt-image-2-5-sunburst", "21:9")).toBe(true)
  })
})
