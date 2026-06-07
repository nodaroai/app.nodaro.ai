import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { extractPalette } from "../palette.js"

/** Build a WxH image that is `redFrac` red and the rest blue. */
async function twoTone(redFrac: number): Promise<Buffer> {
  const w = 100, h = 100
  const redCols = Math.round(w * redFrac)
  const raw = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3
    if (x < redCols) { raw[i] = 220; raw[i + 1] = 20; raw[i + 2] = 20 }
    else { raw[i] = 20; raw[i + 1] = 20; raw[i + 2] = 220 }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
}

describe("extractPalette", () => {
  it("returns the requested number of swatches as #hex", async () => {
    const sw = await extractPalette(await twoTone(0.5), 5)
    expect(sw).toHaveLength(5)
    for (const s of sw) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/)
  })
  it("ranks the dominant color first (mostly-red image → red primary)", async () => {
    const [primary] = await extractPalette(await twoTone(0.8), 3)
    const r = parseInt(primary.hex.slice(1, 3), 16)
    const b = parseInt(primary.hex.slice(5, 7), 16)
    expect(r).toBeGreaterThan(b) // red channel dominates
  })
})
