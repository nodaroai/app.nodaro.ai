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
