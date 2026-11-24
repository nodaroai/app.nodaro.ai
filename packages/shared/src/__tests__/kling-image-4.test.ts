import { describe, expect, it } from "vitest"
import { MODEL_CATALOG, defaultResolutionFor, normalizeModelInput } from "../model-catalog.js"
import { buildCreditModelIdentifier, resolveNormalizedImageGen } from "../credit-identifiers.js"
import {
  IMAGE_K_RESOLUTION_VALUES,
  IMAGE_RESOLUTION_VALUES,
  getMaxImagePromptChars,
  imageReferenceLimit,
  refusesImagesOverLimit,
  requestImageLimit,
  T2I_TO_I2I_VARIANT,
} from "../model-constants.js"
import { isPricedPerInputImage, isPricedPerInputImageEdit, pricedSentImages } from "../input-image-pricing.js"
import {
  KLING_IMAGE_4_DEFAULT_RESOLUTION,
  isKlingImage4,
  klingImage4CreditId,
  klingImage4Resolution,
  klingImage4SetCount,
} from "../kling-image-4.js"

const T2I = "kling-image-4"
const I2I = "kling-image-4-i2i"

describe("Kling Image 4.0 in the catalog", () => {
  it("renders 2K, 4K and 8K, 2K when none is named, and no 1K", () => {
    for (const id of [T2I, I2I]) {
      expect(MODEL_CATALOG[id]!.resolutions).toEqual(["2K", "4K", "8K"])
      expect(defaultResolutionFor(id)).toBe("2K")
      expect(MODEL_CATALOG[id]!.maker).toBe("kuaishou")
      expect(MODEL_CATALOG[id]!.label).toMatch(/^Kling Image 4\.0/)
    }
    expect(KLING_IMAGE_4_DEFAULT_RESOLUTION).toBe("2K")
    expect(normalizeModelInput(T2I, { resolution: "1K" }).resolution).toBe("2K")
    expect(klingImage4Resolution("8k")).toBe("8K")
    expect(klingImage4Resolution(undefined)).toBe("2K")
    expect(klingImage4Resolution("1K")).toBe("2K")
  })

  it("takes auto and the eight ratios of its schema, auto last", () => {
    const ratios = MODEL_CATALOG[T2I]!.aspectRatios!
    expect([...ratios].sort()).toEqual(["1:1", "16:9", "21:9", "2:3", "3:2", "3:4", "4:3", "9:16", "auto"].sort())
    expect(ratios[ratios.length - 1]).toBe("auto")
    expect(normalizeModelInput(T2I, { aspectRatio: "auto" }).aspectRatio).toBe("auto")
  })

  it("is the only image model that lists 8K, and every other model still moves an 8K to a size it lists", () => {
    expect(IMAGE_K_RESOLUTION_VALUES).toContain("8K")
    expect(IMAGE_RESOLUTION_VALUES).toContain("8K")
    for (const [id, m] of Object.entries(MODEL_CATALOG)) {
      if (m.kind !== "image" || isKlingImage4(id)) continue
      expect(m.resolutions ?? [], id).not.toContain("8K")
      const n = normalizeModelInput(id, { resolution: "8K" })
      expect(n.resolution === undefined || (m.resolutions ?? []).includes(n.resolution), id).toBe(true)
    }
  })

  it("an 8K on a model without it is priced at the size it is moved to, never an 8K row", () => {
    const n = resolveNormalizedImageGen({ provider: "nano-banana-pro", resolution: "8K", refCount: 0 })
    expect(n.identifier).not.toContain("8K")
    const minimax = resolveNormalizedImageGen({ provider: "minimax-h3-image", resolution: "8K", refCount: 0 })
    // The model's largest size, as MCP sends it, and reported.
    expect(minimax.resolution).toBe("4K")
    expect(minimax.identifier).toBe("minimax-h3-image:4K")
    expect(minimax.adjustments.some((a) => a.field === "resolution" && a.from === "8K")).toBe(true)
  })

  it("moves to its edit id with images, takes 10 input items in all and refuses past them", () => {
    expect(T2I_TO_I2I_VARIANT[T2I]).toBe(I2I)
    expect(imageReferenceLimit(T2I)).toBe(10)
    expect(requestImageLimit(I2I)).toBe(10)
    expect(refusesImagesOverLimit(T2I)).toBe(true)
    expect(refusesImagesOverLimit(I2I)).toBe(true)
    expect(getMaxImagePromptChars(T2I)).toBe(20000)
    expect(getMaxImagePromptChars(I2I)).toBe(20000)
  })

  it("is priced per input image, a Generate Image base counted once", () => {
    expect(isPricedPerInputImage(T2I)).toBe(true)
    expect(isPricedPerInputImageEdit(I2I)).toBe(true)
    expect(pricedSentImages(T2I, ["a", "b"], "c")).toBe(3)
    expect(pricedSentImages(T2I, ["a", "b"], "a")).toBe(2)
    // A repeated reference is sent once, so it is priced once.
    expect(pricedSentImages(T2I, ["a", "a", "b"], undefined)).toBe(2)
    expect(pricedSentImages("seedream-5-5", ["a", "a", "b"], undefined)).toBe(3)
  })
})

describe("Kling Image 4.0 price ids", () => {
  it("by size from a prompt, by size and input item with images, the edit id when images go", () => {
    expect(klingImage4CreditId(T2I, "2K", 0)).toBe("kling-image-4:2K")
    expect(klingImage4CreditId(T2I, "8K", 0)).toBe("kling-image-4:8K")
    expect(klingImage4CreditId(T2I, "4K", 3)).toBe("kling-image-4-i2i:4K:3ref")
    expect(klingImage4CreditId(I2I, "2K", 0)).toBe("kling-image-4-i2i:2K:1ref")
    expect(klingImage4CreditId(I2I, "2K", 25)).toBe("kling-image-4-i2i:2K:10ref")
    expect(klingImage4CreditId(T2I, "1K", 0)).toBe("kling-image-4:2K")
  })

  it("a set adds its count; one image, or none asked, adds nothing", () => {
    expect(klingImage4CreditId(T2I, "2K", 0, 4)).toBe("kling-image-4:2K:x4")
    expect(klingImage4CreditId(I2I, "8K", 2, 10)).toBe("kling-image-4-i2i:8K:2ref:x10")
    expect(klingImage4CreditId(T2I, "2K", 0, 1)).toBe("kling-image-4:2K")
    expect(klingImage4CreditId(T2I, "2K", 0, 30)).toBe("kling-image-4:2K:x10")
    expect(klingImageSet([undefined, 0, 1, "x", Number.NaN])).toEqual([undefined, undefined, undefined, undefined, undefined])
    expect(klingImageSet([2, "3", 10.7, 11])).toEqual([2, 3, 10, 10])
  })

  it("buildCreditModelIdentifier reads the set count for this model only", () => {
    expect(buildCreditModelIdentifier(T2I, undefined, "4K", undefined, undefined, 0, undefined, 3)).toBe("kling-image-4:4K:x3")
    expect(buildCreditModelIdentifier("minimax-h3-image", undefined, "4K", undefined, undefined, 0, undefined, 3)).toBe("minimax-h3-image:4K")
  })
})

describe("Kling Image 4.0 sets in the catalog snap", () => {
  it("keeps a set on this model, in its range", () => {
    expect(normalizeModelInput(T2I, { imageSetCount: 4 }).imageSetCount).toBe(4)
    const over = normalizeModelInput(T2I, { imageSetCount: 14 })
    expect(over.imageSetCount).toBe(10)
    expect(over.adjustments.some((a) => a.field === "imageSetCount" && a.to === 10)).toBe(true)
    expect(normalizeModelInput(T2I, { imageSetCount: 1 }).imageSetCount).toBeUndefined()
    expect(normalizeModelInput(T2I, { imageSetCount: 1 }).adjustments).toEqual([])
  })

  it("drops a set on a model that makes none, and on a masked edit, and says so", () => {
    const other = normalizeModelInput("seedream-5-5", { imageSetCount: 4 })
    expect(other.imageSetCount).toBeUndefined()
    expect(other.adjustments.some((a) => a.field === "imageSetCount" && a.to === undefined)).toBe(true)
    const masked = normalizeModelInput(I2I, { imageSetCount: 4 }, { masked: true })
    expect(masked.imageSetCount).toBeUndefined()
  })

  it("prices the set it keeps, and nothing for a set it drops", () => {
    expect(resolveNormalizedImageGen({ provider: T2I, resolution: "2K", refCount: 0, imageSetCount: 5 }).identifier).toBe("kling-image-4:2K:x5")
    expect(resolveNormalizedImageGen({ provider: T2I, resolution: "2K", refCount: 2, swapToI2i: true, imageSetCount: "3" }).identifier).toBe("kling-image-4-i2i:2K:2ref:x3")
    expect(resolveNormalizedImageGen({ provider: "seedream-5-5", resolution: "2K", refCount: 0, imageSetCount: 5 }).identifier).toBe("seedream-5-5:2K")
    const masked = resolveNormalizedImageGen({ provider: T2I, resolution: "2K", refCount: 0, imageSetCount: 5, imageSetMasked: true })
    expect(masked.identifier).toBe("kling-image-4:2K")
    expect(masked.adjustments.find((a) => a.field === "imageSetCount")?.from).toBe(5)
  })
})

function klingImageSet(values: unknown[]): (number | undefined)[] {
  return values.map((v) => klingImage4SetCount(v))
}
