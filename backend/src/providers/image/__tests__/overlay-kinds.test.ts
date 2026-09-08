/**
 * Generated layer kinds — text (fontkit → SVG paths → sharp), QR, shapes —
 * and the image effects, rendered on synthetic bases (no network).
 */
import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { renderOverlayLayers, resolveLayer, type OverlayLayerParams } from "../overlay.js"
import { renderTextLayer, overlayFontPath } from "../overlay-text.js"
import { renderQrLayer, renderShapeLayer } from "../overlay-shapes.js"
import { applyCircleMask, applyFeather, buildStroke } from "../overlay-effects.js"
import { DEFAULT_OVERLAY_TEXT, OVERLAY_FONTS, OVERLAY_SHAPES } from "@nodaro/shared"

async function solid(w: number, h: number, rgba: { r: number; g: number; b: number; alpha: number }): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 4, background: rgba } }).png().toBuffer()
}
async function raw(png: Buffer) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  return { data, info, px: (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 4)) }
}
function opaqueCount(data: Buffer, channels: number): number {
  let n = 0
  for (let i = channels - 1; i < data.length; i += channels) if (data[i] > 128) n++
  return n
}
function layer(over: Partial<OverlayLayerParams>): OverlayLayerParams {
  return { anchor: "center", x: 0, y: 0, width: 25, opacity: 1, rotation: 0, blend: "over", fit: "contain", ...over }
}

describe("bundled fonts", () => {
  it("every registered font file exists on disk", async () => {
    const { access } = await import("node:fs/promises")
    for (const f of OVERLAY_FONTS) await expect(access(overlayFontPath(f.id)!)).resolves.toBeUndefined()
  })
})

describe("renderTextLayer", () => {
  it("renders visible glyphs at a size proportional to the base height", async () => {
    const small = await renderTextLayer({ ...DEFAULT_OVERLAY_TEXT, text: "Nodaro" }, 500)
    const big = await renderTextLayer({ ...DEFAULT_OVERLAY_TEXT, text: "Nodaro" }, 1000)
    expect(big.width).toBeGreaterThan(small.width * 1.8)
    const { data, info } = await raw(small.png)
    expect(opaqueCount(data, info.channels)).toBeGreaterThan(100)
  })

  it("bold is wider than light on a variable font", async () => {
    const light = await renderTextLayer({ ...DEFAULT_OVERLAY_TEXT, text: "Weight", fontWeight: 200 }, 800)
    const bold = await renderTextLayer({ ...DEFAULT_OVERLAY_TEXT, text: "Weight", fontWeight: 900 }, 800)
    expect(bold.width).toBeGreaterThan(light.width)
  })

  it("Hebrew lays out right-to-left on a Hebrew-capable face and still produces glyphs", async () => {
    const r = await renderTextLayer({ ...DEFAULT_OVERLAY_TEXT, text: "שלום עולם", fontId: "rubik" }, 600)
    const { data, info } = await raw(r.png)
    expect(opaqueCount(data, info.channels)).toBeGreaterThan(100)
  })

  it("a background pill adds padding around the text", async () => {
    const plain = await renderTextLayer({ ...DEFAULT_OVERLAY_TEXT, text: "SALE" }, 600)
    const pill = await renderTextLayer({ ...DEFAULT_OVERLAY_TEXT, text: "SALE", background: { color: "#ff0073", opacity: 1, padding: 30, radius: 999 } }, 600)
    expect(pill.width).toBeGreaterThanOrEqual(plain.width + 60)
    expect(pill.height).toBeGreaterThanOrEqual(plain.height + 60)
  })
})

describe("renderQrLayer / renderShapeLayer", () => {
  it("a QR is square at the requested size with dark modules", async () => {
    const png = await renderQrLayer({ text: "https://nodaro.ai", color: "#000000", background: "#ffffff", margin: 1 }, 200)
    const { info, data } = await raw(png)
    expect([info.width, info.height]).toEqual([200, 200])
    let dark = 0
    for (let i = 0; i < data.length; i += info.channels) if (data[i] < 64 && data[i + 3] > 128) dark++
    expect(dark).toBeGreaterThan(2000)
  })

  it("a text sheet never rasterises past the layer edge cap — the font shrinks to fit instead (security review, 2026-09-08)", async () => {
    const twentyLines = Array.from({ length: 20 }, () => "WWWWWWWWWWWWWWWWWWWW").join("\n")
    const out = await renderTextLayer({ ...DEFAULT_OVERLAY_TEXT, text: twentyLines, fontSize: 50, lineHeight: 2.5 }, 8192)
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(8192)
    const meta = await sharp(out.png).metadata()
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(8192)
  }, 60_000)

  it("a circle shape is transparent in the corners and filled in the centre", async () => {
    const png = await renderShapeLayer({ shape: "circle", color: "#ff0073" }, 100, 100)
    const { px } = await raw(png)
    expect(px(50, 50).slice(0, 3)).toEqual([255, 0, 115])
    expect(px(1, 1)[3]).toBe(0)
  })

  it("every shape in the vocabulary renders at the box size, filled at the centre, corner clear unless it is a full box", async () => {
    for (const shape of OVERLAY_SHAPES) {
      const png = await renderShapeLayer({ shape, color: "#ff0073", stroke: { width: 4, color: "#000000" } }, 120, 80)
      const { info, px } = await raw(png)
      expect([shape, info.width, info.height]).toEqual([shape, 120, 80])
      expect([shape, px(60, 40).slice(0, 3)]).toEqual([shape, [255, 0, 115]])
      const cornerClear = px(1, 1)[3] === 0
      expect([shape, cornerClear]).toEqual([shape, shape !== "rect" && shape !== "ribbon"])
    }
  })
})

describe("image effects", () => {
  it("circle mask clears the corners", async () => {
    const png = await applyCircleMask(await solid(64, 64, { r: 255, g: 0, b: 0, alpha: 1 }))
    const { px } = await raw(png)
    expect(px(1, 1)[3]).toBe(0)
    expect(px(32, 32)[3]).toBe(255)
  })

  it("feather fades the edge but keeps the centre opaque", async () => {
    const png = await applyFeather(await solid(64, 64, { r: 255, g: 0, b: 0, alpha: 1 }), 12)
    const { px } = await raw(png)
    expect(px(32, 32)[3]).toBe(255)
    expect(px(0, 32)[3]).toBeLessThan(80)
  })

  it("stroke builds a coloured band around the silhouette, padded by the width", async () => {
    const src = await solid(40, 40, { r: 255, g: 0, b: 0, alpha: 1 })
    const { png, pad } = await buildStroke(src, 6, "#00ff00")
    const { info, px } = await raw(png)
    expect(pad).toBe(6)
    expect(info.width).toBe(40 + 2 * pad)
    // Just outside the original silhouette: green and opaque.
    expect(px(pad - 2, 20).slice(0, 3)).toEqual([0, 255, 0])
    expect(px(pad - 2, 20)[3]).toBeGreaterThan(128)
  })
})

describe("renderOverlayLayers — generated kinds through the shared placement", () => {
  it("a text layer needs no buffer and lands on the base", async () => {
    const base = await solid(400, 200, { r: 0, g: 0, b: 40, alpha: 1 })
    const out = await renderOverlayLayers(base, [
      { layer: layer({ kind: "text", anchor: "top-left", text: { ...DEFAULT_OVERLAY_TEXT, text: "HELLO", color: "#ffffff", fontSize: 30 } }) },
    ])
    const { data, info } = await raw(out)
    let white = 0
    for (let i = 0; i < data.length; i += info.channels) if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) white++
    expect(white).toBeGreaterThan(500)
  })

  it("a shape layer honours width × height, a QR is square", async () => {
    const base = await solid(400, 400, { r: 0, g: 0, b: 0, alpha: 1 })
    const out = await renderOverlayLayers(base, [
      { layer: layer({ kind: "shape", anchor: "top-left", width: 50, height: 10, shape: { shape: "rect", color: "#ff0073" } }) },
      { layer: layer({ kind: "qr", anchor: "bottom-right", width: 25, qr: { text: "x", color: "#ffffff", margin: 0 } }) },
    ])
    const { px } = await raw(out)
    expect(px(10, 10).slice(0, 3)).toEqual([255, 0, 115])
    expect(px(10, 60).slice(0, 3)).toEqual([0, 0, 0])
  })

  it("resolveLayer refuses a text layer without a text style instead of skipping it", () => {
    expect(() => resolveLayer({ kind: "text" } as never)).toThrow(/text/)
  })
})
