import { describe, expect, it } from "vitest"
import { MODEL_CATALOG, defaultResolutionFor, normalizeModelInput } from "../model-catalog.js"
import { resolveNormalizedImageGen } from "../credit-identifiers.js"
import {
  IMAGE_RESOLUTION_VALUES,
  getMinImagePromptChars,
  imageReferenceLimit,
  requestImageLimit,
  T2I_TO_I2I_VARIANT,
} from "../model-constants.js"
import { isPricedPerInputImage, isPricedPerInputImageEdit, pricedEstimatedImages, pricedSentImages } from "../input-image-pricing.js"
import { gptImage26EstimatedImages, gptImage26SentImages } from "../gpt-image-2-6.js"
import { SEEDREAM_5_5_DEFAULT_RESOLUTION, seedream55Resolution } from "../seedream-5-5.js"

describe("Seedream 5.5 in the catalog", () => {
  it("takes 1K, 1.5K and 2K, 2K when none is named", () => {
    for (const id of ["seedream-5-5", "seedream-5-5-i2i"]) {
      expect(MODEL_CATALOG[id]!.resolutions).toEqual(["1K", "1.5K", "2K"])
      expect(defaultResolutionFor(id)).toBe("2K")
    }
    expect(SEEDREAM_5_5_DEFAULT_RESOLUTION).toBe("2K")
    expect(seedream55Resolution(undefined)).toBe("2K")
    expect(seedream55Resolution("1.5k")).toBe("1.5K")
  })

  it("text to image never lists auto (its schema requires a real ratio); the edit lists it first", () => {
    expect(MODEL_CATALOG["seedream-5-5"]!.aspectRatios).not.toContain("auto")
    expect(MODEL_CATALOG["seedream-5-5"]!.aspectRatios).toHaveLength(8)
    expect(MODEL_CATALOG["seedream-5-5-i2i"]!.aspectRatios![0]).toBe("auto")
    expect(MODEL_CATALOG["seedream-5-5-i2i"]!.aspectRatios).toHaveLength(9)
  })

  it("auto on text to image becomes a real ratio: the one nearest a photo, else the first listed", () => {
    const none = normalizeModelInput("seedream-5-5", { aspectRatio: "auto" })
    expect(none.aspectRatio).toBe("1:1")
    const portrait = normalizeModelInput("seedream-5-5", { aspectRatio: "auto" }, { sourceImage: { width: 768, height: 1024 } })
    expect(portrait.aspectRatio).toBe("3:4")
    expect(normalizeModelInput("seedream-5-5-i2i", { aspectRatio: "auto" }).aspectRatio).toBe("auto")
  })

  it("a stale size snaps to its default, 2K, and 1.5K is kept", () => {
    expect(normalizeModelInput("seedream-5-5", { resolution: "4K" }).resolution).toBe("2K")
    expect(normalizeModelInput("seedream-5-5", { resolution: "1.5K" }).resolution).toBe("1.5K")
    expect(normalizeModelInput("seedream-5-5-i2i", { resolution: "1.5k" }).resolution).toBe("1.5K")
  })

  it("1.5K is in the route vocabulary, and moves to a size the model lists on every other model", () => {
    expect(IMAGE_RESOLUTION_VALUES).toContain("1.5K")
    for (const [id, m] of Object.entries(MODEL_CATALOG)) {
      if (m.kind !== "image" || id.startsWith("seedream-5-5")) continue
      expect(m.resolutions ?? [], id).not.toContain("1.5K")
      const n = normalizeModelInput(id, { resolution: "1.5K" })
      expect(n.resolution === undefined || (m.resolutions ?? []).includes(n.resolution), id).toBe(true)
    }
  })

  it("a transparent background is kept in PNG and moved to auto in JPEG, before anything is priced", () => {
    expect(normalizeModelInput("seedream-5-5", { background: "transparent" }).background).toBe("transparent")
    expect(normalizeModelInput("seedream-5-5", { background: "transparent", outputFormat: "png" }).background).toBe("transparent")
    const jpeg = normalizeModelInput("seedream-5-5-i2i", { background: "transparent", outputFormat: "jpeg" })
    expect(jpeg.background).toBe("auto")
    expect(jpeg.outputFormat).toBe("jpeg")
    expect(jpeg.adjustments.map((a) => a.field)).toContain("background")
    // A transparent background renders at every size here: nothing moves the size.
    expect(normalizeModelInput("seedream-5-5", { background: "transparent", resolution: "2K" }).resolution).toBe("2K")
  })

  it("writes PNG or JPEG only", () => {
    expect(normalizeModelInput("seedream-5-5", { outputFormat: "webp" }).outputFormat).toBe("png")
    expect(normalizeModelInput("seedream-5-5", { outputFormat: "jpg" }).outputFormat).toBe("jpeg")
  })
})

describe("Seedream 5.5 input images", () => {
  it("references swap text to image onto the edit, which takes up to 10", () => {
    expect(T2I_TO_I2I_VARIANT["seedream-5-5"]).toBe("seedream-5-5-i2i")
    expect(imageReferenceLimit("seedream-5-5")).toBe(10)
    expect(requestImageLimit("seedream-5-5")).toBe(10)
    expect(requestImageLimit("seedream-5-5-i2i")).toBe(10)
    // Every other model's request limit is unchanged.
    expect(requestImageLimit("seedream-5-flash-i2i")).toBe(14)
    expect(requestImageLimit("gpt-image-2-6-flare-i2i")).toBe(16)
  })

  it("is priced per input image, and counted as GPT Image 2.6 is", () => {
    expect(isPricedPerInputImage("seedream-5-5")).toBe(true)
    expect(isPricedPerInputImageEdit("seedream-5-5-i2i")).toBe(true)
    expect(isPricedPerInputImage("seedream-5-flash")).toBe(false)
    expect(pricedSentImages("seedream-5-5", ["https://a.png"], "https://b.png")).toBe(2)
    expect(pricedSentImages("seedream-5-flash", ["https://a.png"], "https://b.png")).toBe(1)
    expect(pricedEstimatedImages("seedream-5-5-i2i", { referenceImageUrls: ["https://a.png"] }, 1)).toBe(3)
    // The generic count is GPT Image 2.6's count, unchanged.
    for (const model of ["gpt-image-2-6-flare", "gpt-image-2-6-sunburst-i2i", "gpt-image-2-5-flare", "nano-banana-pro"]) {
      expect(pricedSentImages(model, ["https://a.png"], "https://b.png")).toBe(gptImage26SentImages(model, ["https://a.png"], "https://b.png"))
      const data = { referenceImageUrls: ["https://a.png"], baseImageUrl: "https://b.png", direction: { style: "moodboard:1" } }
      expect(pricedEstimatedImages(model, data, 2)).toBe(gptImage26EstimatedImages(model, data, 2))
    }
  })

  it("a Generate Image run with references is snapped and priced on the edit's own lists", () => {
    const n = resolveNormalizedImageGen({ provider: "seedream-5-5", aspectRatio: "auto", resolution: "1.5K", refCount: 2, swapToI2i: true })
    expect(n.modelId).toBe("seedream-5-5-i2i")
    expect(n.aspectRatio).toBe("auto")
    expect(n.identifier).toBe("seedream-5-5-i2i:1.5K:2ref")
    const t2i = resolveNormalizedImageGen({ provider: "seedream-5-5", aspectRatio: "auto", refCount: 0, swapToI2i: true })
    expect(t2i.modelId).toBe("seedream-5-5")
    expect(t2i.aspectRatio).toBe("1:1")
    expect(t2i.identifier).toBe("seedream-5-5:2K")
  })

  it("states a 5-character prompt minimum; no other model has one", () => {
    expect(getMinImagePromptChars("seedream-5-5")).toBe(5)
    expect(getMinImagePromptChars("seedream-5-5-i2i")).toBe(5)
    expect(getMinImagePromptChars("seedream-5-flash")).toBe(0)
    expect(getMinImagePromptChars(undefined)).toBe(0)
  })
})
