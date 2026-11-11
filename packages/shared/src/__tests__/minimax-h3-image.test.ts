import { describe, expect, it } from "vitest"
import { buildCreditModelIdentifier, resolveNormalizedImageGen } from "../credit-identifiers.js"
import { MODEL_CATALOG, defaultResolutionFor, normalizeModelInput } from "../model-catalog.js"
import {
  MINIMAX_H3_IMAGE_I2I,
  MINIMAX_H3_IMAGE_T2I,
  isMinimaxH3Image,
  minimaxH3ImageCreditId,
} from "../minimax-h3-image.js"
import { isPricedPerInputImage, pricedEstimatedImages, pricedSentImages } from "../input-image-pricing.js"
import {
  IMAGE_GEN_PROVIDERS,
  IMAGE_I2I_PROVIDERS,
  MINIMAX_H3_PROVIDERS,
  REF_IMAGE_MAX_LIMITS,
  T2I_TO_I2I_VARIANT,
  imageReferenceLimit,
  isMinimaxH3Provider,
  requestImageLimit,
} from "../model-constants.js"

const T2I = MINIMAX_H3_IMAGE_T2I
const I2I = MINIMAX_H3_IMAGE_I2I

describe("MiniMax H3 Image ids", () => {
  it("is an image model on both lists, and never the H3 video model", () => {
    expect(IMAGE_GEN_PROVIDERS).toContain(T2I)
    expect(IMAGE_I2I_PROVIDERS).toContain(I2I)
    for (const id of [T2I, I2I]) {
      expect(MODEL_CATALOG[id]!.kind).toBe("image")
      expect(MINIMAX_H3_PROVIDERS.has(id)).toBe(false)
      expect(isMinimaxH3Provider(id)).toBe(false)
    }
    expect(isMinimaxH3Image("minimax-h3")).toBe(false)
    expect(isPricedPerInputImage("minimax-h3")).toBe(false)
  })

  it("references move a prompt to the edit id, up to sixteen of them", () => {
    expect(T2I_TO_I2I_VARIANT[T2I]).toBe(I2I)
    expect(REF_IMAGE_MAX_LIMITS[I2I]).toBe(16)
    expect(imageReferenceLimit(T2I)).toBe(16)
    expect(requestImageLimit(T2I)).toBe(16)
    expect(requestImageLimit(I2I)).toBe(16)
  })
})

describe("MiniMax H3 Image catalog entries", () => {
  it("offer ten ratios and auto, auto last so a first-listed fallback lands on a real ratio", () => {
    for (const id of [T2I, I2I]) {
      const ratios = MODEL_CATALOG[id]!.aspectRatios!
      expect(ratios).toHaveLength(11)
      expect(ratios[0]).not.toBe("auto")
      expect(ratios[ratios.length - 1]).toBe("auto")
      expect([...ratios].sort()).toEqual(["1:1", "16:9", "21:9", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "auto"].sort())
    }
  })

  it("render 1K, 2K and 4K at every ratio, 2K by default", () => {
    for (const id of [T2I, I2I]) {
      const entry = MODEL_CATALOG[id]!
      expect(entry.resolutions).toEqual(["1K", "2K", "4K"])
      expect(entry.resolutionsByAspectRatio).toBeUndefined()
      expect(defaultResolutionFor(id)).toBe("2K")
    }
  })

  it("write PNG by default or JPEG, and nothing else", () => {
    for (const id of [T2I, I2I]) {
      expect(MODEL_CATALOG[id]!.outputFormats).toEqual(["png", "jpeg"])
      expect(normalizeModelInput(id, { outputFormat: "webp" }).outputFormat).toBe("png")
      expect(normalizeModelInput(id, { outputFormat: "jpeg" }).outputFormat).toBe("jpeg")
    }
  })

  it("take a seed and no quality, background or mask", () => {
    for (const id of [T2I, I2I]) {
      const entry = MODEL_CATALOG[id]!
      expect(entry.noSeed).toBeUndefined()
      expect(entry.qualities).toBeUndefined()
      expect(entry.backgrounds).toBeUndefined()
      expect(entry.features ?? []).not.toContain("mask")
      expect(entry.autoAspectFromSourceImage).toBeUndefined()
    }
  })
})

describe("MiniMax H3 Image price ids", () => {
  it("a prompt is priced by its size, 2K when none or an unknown one is named", () => {
    expect(buildCreditModelIdentifier(T2I)).toBe("minimax-h3-image:2K")
    expect(buildCreditModelIdentifier(T2I, undefined, "1K")).toBe("minimax-h3-image:1K")
    expect(buildCreditModelIdentifier(T2I, undefined, "4K")).toBe("minimax-h3-image:4K")
    expect(buildCreditModelIdentifier(T2I, undefined, "4k")).toBe("minimax-h3-image:4K")
    expect(buildCreditModelIdentifier(T2I, undefined, "2 MP")).toBe("minimax-h3-image:2K")
  })

  it("a quality another model takes changes nothing", () => {
    expect(buildCreditModelIdentifier(T2I, "high", "1K")).toBe("minimax-h3-image:1K")
  })

  it("an edit is priced by its size and its reference images, one to sixteen", () => {
    expect(buildCreditModelIdentifier(I2I, undefined, "4K", undefined, undefined, 3)).toBe("minimax-h3-image-i2i:4K:3ref")
    expect(buildCreditModelIdentifier(I2I, undefined, undefined, undefined, undefined, 0)).toBe("minimax-h3-image-i2i:2K:1ref")
    expect(buildCreditModelIdentifier(I2I, undefined, "1K", undefined, undefined, 40)).toBe("minimax-h3-image-i2i:1K:16ref")
  })

  it("the text-to-image id sent images is priced as the edit it runs as", () => {
    expect(minimaxH3ImageCreditId(T2I, "1K", 2)).toBe("minimax-h3-image-i2i:1K:2ref")
    expect(buildCreditModelIdentifier(T2I, undefined, "4K", undefined, undefined, 1)).toBe("minimax-h3-image-i2i:4K:1ref")
  })

  it("the route and workflow snap price the size they send, with the swap or without", () => {
    const swapped = resolveNormalizedImageGen({ provider: T2I, resolution: "4K", aspectRatio: "16:9", refCount: 2, swapToI2i: true })
    expect(swapped.modelId).toBe(I2I)
    expect(swapped.identifier).toBe("minimax-h3-image-i2i:4K:2ref")
    const entity = resolveNormalizedImageGen({ provider: T2I, refCount: 1, swapToI2i: false })
    expect(entity.modelId).toBe(T2I)
    expect(entity.identifier).toBe("minimax-h3-image-i2i:2K:1ref")
  })
})

describe("MiniMax H3 Image: the images a run sends", () => {
  const BASE = "https://cdn.example.com/base.png"
  const REF = "https://cdn.example.com/ref.png"

  it("counts the base of an edit, once", () => {
    expect(pricedSentImages(T2I, [], BASE)).toBe(1)
    expect(pricedSentImages(T2I, [REF], BASE)).toBe(2)
    expect(pricedSentImages(T2I, [BASE, REF], BASE)).toBe(2)
  })

  it("leaves every other model on its references alone", () => {
    expect(pricedSentImages("seedream-5-flash", [REF], BASE)).toBe(1)
    expect(pricedSentImages("minimax-h3", [REF], BASE)).toBe(1)
  })

  it("an estimate counts the node's images, the wired ones and an edit's own source", () => {
    expect(pricedEstimatedImages(T2I, { referenceImageUrls: [REF] }, 2)).toBe(3)
    expect(pricedEstimatedImages(I2I, {}, 0)).toBe(1)
  })
})
