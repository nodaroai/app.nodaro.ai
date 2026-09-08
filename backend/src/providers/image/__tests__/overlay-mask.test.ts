/**
 * The node's mask output: white where the chosen mode says "may change".
 * "around" is the ring an AI finish repaints (contact shadows, matching
 * light) while the placed elements stay pixel-exact by construction.
 */
import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { renderMask, type OverlayLayerParams } from "../overlay.js"

async function solid(w: number, h: number, rgba: { r: number; g: number; b: number; alpha: number }): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 4, background: rgba } }).png().toBuffer()
}
function layer(over: Partial<OverlayLayerParams>): OverlayLayerParams {
  return { anchor: "top-left", x: 0, y: 0, width: 25, opacity: 1, rotation: 0, blend: "over", fit: "contain", ...over }
}

describe("renderMask", () => {
  it("layers: white exactly where the layer is, black elsewhere, sized like the base", async () => {
    const base = await solid(200, 100, { r: 10, g: 20, b: 30, alpha: 1 })
    const red = await solid(10, 10, { r: 255, g: 0, b: 0, alpha: 1 })
    const mask = await renderMask(base, [{ buffer: red, layer: layer({ width: 25 }) }], "layers", 20) // 50×50 at top-left
    const { data, info } = await sharp(mask).raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height, info.channels]).toEqual([200, 100, 3])
    const px = (x: number, y: number) => data[(y * 200 + x) * 3]
    expect(px(0, 0)).toBe(255)
    expect(px(49, 49)).toBe(255)
    expect(px(60, 50)).toBe(0)
    expect(px(199, 99)).toBe(0)
  })

  it("around: a ring outside the layer, black on the layer itself and far away", async () => {
    const base = await solid(200, 100, { r: 0, g: 0, b: 0, alpha: 1 })
    const red = await solid(10, 10, { r: 255, g: 0, b: 0, alpha: 1 })
    const mask = await renderMask(base, [{ buffer: red, layer: layer({ anchor: "center", width: 20 }) }], "around", 16) // 40×40 centred at (100,50)
    const { data, info } = await sharp(mask).raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => data[(y * 200 + x) * info.channels]
    expect(px(100, 50)).toBe(0) // on the layer
    expect(px(124, 50)).toBe(255) // 4px outside its right edge: in the ring
    expect(px(190, 50)).toBe(0) // far away
  })

  it("outside: the complement of the layers", async () => {
    const base = await solid(100, 100, { r: 0, g: 0, b: 0, alpha: 1 })
    const red = await solid(10, 10, { r: 255, g: 0, b: 0, alpha: 1 })
    const mask = await renderMask(base, [{ buffer: red, layer: layer({ width: 50 }) }], "outside", 20)
    const { data, info } = await sharp(mask).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBe(0)
    expect(data[(99 * 100 + 99) * info.channels]).toBe(255)
  })
})
