import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { fitImageUnderPixels, sizeWithinPixels } from "../image-pixel-fit.js"

describe("a picture over a step's cap is scaled down to fit it", () => {
  it("keeps the shape, within the area and the edge, never enlarged", () => {
    const s = sizeWithinPixels(10880, 6144, 50_000_000)
    expect(s.width * s.height).toBeLessThanOrEqual(50_000_000)
    expect(s.width / s.height).toBeCloseTo(10880 / 6144, 2)
    expect(sizeWithinPixels(10880, 6144, 8192 * 8192, 8192).width).toBe(8192)
    expect(sizeWithinPixels(100, 50, 1_000_000)).toEqual({ width: 100, height: 50 })
  })

  it("hands a picture within the cap on byte for byte, and fits one over it", async () => {
    const small = await sharp({ create: { width: 64, height: 32, channels: 3, background: "#000" } }).png().toBuffer()
    expect(await fitImageUnderPixels(small, 10_000)).toBe(small)
    const fitted = await fitImageUnderPixels(small, 500)
    const meta = await sharp(fitted).metadata()
    expect(meta.width! * meta.height!).toBeLessThanOrEqual(500)
    expect(meta.format).toBe("jpeg")
  })
})

describe("an animated picture is never scaled down (it would keep one frame)", () => {
  it("an animated GIF over the limits comes back as it was", async () => {
    const sharp = (await import("sharp")).default
    const { fitImageUnderPixels } = await import("../image-pixel-fit.js")
    const frameOf = (background: string) => sharp({ create: { width: 64, height: 64, channels: 3, background } }).png().toBuffer()
    const frame = await frameOf("#123")
    const gif = await sharp([frame, await frameOf("#f00")], { join: { animated: true } }).gif({ delay: [100, 100], loop: 0 }).toBuffer()
    expect((await sharp(gif).metadata()).pages).toBe(2)
    expect(await fitImageUnderPixels(gif, 100, 8)).toBe(gif)
    // A still over the limits is scaled down.
    expect(await fitImageUnderPixels(frame, 100, 8)).not.toBe(frame)
  })
})

describe("an animated PNG is never scaled down", () => {
  /** CRC-32 of a PNG chunk's type and data. */
  const crc32 = (buf: Buffer): number => {
    let c = ~0
    for (const byte of buf) {
      c ^= byte
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, "latin1"), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([head, body, crc])
  }
  /** The chunks of a PNG, in order. */
  const chunksOf = (png: Buffer) => {
    const out: Array<{ type: string; data: Buffer }> = []
    let at = 8
    while (at < png.length) {
      const length = png.readUInt32BE(at)
      out.push({ type: png.toString("latin1", at + 4, at + 8), data: png.subarray(at + 8, at + 8 + length) })
      at += 12 + length
    }
    return out
  }

  it("a real two-frame APNG over the limits comes back as it was; its first frame alone is scaled", async () => {
    const sharp = (await import("sharp")).default
    const { fitImageUnderPixels, isAnimatedPng } = await import("../image-pixel-fit.js")
    const frameOf = (background: string) => sharp({ create: { width: 64, height: 64, channels: 4, background } }).png().toBuffer()
    const a = chunksOf(await frameOf("#f00"))
    const b = chunksOf(await frameOf("#00f"))
    const ihdr = a.find((c) => c.type === "IHDR")!.data
    const fctl = (seq: number) => {
      const d = Buffer.alloc(26)
      d.writeUInt32BE(seq, 0)
      d.writeUInt32BE(64, 4)
      d.writeUInt32BE(64, 8)
      d.writeUInt16BE(1, 20)
      d.writeUInt16BE(10, 22)
      return chunk("fcTL", d)
    }
    const actl = Buffer.alloc(8)
    actl.writeUInt32BE(2, 0)
    const fdat = Buffer.concat(b.filter((c) => c.type === "IDAT").map((c) => c.data))
    const seq2 = Buffer.alloc(4)
    seq2.writeUInt32BE(2)
    const apng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("acTL", actl),
      fctl(0),
      ...a.filter((c) => c.type === "IDAT").map((c) => chunk("IDAT", c.data)),
      fctl(1),
      chunk("fdAT", Buffer.concat([seq2, fdat])),
      chunk("IEND", Buffer.alloc(0)),
    ])
    // A valid PNG (the library reads it), which it reports as one page.
    expect((await sharp(apng).metadata()).format).toBe("png")
    expect(isAnimatedPng(apng)).toBe(true)
    expect(await fitImageUnderPixels(apng, 100, 8)).toBe(apng)
    // A plain PNG is not animated, and is scaled.
    const still = await frameOf("#f00")
    expect(isAnimatedPng(still)).toBe(false)
    expect(await fitImageUnderPixels(still, 100, 8)).not.toBe(still)
  })
})
