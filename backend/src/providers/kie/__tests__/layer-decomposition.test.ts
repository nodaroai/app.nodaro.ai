import { describe, it, expect, vi } from "vitest"

vi.mock("../client.js", () => ({
  createKieTask: vi.fn(),
  pollKieTask: vi.fn(),
  createSanitizedError: (msg: string) => new Error(msg),
}))

import { layerDecompositionInput, parseLayerDecompositionResult } from "../layer-decomposition.js"

/** The documented result (the docs' callback example), with the base first and three layers. */
const DOC_RESULT = {
  resultObject: {
    layers_data: [
      { z_index: 0, size: "1024x1536", output_format: "png", url: "https://tf/base.png" },
      { z_index: 1, size: "1321x265", output_format: "png", bounding_box: { absolute: [82, 1239, 944, 1412], normalized: [80, 807, 921, 919] }, name: "Bottom caption text", description: "The bottom caption.", url: "https://tf/l1.png" },
      { z_index: 2, size: "821x720", output_format: "png", bounding_box: { absolute: [228, 482, 897, 1070], normalized: [223, 314, 875, 696] }, name: "Arctic fox", description: "The fox.", url: "https://tf/l2.png" },
      { z_index: 3, size: "1314x373", output_format: "png", bounding_box: { absolute: [74, 51, 950, 300], normalized: [72, 33, 927, 195] }, name: "Top header text", description: "The header.", url: "https://tf/l3.png" },
    ],
  },
  resultUrls: ["https://tf/base.png", "https://tf/l1.png", "https://tf/l2.png", "https://tf/l3.png"],
}

describe("layer decomposition — the request", () => {
  it("image, size and the image cap; the description only when there is one; no output_format, text_recognition or content filter", () => {
    expect(layerDecompositionInput({ imageUrl: "https://in.png", maxImages: 10, size: "1K" })).toEqual({ image_url: "https://in.png", size: "1K", max_images: 10 })
    expect(layerDecompositionInput({ imageUrl: "https://in.png", maxImages: 4, size: "auto", prompt: "the fox" })).toEqual({ image_url: "https://in.png", size: "auto", max_images: 4, prompt: "the fox" })
  })
})

describe("layer decomposition — the result", () => {
  it("the base at z_index 0, each layer with its own file, name, size and boxes, bottom to top", () => {
    const r = parseLayerDecompositionResult(DOC_RESULT, "t1")
    expect(r.baseUrl).toBe("https://tf/base.png")
    expect([r.baseWidth, r.baseHeight]).toEqual([1024, 1536])
    expect(r.layers.map((l) => [l.zIndex, l.name, l.url])).toEqual([[1, "Bottom caption text", "https://tf/l1.png"], [2, "Arctic fox", "https://tf/l2.png"], [3, "Top header text", "https://tf/l3.png"]])
    expect(r.layers[1]).toEqual({ url: "https://tf/l2.png", zIndex: 2, name: "Arctic fox", description: "The fox.", width: 821, height: 720, box: { x1: 228, y1: 482, x2: 897, y2: 1070 }, boxNormalized: { x1: 223, y1: 314, x2: 875, y2: 696 } })
  })

  it("matches each layer to its file by URL, never by position, and orders by z_index", () => {
    const shuffled = { ...DOC_RESULT, resultUrls: ["https://tf/base.png", "https://tf/l3.png", "https://tf/l1.png", "https://tf/l2.png"], resultObject: { layers_data: [...DOC_RESULT.resultObject.layers_data].reverse() } }
    const r = parseLayerDecompositionResult(shuffled, "t1")
    expect(r.baseUrl).toBe("https://tf/base.png")
    expect(r.layers.map((l) => l.name)).toEqual(["Bottom caption text", "Arctic fox", "Top header text"])
  })

  it("a file no entry describes is still a layer, after the described ones; a repeated URL counts once", () => {
    const extra = { ...DOC_RESULT, resultUrls: [...DOC_RESULT.resultUrls, "https://tf/l4.png", "https://tf/l1.png"] }
    const r = parseLayerDecompositionResult(extra, "t1")
    expect(r.layers.map((l) => [l.zIndex, l.url])).toEqual([[1, "https://tf/l1.png"], [2, "https://tf/l2.png"], [3, "https://tf/l3.png"], [4, "https://tf/l4.png"]])
    expect(r.layers[3]).toEqual({ url: "https://tf/l4.png", zIndex: 4 })
  })

  it("a base-only result has no layers; with no base it fails, never an empty success", () => {
    const baseOnly = { resultObject: { layers_data: [DOC_RESULT.resultObject.layers_data[0]] }, resultUrls: ["https://tf/base.png"] }
    expect(parseLayerDecompositionResult(baseOnly, "t1").layers).toEqual([])
    // No layers_data at all: the first URL is the base.
    expect(parseLayerDecompositionResult({ resultUrls: ["https://tf/b.png", "https://tf/x.png"] }, "t1")).toMatchObject({ baseUrl: "https://tf/b.png", layers: [{ url: "https://tf/x.png", zIndex: 1 }] })
    expect(() => parseLayerDecompositionResult({ resultObject: { layers_data: [] }, resultUrls: [] }, "t1")).toThrow(/no base image/)
    expect(() => parseLayerDecompositionResult(null, "t1")).toThrow(/no base image/)
  })

  it("junk fields are dropped, not guessed", () => {
    const junk = { resultObject: { layers_data: [{ z_index: 0, url: "https://tf/b.png", size: "big" }, { z_index: 1, url: "https://tf/l.png", size: "12x", bounding_box: { absolute: [1, 2, 3], normalized: "x" }, name: "  ", description: 4 }] } }
    const r = parseLayerDecompositionResult(junk, "t1")
    expect(r.baseWidth).toBeUndefined()
    expect(r.layers).toEqual([{ url: "https://tf/l.png", zIndex: 1 }])
  })
})
