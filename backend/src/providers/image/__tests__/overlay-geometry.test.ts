import { describe, it, expect } from "vitest"
import sharp from "sharp"
import {
  resolveOverlayGeometry,
  resolveCanvasPlacement,
  clipToBase,
  resolveLayer,
  resolveCanvas,
  orientedSize,
  overlayRenderOrder,
  renderOverlayLayers,
  type OverlayLayerParams,
} from "../overlay.js"

const BASE = { w: 2000, h: 1000 }

function layer(over: Partial<OverlayLayerParams> = {}): OverlayLayerParams {
  return {
    imageUrl: "https://example.test/logo.png",
    anchor: "center",
    x: 0,
    y: 0,
    width: 25,
    opacity: 1,
    rotation: 0,
    blend: "over",
    fit: "contain",
    ...over,
  }
}

describe("resolveOverlayGeometry — size", () => {
  it("width is a percentage of the BASE width and height follows the layer aspect", () => {
    const g = resolveOverlayGeometry(BASE, layer({ width: 25 }), 2) // 2:1 logo
    expect(g.width).toBe(500)
    expect(g.height).toBe(250)
  })

  it("an explicit height overrides the aspect (percentage of the BASE height)", () => {
    const g = resolveOverlayGeometry(BASE, layer({ width: 25, height: 50 }), 2)
    expect(g.width).toBe(500)
    expect(g.height).toBe(500)
  })

  it("percentages are what make the same node work on a 1K preview and a 4K render", () => {
    const small = resolveOverlayGeometry({ w: 1000, h: 500 }, layer({ width: 10, anchor: "bottom-right", x: -5, y: -10 }), 1)
    const big = resolveOverlayGeometry({ w: 4000, h: 2000 }, layer({ width: 10, anchor: "bottom-right", x: -5, y: -10 }), 1)
    expect(big.width).toBe(small.width * 4)
    expect(big.left).toBe(small.left * 4)
    expect(big.top).toBe(small.top * 4)
  })
})

describe("resolveOverlayGeometry — anchors", () => {
  it("center anchor centres the box on the base", () => {
    const g = resolveOverlayGeometry(BASE, layer({ width: 10 }), 1) // 200x200
    expect(g.left).toBe(900)
    expect(g.top).toBe(400)
  })

  it("top-left anchor with zero offsets sits flush in the corner", () => {
    const g = resolveOverlayGeometry(BASE, layer({ anchor: "top-left", width: 10 }), 1)
    expect(g.left).toBe(0)
    expect(g.top).toBe(0)
  })

  it("bottom-right anchor with zero offsets sits flush in the opposite corner", () => {
    const g = resolveOverlayGeometry(BASE, layer({ anchor: "bottom-right", width: 10 }), 1)
    expect(g.left).toBe(1800)
    expect(g.top).toBe(800)
  })

  it("on a right/bottom anchor a NEGATIVE offset moves the layer inward (the watermark case)", () => {
    const g = resolveOverlayGeometry(BASE, layer({ anchor: "bottom-right", width: 10, x: -4, y: -6 }), 1)
    expect(g.left).toBe(1800 - 80)
    expect(g.top).toBe(800 - 60)
  })

  it("edge anchors centre along the other axis", () => {
    const right = resolveOverlayGeometry(BASE, layer({ anchor: "right", width: 10 }), 1)
    expect(right.left).toBe(1800)
    expect(right.top).toBe(400)
    const top = resolveOverlayGeometry(BASE, layer({ anchor: "top", width: 10 }), 1)
    expect(top.left).toBe(900)
    expect(top.top).toBe(0)
  })

  it("a very tall or wide layer is shrunk proportionally so the box never exceeds the raster cap (geometry and bitmap agree)", () => {
    // 25% of 2000 = 500 wide; at aspect 0.02 the natural height is 25000 → shrink to 8192 tall.
    const g = resolveOverlayGeometry(BASE, layer({ width: 25 }), 0.02)
    expect(g.height).toBe(8192)
    expect(g.width).toBe(Math.round(500 * (8192 / 25000)))
  })

  it("rounds to whole pixels (sharp rejects fractional offsets)", () => {
    const g = resolveOverlayGeometry({ w: 1001, h: 333 }, layer({ width: 33.3, x: 1.7, y: 2.2 }), 1.37)
    for (const v of [g.left, g.top, g.width, g.height]) expect(Number.isInteger(v)).toBe(true)
    expect(g.width).toBeGreaterThan(0)
    expect(g.height).toBeGreaterThan(0)
  })
})

describe("clipToBase — sharp only composites layers that fit INSIDE the base", () => {
  it("a fully inside box is untouched", () => {
    const c = clipToBase({ left: 100, top: 50, width: 300, height: 200 }, BASE)
    expect(c).toEqual({ left: 100, top: 50, cropLeft: 0, cropTop: 0, cropWidth: 300, cropHeight: 200 })
  })

  it("a box hanging off the left/top edge is cropped and pinned to 0", () => {
    const c = clipToBase({ left: -100, top: -20, width: 300, height: 200 }, BASE)
    expect(c).toEqual({ left: 0, top: 0, cropLeft: 100, cropTop: 20, cropWidth: 200, cropHeight: 180 })
  })

  it("a box hanging off the right/bottom edge keeps its origin and loses the overflow", () => {
    const c = clipToBase({ left: 1900, top: 900, width: 300, height: 200 }, BASE)
    expect(c).toEqual({ left: 1900, top: 900, cropLeft: 0, cropTop: 0, cropWidth: 100, cropHeight: 100 })
  })

  it("a box entirely outside the base yields null (skip the layer, do not throw)", () => {
    expect(clipToBase({ left: 2500, top: 0, width: 300, height: 200 }, BASE)).toBeNull()
    expect(clipToBase({ left: -400, top: 0, width: 300, height: 200 }, BASE)).toBeNull()
  })
})

describe("resolveCanvasPlacement — optional output canvas", () => {
  it("no canvas → the base is the canvas", () => {
    expect(resolveCanvasPlacement(BASE, undefined, "contain")).toEqual({ w: 2000, h: 1000, left: 0, top: 0, baseW: 2000, baseH: 1000 })
  })

  it("contain letterboxes the base inside the canvas, centred", () => {
    const p = resolveCanvasPlacement(BASE, { width: 1000, height: 1000, backgroundColor: "#000000" }, "contain")
    expect(p).toEqual({ w: 1000, h: 1000, left: 0, top: 250, baseW: 1000, baseH: 500 })
  })

  it("cover fills the canvas and centres the overflow", () => {
    const p = resolveCanvasPlacement(BASE, { width: 1000, height: 1000, backgroundColor: "#000000" }, "cover")
    expect(p).toEqual({ w: 1000, h: 1000, left: -500, top: 0, baseW: 2000, baseH: 1000 })
  })
})

describe("resolveLayer — the malformed-job-row tolerance the collage provider also has", () => {
  it("fills defaults and clamps out-of-range numbers instead of throwing", () => {
    const l = resolveLayer({ imageUrl: "https://example.test/a.png", width: 500, opacity: 7, rotation: 720, x: -900 } as unknown as OverlayLayerParams)
    expect(l.width).toBe(100)
    expect(l.opacity).toBe(1)
    expect(l.rotation).toBe(180)
    expect(l.x).toBe(-100)
    expect(l.anchor).toBe("center")
    expect(l.blend).toBe("over")
    expect(l.fit).toBe("contain")
  })
})

describe("resolveCanvas — the malformed-job-row tolerance for the optional canvas", () => {
  it("fills a missing colour and clamps non-numbers instead of throwing", () => {
    expect(resolveCanvas({ width: 1080, height: 1080 } as never)).toEqual({ width: 1080, height: 1080, backgroundColor: "#000000" })
    expect(resolveCanvas({ width: Number.NaN, height: 99999, backgroundColor: "ff0073" } as never)).toEqual({ width: 1024, height: 8192, backgroundColor: "#ff0073" })
    expect(resolveCanvas(undefined)).toBeUndefined()
    expect(resolveCanvas("nope" as never)).toBeUndefined()
  })
})

describe("overlayRenderOrder — zIndex reorders the stack, ties keep wire order", () => {
  it("matches the canvas twin", () => {
    expect(overlayRenderOrder([{}, {}, {}])).toEqual([0, 1, 2])
    expect(overlayRenderOrder([{ zIndex: 5 }, {}, { zIndex: 0 }])).toEqual([2, 1, 0])
  })

  it("a layer with a higher zIndex draws OVER a later handle", async () => {
    const base = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()
    const red = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()
    const green = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } }).png().toBuffer()
    const out = await renderOverlayLayers(base, [
      { buffer: red, layer: layer({ anchor: "top-left", width: 50, zIndex: 9 }) },
      { buffer: green, layer: layer({ anchor: "top-left", width: 50 }) },
    ])
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    expect(Array.from(data.subarray(0, 3))).toEqual([255, 0, 0])
  })
})

describe("EXIF orientation — geometry must use the AUTO-ORIENTED size", () => {
  async function rotatedJpeg(w: number, h: number): Promise<Buffer> {
    // Stored w×h, tagged orientation 6 (90° CW) → renders h×w.
    return sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
  }

  it("orientedSize reports the rendered size, not the stored one", async () => {
    const buf = await rotatedJpeg(40, 20)
    expect(await orientedSize(buf)).toEqual({ w: 20, h: 40 })
  })

  it("a portrait phone photo composites at its rendered size and a wide layer lands inside it", async () => {
    const base = await rotatedJpeg(40, 20) // renders 20×40
    const red = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()
    // 80% of the RENDERED width (16px). Against the stored width this would be
    // 32px — wider than the 20px output — and sharp's composite throws.
    const out = await renderOverlayLayers(base, [{ buffer: red, layer: layer({ anchor: "top-left", width: 80 }) }])
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([20, 40])
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3))
    expect(px(0, 0)).toEqual([255, 0, 0])
    expect(px(15, 15)).toEqual([255, 0, 0])
    expect(px(17, 17)[2]).toBeGreaterThan(200) // past the 16px layer: the blue base
  })
})

describe("renderOverlayLayers — golden pixels on synthetic images (no network)", () => {
  async function solid(w: number, h: number, rgba: { r: number; g: number; b: number; alpha: number }): Promise<Buffer> {
    return sharp({ create: { width: w, height: h, channels: 4, background: rgba } }).png().toBuffer()
  }

  it("places an opaque overlay at the resolved box and leaves the rest of the base untouched", async () => {
    const base = await solid(64, 64, { r: 0, g: 0, b: 255, alpha: 1 })
    const red = await solid(10, 10, { r: 255, g: 0, b: 0, alpha: 1 })
    const out = await renderOverlayLayers(base, [{ buffer: red, layer: layer({ anchor: "top-left", width: 25, x: 0, y: 0 }) }])
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(64)
    expect(info.height).toBe(64)
    const px = (x: number, y: number) => Array.from(data.subarray((y * 64 + x) * info.channels, (y * 64 + x) * info.channels + 3))
    expect(px(0, 0)).toEqual([255, 0, 0]) // inside the 16x16 overlay
    expect(px(15, 15)).toEqual([255, 0, 0])
    expect(px(16, 16)).toEqual([0, 0, 255]) // first pixel past it
    expect(px(63, 63)).toEqual([0, 0, 255])
  })

  it("opacity 0.5 blends the overlay halfway (±2)", async () => {
    const base = await solid(32, 32, { r: 0, g: 0, b: 0, alpha: 1 })
    const white = await solid(8, 8, { r: 255, g: 255, b: 255, alpha: 1 })
    const out = await renderOverlayLayers(base, [{ buffer: white, layer: layer({ anchor: "top-left", width: 50, opacity: 0.5 }) }])
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    const v = data[(2 * 32 + 2) * info.channels]
    expect(Math.abs(v - 128)).toBeLessThanOrEqual(2)
  })

  it("a layer placed completely outside the base is skipped, not an error", async () => {
    const base = await solid(32, 32, { r: 0, g: 0, b: 0, alpha: 1 })
    const red = await solid(8, 8, { r: 255, g: 0, b: 0, alpha: 1 })
    const out = await renderOverlayLayers(base, [{ buffer: red, layer: layer({ anchor: "top-left", width: 25, x: 200, y: 0 }) }])
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    expect(Array.from(data.subarray(0, 3))).toEqual([0, 0, 0])
  })

  it("an SVG overlay is rasterised at the TARGET size, not at its intrinsic 128px (crisp logos)", async () => {
    const base = await solid(2000, 1000, { r: 0, g: 0, b: 0, alpha: 1 })
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><rect width="128" height="128" fill="#ff0073"/></svg>')
    const out = await renderOverlayLayers(base, [{ buffer: svg, layer: layer({ anchor: "top-left", width: 40 }) }])
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    // 40% of 2000 = 800px wide, 800px tall (square svg). Pixel (799, 799) is magenta, (800, 800) is black.
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3))
    expect(px(799, 799)).toEqual([255, 0, 115])
    expect(px(800, 800)).toEqual([0, 0, 0])
  })
})
