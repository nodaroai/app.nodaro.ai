import { describe, expect, it } from "vitest"
import { MODEL_CATALOG, MODEL_MAKERS, defaultResolutionFor, normalizeModelInput } from "../model-catalog.js"
import { buildCreditModelIdentifier, resolveNormalizedImageGen } from "../credit-identifiers.js"
import {
  IMAGE_ASPECT_RATIO_VALUES,
  IMAGE_GEN_PROVIDERS,
  IMAGE_I2I_PROVIDERS,
  MODELS_WITH_REFERENCE_IMAGE_SUPPORT,
  SEED_SUPPORT,
  T2I_TO_I2I_VARIANT,
  VARIABLE_PRICING_MODELS,
  getMaxImagePromptChars,
  getMinImagePromptChars,
  imageReferenceLimit,
  requestImageLimit,
} from "../model-constants.js"
import { isPricedPerInputImage, priceReadsInputImages, pricedEstimatedImages, pricedSentImages } from "../input-image-pricing.js"
import { isFlux2Model } from "../flux2-pricing.js"
import { mapQuality } from "../node-default-mappings.js"
import {
  FLUX_3_KLEIN_DEFAULT_RESOLUTION,
  FLUX_3_KLEIN_I2I,
  FLUX_3_KLEIN_T2I,
  flux3KleinCreditId,
  flux3KleinResolution,
  isFlux3Klein,
  isFlux3KleinI2i,
} from "../flux-3-klein.js"

const T2I = FLUX_3_KLEIN_T2I
const I2I = FLUX_3_KLEIN_I2I
const NINE = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "9:21"]

describe("FLUX 3 Klein in the catalog", () => {
  it("two ids, Black Forest Labs' own, in the Flux line, beside and apart from FLUX 2 Klein", () => {
    for (const id of [T2I, I2I]) {
      const m = MODEL_CATALOG[id]!
      expect(m.kind).toBe("image")
      expect(m.maker).toBe("black-forest-labs")
      expect(MODEL_MAKERS["black-forest-labs"].name).toBe("Black Forest Labs")
      expect(m.series).toBe("Flux")
      expect(isFlux2Model(id)).toBe(false)
    }
    expect(MODEL_CATALOG[T2I]!.modes).toEqual(["t2i"])
    expect(MODEL_CATALOG[I2I]!.modes).toEqual(["i2i"])
    expect(MODEL_CATALOG["flux-2-klein"]).toBeDefined()
    expect(isFlux3Klein("flux-2-klein")).toBe(false)
    expect(isFlux3KleinI2i(T2I)).toBe(false)
    expect(isFlux3KleinI2i(I2I)).toBe(true)
  })

  it("takes 1K, 2K and 4K, 1K when none is named", () => {
    for (const id of [T2I, I2I]) {
      expect(MODEL_CATALOG[id]!.resolutions).toEqual(["1K", "2K", "4K"])
      expect(MODEL_CATALOG[id]!.defaultResolution).toBeUndefined()
      expect(defaultResolutionFor(id)).toBeUndefined()
    }
    expect(FLUX_3_KLEIN_DEFAULT_RESOLUTION).toBe("1K")
    expect(flux3KleinResolution(undefined)).toBe("1K")
    expect(flux3KleinResolution("2k")).toBe("2K")
    expect(flux3KleinResolution(" 4K ")).toBe("4K")
    expect(flux3KleinResolution("1.5K")).toBe("1K")
    expect(flux3KleinResolution("2 MP")).toBe("1K")
  })

  it("text to image lists the nine ratios, 1:1 first and no auto; the edit adds auto last", () => {
    expect(MODEL_CATALOG[T2I]!.aspectRatios).toEqual(NINE)
    expect(MODEL_CATALOG[I2I]!.aspectRatios).toEqual([...NINE, "auto"])
    for (const ratio of [...NINE, "auto"]) expect(IMAGE_ASPECT_RATIO_VALUES).toContain(ratio)
    // A provider schema with a closed list: the Scene and surround lanes check the ratio.
    expect(MODEL_CATALOG[T2I]!.strictAspectRatios).toBe(true)
    expect(MODEL_CATALOG[I2I]!.strictAspectRatios).toBe(true)
    // The schema says the edit's auto takes the first image's shape; unmeasured, so not overridden.
    expect(MODEL_CATALOG[I2I]!.autoAspectFromSourceImage).toBeUndefined()
  })

  it("auto on text to image becomes a real ratio, the edit keeps its own", () => {
    expect(normalizeModelInput(T2I, { aspectRatio: "auto" }).aspectRatio).toBe("1:1")
    const portrait = normalizeModelInput(T2I, { aspectRatio: "auto" }, { sourceImage: { width: 768, height: 1024 } })
    expect(portrait.aspectRatio).toBe("3:4")
    expect(normalizeModelInput(I2I, { aspectRatio: "auto" }).aspectRatio).toBe("auto")
    expect(normalizeModelInput(T2I, { aspectRatio: "9:21" }).aspectRatio).toBe("9:21")
  })

  it("a size it does not list snaps to 1K before anything is priced", () => {
    expect(normalizeModelInput(T2I, { resolution: "1.5K" }).resolution).toBe("1K")
    expect(normalizeModelInput(I2I, { resolution: "2 MP" }).resolution).toBe("1K")
    expect(normalizeModelInput(T2I, { resolution: "4K" }).resolution).toBe("4K")
  })

  it("writes PNG (the default) or JPEG; offers no background or quality", () => {
    for (const id of [T2I, I2I]) {
      const m = MODEL_CATALOG[id]!
      expect(m.outputFormats).toEqual(["png", "jpeg"])
      expect(m.backgrounds).toBeUndefined()
      expect(m.qualities).toBeUndefined()
      expect(normalizeModelInput(id, { outputFormat: "jpg" }).outputFormat).toBe("jpeg")
      // WebP, which the provider also writes, is not offered: it snaps to PNG.
      expect(normalizeModelInput(id, { outputFormat: "webp" }).outputFormat).toBe("png")
    }
  })

  it("the catalog's price rows: the bare id and one per size, the same on both ids", () => {
    const rows = (id: string) => Object.fromEntries(MODEL_CATALOG[id]!.pricing.map((r) => [r.identifier, r.credits]))
    expect(rows(T2I)).toEqual({ "flux-3-klein": 4, "flux-3-klein:1K": 4, "flux-3-klein:2K": 7, "flux-3-klein:4K": 17 })
    expect(rows(I2I)).toEqual({ "flux-3-klein-i2i": 4, "flux-3-klein-i2i:1K": 4, "flux-3-klein-i2i:2K": 7, "flux-3-klein-i2i:4K": 17 })
    expect(MODEL_CATALOG[T2I]!.pricing[0]!.identifier).toBe(T2I)
    expect(MODEL_CATALOG[I2I]!.pricing[0]!.identifier).toBe(I2I)
  })
})

describe("FLUX 3 Klein price ids", () => {
  it("one id per size, 1K for none or a size it does not list", () => {
    expect(buildCreditModelIdentifier(T2I)).toBe("flux-3-klein:1K")
    expect(buildCreditModelIdentifier(T2I, undefined, "1K")).toBe("flux-3-klein:1K")
    expect(buildCreditModelIdentifier(T2I, undefined, "2K")).toBe("flux-3-klein:2K")
    expect(buildCreditModelIdentifier(T2I, undefined, "4K")).toBe("flux-3-klein:4K")
    expect(buildCreditModelIdentifier(T2I, undefined, "1.5K")).toBe("flux-3-klein:1K")
    expect(buildCreditModelIdentifier(I2I, undefined, "4K")).toBe("flux-3-klein-i2i:4K")
    expect(buildCreditModelIdentifier(I2I)).toBe("flux-3-klein-i2i:1K")
  })

  it("a quality never reaches the id", () => {
    expect(buildCreditModelIdentifier(T2I, "high", "2K")).toBe("flux-3-klein:2K")
  })

  it("images move the text-to-image id onto the edit id; their count never shows", () => {
    expect(buildCreditModelIdentifier(T2I, undefined, "2K", undefined, undefined, 3)).toBe("flux-3-klein-i2i:2K")
    for (const n of [0, 1, 10, 20]) {
      expect(buildCreditModelIdentifier(I2I, undefined, "4K", undefined, undefined, n)).toBe("flux-3-klein-i2i:4K")
    }
    expect(flux3KleinCreditId(T2I, "2K", Number.NaN)).toBe("flux-3-klein:2K")
  })

  it("is priced by size, not per input image", () => {
    expect(isPricedPerInputImage(T2I)).toBe(false)
    expect(isPricedPerInputImage(I2I)).toBe(false)
    expect(VARIABLE_PRICING_MODELS[T2I]).toBe("resolution")
    expect(VARIABLE_PRICING_MODELS[I2I]).toBe("resolution")
  })

  it("counts every image a run sends, a base image included, so the id priced is the edit it runs", () => {
    expect(priceReadsInputImages(T2I)).toBe(true)
    expect(priceReadsInputImages(I2I)).toBe(true)
    expect(pricedSentImages(T2I, [], "https://base.png")).toBe(1)
    expect(pricedSentImages(T2I, ["https://a.png"], "https://base.png")).toBe(2)
    expect(pricedSentImages(T2I, ["https://base.png"], "https://base.png")).toBe(1)
    expect(buildCreditModelIdentifier(T2I, undefined, "2K", undefined, undefined, pricedSentImages(T2I, [], "https://base.png"))).toBe("flux-3-klein-i2i:2K")
    expect(pricedEstimatedImages(T2I, {}, 2)).toBe(2)
    // FLUX 2 Klein and the models not priced by their images count as before.
    expect(priceReadsInputImages("flux-2-klein")).toBe(false)
    expect(pricedSentImages("flux-2-klein", ["https://a.png"], "https://base.png")).toBe(1)
    expect(pricedSentImages("nano-banana-pro", ["https://a.png"], "https://base.png")).toBe(1)
  })

  it("a Generate Image run with references is snapped and priced on the edit", () => {
    const n = resolveNormalizedImageGen({ provider: T2I, aspectRatio: "auto", resolution: "2K", refCount: 2, swapToI2i: true })
    expect(n.modelId).toBe(I2I)
    expect(n.aspectRatio).toBe("auto")
    expect(n.identifier).toBe("flux-3-klein-i2i:2K")
    const t2i = resolveNormalizedImageGen({ provider: T2I, aspectRatio: "auto", refCount: 0, swapToI2i: true })
    expect(t2i.modelId).toBe(T2I)
    expect(t2i.aspectRatio).toBe("1:1")
    expect(t2i.identifier).toBe("flux-3-klein:1K")
  })
})

describe("FLUX 3 Klein's place in the shared lists", () => {
  it("joins the route vocabularies, the reference-image models and the seed models", () => {
    expect(IMAGE_GEN_PROVIDERS).toContain(T2I)
    expect(IMAGE_I2I_PROVIDERS).toContain(I2I)
    expect(MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(T2I)).toBe(true)
    expect(MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(I2I)).toBe(true)
    expect(SEED_SUPPORT.has(T2I)).toBe(true)
    expect(SEED_SUPPORT.has(I2I)).toBe(true)
  })

  it("references swap text to image onto the edit, which takes up to 10", () => {
    expect(T2I_TO_I2I_VARIANT[T2I]).toBe(I2I)
    expect(imageReferenceLimit(T2I)).toBe(10)
    expect(imageReferenceLimit(I2I)).toBe(10)
    expect(requestImageLimit(T2I)).toBe(10)
    expect(requestImageLimit(I2I)).toBe(10)
    // FLUX 2 Klein's limits are its own.
    expect(imageReferenceLimit("flux-2-klein")).toBe(1)
    expect(requestImageLimit("flux-2-klein")).toBe(14)
  })

  it("prompts of 1 to 5000 characters: the default cap, no minimum", () => {
    expect(getMaxImagePromptChars(T2I)).toBe(5000)
    expect(getMaxImagePromptChars(I2I)).toBe(5000)
    expect(getMinImagePromptChars(T2I)).toBe(0)
    expect(getMinImagePromptChars(I2I)).toBe(0)
  })

  it("an admin's quality level maps onto its sizes", () => {
    for (const id of [T2I, I2I]) {
      expect(mapQuality(id, "low")).toEqual({ field: "resolution", value: "1K" })
      expect(mapQuality(id, "mid")).toEqual({ field: "resolution", value: "2K" })
      expect(mapQuality(id, "high")).toEqual({ field: "resolution", value: "4K" })
    }
  })
})
