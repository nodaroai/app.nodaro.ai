import { describe, it, expect } from "vitest"
import sharp from "sharp"

describe("font smoke: SVG text rasterizes to visible pixels", () => {
  it("white text on black produces non-black pixels", async () => {
    const w = 300, h = 80
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${w}" height="${h}" fill="#000000"/>` +
      `<text x="12" y="50" font-family="DejaVu Sans, sans-serif" font-size="40" fill="#ffffff">SHEET</text></svg>`
    const { data, info } = await sharp(Buffer.from(svg)).raw().toBuffer({ resolveWithObject: true })
    let lit = 0
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) lit++
    }
    // If fonts are missing, librsvg renders no glyphs → lit === 0.
    expect(lit).toBeGreaterThan(50)
  })
})
