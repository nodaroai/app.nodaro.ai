import { describe, expect, it } from "vitest"
import { buildCreditModelIdentifier, imageFormatInputOf, resolveNormalizedImageGen } from "../credit-identifiers.js"
import { MODEL_CATALOG, normalizeModelInput, outputFormatOptionsByKind, svgLevelOptionsByKind } from "../model-catalog.js"
import { GPT_IMAGE_2_6_GIF_BANDS, gptImage26GifBand, gptImage26PricedFormat } from "../gpt-image-2-6.js"

const FLARE = "gpt-image-2-6-flare"
const fields = (n: ReturnType<typeof normalizeModelInput>) => n.adjustments.map((a) => a.field)

describe("which models write which files", () => {
  it("Flare and Sunburst write five formats from a prompt and from an edit, Economy fewer", () => {
    for (const id of ["gpt-image-2-6-flare", "gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst", "gpt-image-2-6-sunburst-i2i"]) {
      expect(MODEL_CATALOG[id]!.outputFormats).toEqual(["png", "jpeg", "webp", "gif", "svg"])
      expect(MODEL_CATALOG[id]!.svgLevels).toEqual(["standard", "detailed", "max"])
      expect(MODEL_CATALOG[id]!.gifFrames).toEqual({ min: 2, max: 16, default: 9 })
      expect(MODEL_CATALOG[id]!.gifFrameDurationMs).toEqual({ min: 20, max: 2000, step: 10, default: 200 })
    }
    expect(MODEL_CATALOG["gpt-image-2-6-economy"]!.outputFormats).toEqual(["png", "gif"])
    expect(MODEL_CATALOG["gpt-image-2-6-economy"]!.gifFrames?.values).toEqual([4, 9, 16])
    expect(MODEL_CATALOG["gpt-image-2-6-economy-i2i"]!.outputFormats).toEqual(["png"])
  })

  it("a menu offers a format only on a model that writes more than one", () => {
    const formats = outputFormatOptionsByKind("image")
    expect(Object.keys(formats).sort()).toEqual(["gpt-image-2-6-economy", "gpt-image-2-6-flare", "gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst", "gpt-image-2-6-sunburst-i2i", "minimax-h3-image", "minimax-h3-image-i2i", "seedream-5-5", "seedream-5-5-i2i"])
    expect(formats[FLARE]!.map((o) => o.value)).toEqual(["png", "jpeg", "webp", "gif", "svg"])
    expect(formats["minimax-h3-image"]!.map((o) => o.value)).toEqual(["png", "jpeg"])
    expect(formats["minimax-h3-image-i2i"]!.map((o) => o.value)).toEqual(["png", "jpeg"])
    expect(formats["seedream-5-5"]!.map((o) => o.value)).toEqual(["png", "jpeg"])
    expect(Object.keys(svgLevelOptionsByKind("image")).sort()).toEqual(["gpt-image-2-6-flare", "gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst", "gpt-image-2-6-sunburst-i2i"])
    expect(svgLevelOptionsByKind("image")[FLARE]!.map((o) => o.label)).toEqual(["SVG Standard", "SVG Detailed", "SVG Max"])
  })

  it("the bands of frames cover 2 to 16 without a gap", () => {
    const frames = GPT_IMAGE_2_6_GIF_BANDS.flatMap((b) => Array.from({ length: b.max - b.min + 1 }, (_, i) => b.min + i))
    expect(frames).toEqual(Array.from({ length: 15 }, (_, i) => i + 2))
    expect(gptImage26GifBand(1)).toBe("2-8")
    expect(gptImage26GifBand(40)).toBe("13-16")
    expect(gptImage26GifBand("14")).toBe("13-16")
    expect(gptImage26GifBand(undefined)).toBe("9-12")
  })
})

describe("a GIF's levers", () => {
  it("ignores the ratio and the size, and says so", () => {
    const n = normalizeModelInput(FLARE, { outputFormat: "gif", aspectRatio: "16:9", resolution: "4K", quality: "high" })
    expect(n).toMatchObject({ outputFormat: "gif", aspectRatio: "1:1", resolution: undefined, quality: "high", gifFrames: 9, gifFrameDurationMs: 200 })
    expect(fields(n)).toEqual(["aspectRatio", "resolution"])
    expect(n.adjustments[0]!.reason).toContain("square")
  })

  it("auto and a square ratio say nothing", () => {
    expect(normalizeModelInput(FLARE, { outputFormat: "gif", aspectRatio: "auto" }).adjustments).toEqual([])
    expect(normalizeModelInput(FLARE, { outputFormat: "gif", aspectRatio: "1:1" }).adjustments).toEqual([])
  })

  it("keeps its frames and speed in range, and the speed on its step", () => {
    const n = normalizeModelInput(FLARE, { outputFormat: "gif", gifFrames: 30, gifFrameDurationMs: 155 })
    expect(n).toMatchObject({ gifFrames: 16, gifFrameDurationMs: 160 })
    expect(fields(n)).toEqual(["gifFrames", "gifFrameDurationMs"])
    expect(normalizeModelInput(FLARE, { outputFormat: "gif", gifFrames: 1, gifFrameDurationMs: 5000 })).toMatchObject({ gifFrames: 2, gifFrameDurationMs: 2000 })
  })

  it("Economy takes 4, 9 or 16 frames: the nearest", () => {
    expect(normalizeModelInput("gpt-image-2-6-economy", { outputFormat: "gif", gifFrames: 6 }).gifFrames).toBe(4)
    expect(normalizeModelInput("gpt-image-2-6-economy", { outputFormat: "gif", gifFrames: 12 }).gifFrames).toBe(9)
    expect(normalizeModelInput("gpt-image-2-6-economy", { outputFormat: "gif", gifFrames: 15 }).gifFrames).toBe(16)
  })

  it("moves a transparent background to auto, and keeps an opaque one", () => {
    const n = normalizeModelInput(FLARE, { outputFormat: "gif", background: "transparent" })
    expect(n.background).toBe("auto")
    expect(fields(n)).toEqual(["background"])
    expect(normalizeModelInput(FLARE, { outputFormat: "gif", background: "opaque" }).background).toBe("opaque")
  })

  it("is not moved to 1K by a transparent background", () => {
    const n = normalizeModelInput(FLARE, { outputFormat: "gif", background: "transparent", resolution: "4K" })
    expect(n.resolution).toBeUndefined()
    expect(n.adjustments.some((a) => a.to === "1K")).toBe(false)
  })
})

describe("an SVG's levers", () => {
  it("takes its level, Standard when none is named", () => {
    expect(normalizeModelInput(FLARE, { outputFormat: "svg" }).svgLevel).toBe("standard")
    expect(normalizeModelInput(FLARE, { outputFormat: "svg", svgLevel: "Detailed" }).svgLevel).toBe("detailed")
    const n = normalizeModelInput(FLARE, { outputFormat: "svg", svgLevel: "ultra" })
    expect(n.svgLevel).toBe("standard")
    expect(fields(n)).toEqual(["svgLevel"])
  })

  it("keeps the ratio and size of a PNG", () => {
    expect(normalizeModelInput(FLARE, { outputFormat: "svg", aspectRatio: "16:9", resolution: "2K" })).toMatchObject({ aspectRatio: "16:9", resolution: "2K", adjustments: [] })
  })

  it("takes no background: any but auto becomes auto, said once", () => {
    for (const background of ["transparent", "opaque"]) {
      const n = normalizeModelInput(FLARE, { outputFormat: "svg", background, resolution: "4K" })
      expect(n.background).toBe("auto")
      expect(n.resolution).toBe("4K")
      expect(fields(n)).toEqual(["background"])
    }
  })
})

describe("JPEG and WebP", () => {
  it("JPEG moves a transparent background to auto at the size asked; WebP keeps it, at 1K", () => {
    const jpeg = normalizeModelInput(FLARE, { outputFormat: "jpeg", background: "transparent", resolution: "4K" })
    expect(jpeg).toMatchObject({ outputFormat: "jpeg", background: "auto", resolution: "4K" })
    const webp = normalizeModelInput(FLARE, { outputFormat: "webp", background: "transparent", resolution: "4K" })
    expect(webp).toMatchObject({ outputFormat: "webp", background: "transparent", resolution: "1K" })
  })

  it("jpg is jpeg, in any case", () => {
    expect(normalizeModelInput(FLARE, { outputFormat: "JPG" }).outputFormat).toBe("jpeg")
  })
})

describe("the format and the model", () => {
  it("a format the model does not write moves to its first, and says so", () => {
    const n = normalizeModelInput("gpt-image-2-6-economy-i2i", { outputFormat: "svg", svgLevel: "max" })
    expect(n.outputFormat).toBe("png")
    expect(n.svgLevel).toBeUndefined()
    expect(fields(n)).toEqual(["outputFormat"])
  })

  it("a model with no format setting drops it", () => {
    const n = normalizeModelInput("nano-banana-2", { outputFormat: "gif", gifFrames: 9 })
    expect(n.outputFormat).toBeUndefined()
    expect(n.gifFrames).toBeUndefined()
    expect(fields(n)).toEqual(["outputFormat"])
  })

  it("a GIF's and an SVG's levers are left out for any other format, saying nothing", () => {
    const n = normalizeModelInput(FLARE, { outputFormat: "png", gifFrames: 9, gifFrameDurationMs: 200, svgLevel: "max" })
    expect(n).toMatchObject({ outputFormat: "png", gifFrames: undefined, gifFrameDurationMs: undefined, svgLevel: undefined, adjustments: [] })
  })

  it("a text-to-image Economy GIF with references swaps to its edit sibling and becomes a PNG", () => {
    const n = resolveNormalizedImageGen({ provider: "gpt-image-2-6-economy", outputFormat: "gif", gifFrames: 9, refCount: 1, swapToI2i: true })
    expect(n.modelId).toBe("gpt-image-2-6-economy-i2i")
    expect(n.outputFormat).toBe("png")
    expect(n.identifier).toBe("gpt-image-2-6-economy-i2i")
  })
})

describe("the price follows the snapped levers", () => {
  it("a GIF's id is its band; the ratio and size it ignored do not price it", () => {
    const n = resolveNormalizedImageGen({ provider: FLARE, outputFormat: "gif", gifFrames: 14, quality: "low", resolution: "4K", aspectRatio: "16:9", refCount: 0 })
    expect(n.identifier).toBe("gpt-image-2-6-flare:low:gif-13-16")
    expect(n).toMatchObject({ gifFrames: 14, gifFrameDurationMs: 200, resolution: undefined, aspectRatio: "1:1" })
  })

  it("a GIF's frames off the range are priced where they land", () => {
    expect(resolveNormalizedImageGen({ provider: FLARE, outputFormat: "gif", gifFrames: 40, refCount: 0 }).identifier).toBe("gpt-image-2-6-flare:medium:gif-13-16")
  })

  it("an SVG edit is priced at its size, level and images", () => {
    expect(resolveNormalizedImageGen({ provider: FLARE, outputFormat: "svg", svgLevel: "max", resolution: "2K", refCount: 3, swapToI2i: true }).identifier)
      .toBe("gpt-image-2-6-flare-i2i:medium:2K:svg-max:3ref")
  })

  it("numeric strings from a form or a mapping are read as their numbers", () => {
    expect(imageFormatInputOf({ outputFormat: "gif", gifFrames: "12", gifFrameDurationMs: " 300 " })).toEqual({ outputFormat: "gif", gifFrames: 12, gifFrameDurationMs: 300, svgLevel: undefined })
    expect(resolveNormalizedImageGen({ provider: FLARE, outputFormat: "gif", gifFrames: "3", refCount: 0 }).identifier).toBe("gpt-image-2-6-flare:medium:gif-2-8")
  })

  it("the priced format reads a format in any case, as the snap does", () => {
    expect(gptImage26PricedFormat({ outputFormat: "GIF", gifFrames: 16 })).toEqual({ kind: "gif", band: "13-16" })
    expect(gptImage26PricedFormat({ outputFormat: "svg", svgLevel: "MAX" })).toEqual({ kind: "svg", level: "max" })
    expect(gptImage26PricedFormat({ outputFormat: "webp" })).toBeUndefined()
    expect(buildCreditModelIdentifier(FLARE, "medium", "1K", undefined, undefined, 0, { outputFormat: "Svg" })).toBe("gpt-image-2-6-flare:medium:1K:svg-standard")
  })
})
