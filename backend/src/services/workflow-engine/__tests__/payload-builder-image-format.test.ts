/**
 * GPT Image 2.6's output formats in a workflow run: the Generate Image, Image
 * to Image and Modify Image nodes send the same snapped levers and price the
 * same id as the routes, and a mask with a GIF or an SVG fails the node before
 * anything is reserved, as the routes refuse it.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"
import { MASK_WITH_FORMAT_MESSAGE } from "../../../lib/image-format-schema.js"

const SRC = "https://media.nodaro.ai/src.png"
const MASK = "https://media.nodaro.ai/mask.png"
const node = (type: string, data: Record<string, unknown>): SimpleNode => ({ id: "n1", type, data })

describe("a GIF or an SVG from a workflow node", () => {
  it("Generate Image: a GIF's frames and speed ride the payload, its ratio and size do not, priced on its band", () => {
    const r = buildPayload(node("generate-image", { prompt: "a flag", provider: "gpt-image-2-6-flare", aspectRatio: "16:9", resolution: "4K", quality: "low", outputFormat: "gif", gifFrames: 3, gifFrameDurationMs: 90 }), "j", {}, "u")
    expect(r.payload).toMatchObject({ outputFormat: "gif", gifFrames: 3, gifFrameDurationMs: 90, aspectRatio: "1:1", resolution: undefined, quality: "low" })
    expect(r.modelIdentifier).toBe("gpt-image-2-6-flare:low:gif-2-8")
  })

  it("Generate Image: a numeric string from a FieldMapping is read as its number", () => {
    const r = buildPayload(node("generate-image", { prompt: "a flag", provider: "gpt-image-2-6-flare", outputFormat: "gif", gifFrames: "15" }), "j", {}, "u")
    expect(r.payload.gifFrames).toBe(15)
    expect(r.modelIdentifier).toBe("gpt-image-2-6-flare:medium:gif-13-16")
  })

  it("Generate Image with references: an SVG edit is priced at its size, level and images", () => {
    const r = buildPayload(node("generate-image", { prompt: "a leaf", provider: "gpt-image-2-6-sunburst", resolution: "2K", outputFormat: "svg", svgLevel: "detailed", baseImageUrl: SRC }), "j", {}, "u")
    expect(r.payload).toMatchObject({ outputFormat: "svg", svgLevel: "detailed" })
    expect(r.modelIdentifier).toBe("gpt-image-2-6-sunburst-i2i:medium:2K:svg-detailed:1ref")
  })

  it("Image to Image: a GIF edit, priced on its band and its source", () => {
    const r = buildPayload(node("image-to-image", { prompt: "wave", provider: "gpt-image-2-6-flare-i2i", outputFormat: "gif" }), "j", { imageUrl: SRC }, "u")
    expect(r.payload).toMatchObject({ outputFormat: "gif", gifFrames: 9, gifFrameDurationMs: 200 })
    expect(r.modelIdentifier).toBe("gpt-image-2-6-flare-i2i:medium:gif-9-12:1ref")
  })

  it("Modify Image: an SVG, with the transparent background a vector does not take moved to auto", () => {
    const r = buildPayload(node("modify-image", { prompt: "a logo", provider: "gpt-image-2-6-flare-i2i", outputFormat: "svg", svgLevel: "max", background: "transparent" }), "j", { imageUrl: SRC }, "u")
    expect(r.payload).toMatchObject({ outputFormat: "svg", svgLevel: "max", background: "auto" })
    expect(r.modelIdentifier).toBe("gpt-image-2-6-flare-i2i:medium:1K:svg-max:1ref")
  })

  it("a format the model does not write is left out; a PNG node sends nothing new", () => {
    const other = buildPayload(node("generate-image", { prompt: "a", provider: "nano-banana-2", outputFormat: "gif", gifFrames: 9 }), "j", {}, "u")
    expect(other.payload.outputFormat).toBeUndefined()
    expect(other.payload.gifFrames).toBeUndefined()
    const png = buildPayload(node("generate-image", { prompt: "a", provider: "gpt-image-2-6-flare", gifFrames: 9, svgLevel: "max" }), "j", {}, "u")
    expect([png.payload.outputFormat, png.payload.gifFrames, png.payload.svgLevel]).toEqual([undefined, undefined, undefined])
    expect(png.modelIdentifier).toBe("gpt-image-2-6-flare:medium:1K")
  })

  it.each([
    ["generate-image", { baseImageUrl: SRC, maskUrl: MASK }, {}],
    ["image-to-image", { maskUrl: MASK }, { imageUrl: SRC }],
    ["modify-image", {}, { imageUrl: SRC, maskUrl: MASK }],
  ] as const)("%s with a mask and a GIF or an SVG fails before anything is reserved", (type, data, inputs) => {
    const provider = type === "generate-image" ? "gpt-image-2-6-flare" : "gpt-image-2-6-flare-i2i"
    for (const outputFormat of ["gif", "svg"]) {
      expect(() => buildPayload(node(type, { prompt: "a", provider, outputFormat, ...data }), "j", inputs, "u")).toThrow(MASK_WITH_FORMAT_MESSAGE)
    }
  })
})
