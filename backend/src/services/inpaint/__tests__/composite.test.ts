import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { compositeMaskedRegion, maskBoundingBox } from "../composite.js"

async function solid(r: number, g: number, b: number) {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r, g, b } } }).png().toBuffer()
}
// mask: left 2 columns white (edit), right 2 columns black (keep)
async function leftHalfMask() {
  const raw = Buffer.alloc(4 * 4) // 1 channel, 4x4
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) raw[y * 4 + x] = x < 2 ? 255 : 0
  return sharp(raw, { raw: { width: 4, height: 4, channels: 1 } }).png().toBuffer()
}

describe("compositeMaskedRegion", () => {
  it("keeps base where mask is black and shows result where mask is white", async () => {
    const base = await solid(255, 0, 0)   // red
    const result = await solid(0, 0, 255)  // blue
    const mask = await leftHalfMask()
    const out = await compositeMaskedRegion({ base, result, mask, featherSigma: 0 })
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels
      return [data[i], data[i + 1], data[i + 2]]
    }
    expect(px(0, 0)).toEqual([0, 0, 255])   // left → blue (edited)
    expect(px(3, 0)).toEqual([255, 0, 0])   // right → red (preserved)
  })
})

describe("maskBoundingBox", () => {
  it("returns the tight box of white pixels", async () => {
    const mask = await leftHalfMask()
    const box = await maskBoundingBox(mask)
    expect(box).toEqual({ x: 0, y: 0, width: 2, height: 4 })
  })
  it("returns null for an all-black mask", async () => {
    // sharp 0.34's `create` rejects a solid-background single-channel image
    // (channels must be 3-4 with a flat background); build the all-black
    // 1-channel mask via the same raw path as leftHalfMask instead.
    const raw = Buffer.alloc(4 * 4) // 1 channel, 4x4, all zeros = black
    const black = await sharp(raw, { raw: { width: 4, height: 4, channels: 1 } }).png().toBuffer()
    expect(await maskBoundingBox(black)).toBeNull()
  })
})
