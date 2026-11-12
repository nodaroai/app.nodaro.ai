import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { compositeMaskedRegion, maskBoundingBox, maskFeatherSigma } from "../composite.js"
import { sniffImageFormat } from "../../../lib/image-output-store.js"

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

// The paste-back of a model that redraws the whole picture around a mask
// (GPT Image 2.6): everything the mask leaves black is the source's own.
describe("compositeMaskedRegion: the source pasted back outside the mask", () => {
  const N = 64
  const EDGE = { from: 16, to: 48 } // the white square, [from, to)
  const inSquare = (x: number, y: number) => x >= EDGE.from && x < EDGE.to && y >= EDGE.from && y < EDGE.to

  /** A busy source, so "equal" means every pixel, not one flat colour. */
  async function noisySource(channels: 3 | 4 = 3, alpha = 255) {
    const raw = Buffer.alloc(N * N * channels)
    for (let i = 0; i < N * N; i++) {
      raw[i * channels] = (i * 37) % 256
      raw[i * channels + 1] = (i * 91 + 13) % 256
      raw[i * channels + 2] = (i * 53 + 101) % 256
      if (channels === 4) raw[i * channels + 3] = alpha
    }
    return sharp(raw, { raw: { width: N, height: N, channels } }).png().toBuffer()
  }
  async function squareMask(size = N, value = 255) {
    const raw = Buffer.alloc(size * size)
    const k = size / N
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) raw[y * size + x] = inSquare(Math.floor(x / k), Math.floor(y / k)) ? value : 0
    return sharp(raw, { raw: { width: size, height: size, channels: 1 } }).png().toBuffer()
  }
  const green = (size: number) => sharp({ create: { width: size, height: size, channels: 3, background: { r: 0, g: 255, b: 0 } } }).png().toBuffer()
  async function pixels(png: Buffer) {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    return { info, at: (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x + 1) * info.channels)] }
  }

  it("keeps every pixel outside the mask the source's own, even right next to the edge", async () => {
    const base = await noisySource()
    const out = await compositeMaskedRegion({ base, result: await green(N), mask: await squareMask(), featherSigma: 2, featherInward: true })
    const src = await pixels(base)
    const got = await pixels(out)
    let checked = 0
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (inSquare(x, y)) continue
      expect(got.at(x, y)).toEqual(src.at(x, y))
      checked++
    }
    expect(checked).toBe(N * N - 32 * 32)
  })

  it("shows the result well inside the mask and feathers the edge inside it", async () => {
    const base = await noisySource()
    const out = await compositeMaskedRegion({ base, result: await green(N), mask: await squareMask(), featherSigma: 2, featherInward: true })
    const got = await pixels(out)
    const src = await pixels(base)
    for (let y = 24; y < 40; y++) for (let x = 24; x < 40; x++) expect(got.at(x, y)).toEqual([0, 255, 0])
    // On the edge, inside: between the two, neither the source nor the result.
    const edge = got.at(EDGE.from, 32)
    expect(edge).not.toEqual([0, 255, 0])
    expect(edge).not.toEqual(src.at(EDGE.from, 32))
  })

  it("the soft edge rises from the edge inward and is a few pixels wide", async () => {
    const black = await sharp({ create: { width: N, height: N, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer()
    const white = await sharp({ create: { width: N, height: N, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer()
    const out = await compositeMaskedRegion({ base: black, result: white, mask: await squareMask(), featherSigma: 2, featherInward: true })
    const got = await pixels(out)
    const row = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24].map((x) => got.at(x, 32)[0]!)
    expect(row.slice(0, 2)).toEqual([0, 0]) // outside: the source
    expect(row[2]).toBeGreaterThan(0) // the first pixel inside is already some of the result
    expect(row[2]).toBeLessThan(128)
    for (let i = 3; i < row.length; i++) expect(row[i]).toBeGreaterThanOrEqual(row[i - 1]!)
    expect(row[row.length - 1]).toBe(255) // four sigmas in: the result
  })

  it("the centred feather (the Generate Image inpaint) does reach outside the mask", async () => {
    const base = await noisySource()
    const out = await compositeMaskedRegion({ base, result: await green(N), mask: await squareMask(), featherSigma: 2 })
    const got = await pixels(out)
    const src = await pixels(base)
    expect(got.at(EDGE.from - 1, 32)).not.toEqual(src.at(EDGE.from - 1, 32))
  })

  it("maps a grey mask proportionally", async () => {
    const base = await sharp({ create: { width: N, height: N, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer()
    const white = await sharp({ create: { width: N, height: N, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer()
    const out = await compositeMaskedRegion({ base, result: white, mask: await squareMask(N, 128), featherSigma: 2, featherInward: true })
    const v = (await pixels(out)).at(32, 32)[0]!
    expect(v).toBeGreaterThanOrEqual(127)
    expect(v).toBeLessThanOrEqual(129)
  })

  it("resizes a result of another size to the source, and the mask with it", async () => {
    const base = await noisySource()
    const out = await compositeMaskedRegion({ base, result: await green(N * 2), mask: await squareMask(N / 2), featherSigma: 2, featherInward: true })
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([N, N])
    const got = await pixels(out)
    const src = await pixels(base)
    expect(got.at(32, 32)).toEqual([0, 255, 0])
    expect(got.at(2, 2)).toEqual(src.at(2, 2))
  })

  it("keeps the source's transparency outside the mask and the result's inside it", async () => {
    const base = await noisySource(4, 100)
    const clear = await sharp({ create: { width: N, height: N, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    const out = await compositeMaskedRegion({ base, result: clear, mask: await squareMask(), featherSigma: 2, featherInward: true, keepAlpha: true })
    const got = await pixels(out)
    const src = await pixels(base)
    expect(got.info.channels).toBe(4)
    expect(got.at(2, 2)).toEqual(src.at(2, 2))
    expect(got.at(EDGE.from - 1, 32)).toEqual(src.at(EDGE.from - 1, 32))
    expect(got.at(32, 32)[3]).toBe(0)
  })

  it("stays opaque when neither picture has transparency", async () => {
    const out = await compositeMaskedRegion({ base: await noisySource(), result: await green(N), mask: await squareMask(), featherSigma: 2, featherInward: true, keepAlpha: true })
    expect((await sharp(out).metadata()).hasAlpha).toBe(false)
  })

  /** Green, its left half (x < 32) fully transparent: a model that left part of the mask unpainted. */
  async function halfClearGreen() {
    const raw = Buffer.alloc(N * N * 4)
    for (let i = 0; i < N * N; i++) {
      raw[i * 4 + 1] = 255
      raw[i * 4 + 3] = i % N < 32 ? 0 : 255
    }
    return sharp(raw, { raw: { width: N, height: N, channels: 4 } }).png().toBuffer()
  }

  // GPT Image 2.6 handed back a partly transparent picture inside the mask
  // (production, 2026-11-11): an opaque photo must never come back see-through.
  for (const [what, base] of [["an opaque photo", () => noisySource()], ["a photo whose alpha is all 255", () => noisySource(4, 255)]] as const) {
    it(`${what} stays opaque under a partly transparent result: the photo shows where the result is clear`, async () => {
      const source = await base()
      const out = await compositeMaskedRegion({ base: source, result: await halfClearGreen(), mask: await squareMask(), featherSigma: 2, featherInward: true, keepAlpha: true })
      const got = await pixels(out)
      const src = await pixels(source)
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const px = got.at(x, y)
        if (px.length === 4) expect(px[3]).toBe(255)
      }
      expect(got.at(24, 32).slice(0, 3)).toEqual(src.at(24, 32).slice(0, 3)) // inside the mask, where the result is clear: the photo
      expect(got.at(40, 32).slice(0, 3)).toEqual([0, 255, 0]) // inside, where the result is opaque: the result
      expect(got.at(2, 2).slice(0, 3)).toEqual(src.at(2, 2).slice(0, 3)) // outside: the photo
    })
  }

  it("keeps the result's transparency on an opaque photo when a transparent background was asked for", async () => {
    const out = await compositeMaskedRegion({ base: await noisySource(), result: await halfClearGreen(), mask: await squareMask(), featherSigma: 2, featherInward: true, keepAlpha: true, transparent: true })
    const got = await pixels(out)
    expect(got.info.channels).toBe(4)
    expect(got.at(24, 32)[3]).toBe(0)
    expect(got.at(40, 32)[3]).toBe(255)
    expect(got.at(2, 2)[3]).toBe(255)
  })

  it("the Generate Image inpaint (no keepAlpha) shows the base where its result is clear, never black", async () => {
    const base = await noisySource()
    const out = await compositeMaskedRegion({ base, result: await halfClearGreen(), mask: await squareMask(), featherSigma: 2 })
    const got = await pixels(out)
    const src = await pixels(base)
    expect((await sharp(out).metadata()).hasAlpha).toBe(false)
    expect(got.at(24, 32)).toEqual(src.at(24, 32))
    expect(got.at(40, 32)).toEqual([0, 255, 0])
  })

  for (const format of ["png", "jpeg", "webp"] as const) {
    it(`writes a ${format} when asked`, async () => {
      const out = await compositeMaskedRegion({ base: await noisySource(), result: await green(N), mask: await squareMask(), featherSigma: 2, featherInward: true, keepAlpha: true, format })
      expect(sniffImageFormat(out)).toBe(format)
    })
  }
})

describe("maskFeatherSigma", () => {
  it("is a few pixels, growing with the picture's short side", () => {
    expect(maskFeatherSigma(1024, 1024)).toBeCloseTo(2.048, 3)
    expect(maskFeatherSigma(2048, 1536)).toBeCloseTo(3.072, 3)
    expect(maskFeatherSigma(256, 4000)).toBe(1)
    expect(maskFeatherSigma(8000, 8000)).toBe(8)
  })
})
