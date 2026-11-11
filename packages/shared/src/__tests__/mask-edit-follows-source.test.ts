import { describe, expect, it } from "vitest"
import { MODEL_CATALOG, maskEditMatchesSource, normalizeModelInput, resolutionNearestSource, sourceImageSizeNeeded } from "../model-catalog.js"
import { resolveNormalizedImageGen } from "../credit-identifiers.js"
import { I2I_MASK_SUPPORT } from "../model-constants.js"
import { nodeIsMasked, wiredImageSize } from "../wired-image-size.js"

/**
 * A masked GPT Image 2.6 edit follows its photo: the result is pasted back onto
 * the photo at the photo's own size, so the run keeps the photo's shape and is
 * rendered, and priced, at the size nearest the photo.
 */
const FOLLOWING = ["gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst-i2i"] as const
const PHOTO_1K_PORTRAIT = { width: 768, height: 1024 }
const PHOTO_4000_PORTRAIT = { width: 3000, height: 4000 }

describe("the catalog", () => {
  it("only GPT Image 2.6 Flare's and Sunburst's edits follow their photo", () => {
    const declared = Object.values(MODEL_CATALOG).filter((m) => m.maskEditMatchesSource).map((m) => m.id).sort()
    expect(declared).toEqual([...FOLLOWING])
  })

  it("each such model takes a mask, and has a size for every ratio it lists at every size", () => {
    for (const id of FOLLOWING) {
      const m = MODEL_CATALOG[id]!
      expect(I2I_MASK_SUPPORT.has(id)).toBe(true)
      for (const ratio of m.aspectRatios!.filter((r) => r !== "auto")) {
        for (const size of m.resolutions!) expect(m.outputSizes?.[ratio]?.[size], `${id} ${ratio} ${size}`).toBeDefined()
      }
    }
  })

  it("the table is the provider's: 1:1 at 4K is 2880 square, 9:16 at 4K 2160x3840", () => {
    const sizes = MODEL_CATALOG["gpt-image-2-6-flare-i2i"]!.outputSizes!
    expect(sizes["1:1"]!["4K"]).toEqual([2880, 2880])
    expect(sizes["9:16"]!["4K"]).toEqual([2160, 3840])
    expect(sizes["3:4"]!["1K"]).toEqual([768, 1024])
  })
})

describe("maskEditMatchesSource / sourceImageSizeNeeded", () => {
  it("is true only with a mask, on a model that follows its photo", () => {
    expect(maskEditMatchesSource("gpt-image-2-6-flare-i2i", true)).toBe(true)
    expect(maskEditMatchesSource("gpt-image-2-6-flare-i2i", false)).toBe(false)
    expect(maskEditMatchesSource("ideogram-edit", true)).toBe(false)
    expect(maskEditMatchesSource("gpt-image-2-6-economy-i2i", true)).toBe(false)
  })

  it("a masked 2.6 edit needs the photo's size even when it names a ratio", () => {
    expect(sourceImageSizeNeeded("gpt-image-2-6-flare-i2i", "16:9", true)).toBe(true)
    expect(sourceImageSizeNeeded("gpt-image-2-6-flare-i2i", "16:9", false)).toBe(false)
    expect(sourceImageSizeNeeded("gpt-image-2-6-flare-i2i", "auto", false)).toBe(true)
  })
})

describe("resolutionNearestSource", () => {
  it("picks the size whose long side is nearest the photo's", () => {
    expect(resolutionNearestSource("gpt-image-2-6-flare-i2i", "3:4", PHOTO_1K_PORTRAIT)).toBe("1K")
    expect(resolutionNearestSource("gpt-image-2-6-flare-i2i", "3:4", PHOTO_4000_PORTRAIT)).toBe("4K")
    expect(resolutionNearestSource("gpt-image-2-6-flare-i2i", "3:4", { width: 1536, height: 2048 })).toBe("2K")
    // Nearest by ratio: 1500 px is nearer 2048 than 1024.
    expect(resolutionNearestSource("gpt-image-2-6-flare-i2i", "1:1", { width: 1500, height: 1500 })).toBe("2K")
  })

  it("is undefined with no size, an unknown ratio or a model without a table", () => {
    expect(resolutionNearestSource("gpt-image-2-6-flare-i2i", "3:4", undefined)).toBeUndefined()
    expect(resolutionNearestSource("gpt-image-2-6-flare-i2i", "auto", PHOTO_1K_PORTRAIT)).toBeUndefined()
    expect(resolutionNearestSource("gpt-image-2-6-flare-i2i", "constructor", PHOTO_1K_PORTRAIT)).toBeUndefined()
    expect(resolutionNearestSource("gpt-image-2-i2i", "3:4", PHOTO_1K_PORTRAIT)).toBeUndefined()
  })
})

describe("normalizeModelInput: a masked edit that follows its photo", () => {
  for (const id of FOLLOWING) {
    it(`${id}: a 1K photo with a 4K request runs, and is priced, at 1K`, () => {
      const n = normalizeModelInput(id, { aspectRatio: "auto", resolution: "4K" }, { sourceImage: PHOTO_1K_PORTRAIT, masked: true })
      expect(n.aspectRatio).toBe("3:4")
      expect(n.resolution).toBe("1K")
      expect(n.adjustments).toContainEqual(expect.objectContaining({ field: "resolution", from: "4K", to: "1K" }))
      const priced = resolveNormalizedImageGen({ provider: id, aspectRatio: "auto", resolution: "4K", refCount: 1, sourceImage: PHOTO_1K_PORTRAIT, masked: true })
      expect(priced.identifier).toBe(`${id}:medium:1K:1ref`)
      expect(priced.resolution).toBe("1K")
    })

    it(`${id}: a 4000 px photo with a 1K request runs, and is priced, at 4K`, () => {
      const priced = resolveNormalizedImageGen({ provider: id, aspectRatio: "auto", resolution: "1K", refCount: 1, sourceImage: PHOTO_4000_PORTRAIT, masked: true })
      expect(priced.identifier).toBe(`${id}:medium:4K:1ref`)
      expect(priced.adjustments).toContainEqual(expect.objectContaining({ field: "resolution", from: "1K", to: "4K" }))
    })

    it(`${id}: a named 16:9 on a 3:4 photo runs 3:4, and says so`, () => {
      const n = normalizeModelInput(id, { aspectRatio: "16:9", resolution: "1K" }, { sourceImage: PHOTO_1K_PORTRAIT, masked: true })
      expect(n.aspectRatio).toBe("3:4")
      expect(n.adjustments).toContainEqual(expect.objectContaining({ field: "aspectRatio", from: "16:9", to: "3:4" }))
      expect(n.adjustments.find((a) => a.field === "aspectRatio")!.reason).toContain("masked edit")
    })

    it(`${id}: no ratio named also keeps the photo's shape`, () => {
      const n = normalizeModelInput(id, { resolution: "2K" }, { sourceImage: { width: 2048, height: 1536 }, masked: true })
      expect(n.aspectRatio).toBe("4:3")
      expect(n.resolution).toBe("2K")
      expect(n.adjustments).toEqual([])
    })

    it(`${id}: with the photo's size unknown, the ratio is "auto" and the size asked is kept`, () => {
      const n = normalizeModelInput(id, { aspectRatio: "16:9", resolution: "4K" }, { masked: true })
      expect(n.aspectRatio).toBe("auto")
      expect(n.resolution).toBe("4K")
      expect(n.adjustments).toEqual([expect.objectContaining({ field: "aspectRatio", from: "16:9", to: "auto" })])
    })

    it(`${id}: without a mask, the ratio and the size asked are kept`, () => {
      const n = normalizeModelInput(id, { aspectRatio: "16:9", resolution: "4K" }, { sourceImage: PHOTO_1K_PORTRAIT })
      expect(n.aspectRatio).toBe("16:9")
      expect(n.resolution).toBe("4K")
      expect(n.adjustments).toEqual([])
    })

    it(`${id}: a transparent background still renders at 1K`, () => {
      const n = normalizeModelInput(id, { aspectRatio: "auto", resolution: "1K", background: "transparent" }, { sourceImage: PHOTO_4000_PORTRAIT, masked: true })
      expect(n.resolution).toBe("1K")
    })
  }

  it("another mask model keeps the ratio and the size it names", () => {
    const n = normalizeModelInput("gpt-image-2-6-economy-i2i", { aspectRatio: "16:9" }, { sourceImage: PHOTO_1K_PORTRAIT, masked: true })
    expect(n.aspectRatio).toBe("16:9")
  })
})

describe("wiredImageSize / nodeIsMasked (what an estimate knows of the photo)", () => {
  const nodes = [
    { id: "gen", data: { generatedResults: [{ width: 1024, height: 1024 }, { width: 768, height: 1024 }], activeResultIndex: 1 } },
    { id: "up", data: { width: 4000, height: 3000 } },
    { id: "none", data: {} },
    { id: "n", data: {} },
  ]
  it("reads the shown result's size, else the node's own, from the node wired into `image`", () => {
    expect(wiredImageSize("n", nodes, [{ source: "gen", target: "n", targetHandle: "image" }])).toEqual({ width: 768, height: 1024 })
    expect(wiredImageSize("n", nodes, [{ source: "up", target: "n", targetHandle: "image" }])).toEqual({ width: 4000, height: 3000 })
    expect(wiredImageSize("n", nodes, [{ source: "none", target: "n", targetHandle: "image" }])).toBeUndefined()
    // A mask or another input is not the photo.
    expect(wiredImageSize("n", nodes, [{ source: "up", target: "n", targetHandle: "mask" }])).toBeUndefined()
  })

  it("a node is masked by its own maskUrl or a wire into `mask`", () => {
    expect(nodeIsMasked("n", { maskUrl: "https://m.png" }, [])).toBe(true)
    expect(nodeIsMasked("n", {}, [{ source: "gm", target: "n", targetHandle: "mask" }])).toBe(true)
    expect(nodeIsMasked("n", {}, [{ source: "x", target: "n", targetHandle: "image" }])).toBe(false)
  })
})
