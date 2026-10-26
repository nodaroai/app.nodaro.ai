/**
 * Mask Erase's pure parts (providers/video/mask-erase.ts): a gray frame read
 * as Video Mask's RLE, the centre-in-box test over a frame range, and the
 * erase over a whole mask. The real decode → erase → render is in
 * mask-erase.e2e.test.ts.
 */
import { describe, expect, it } from "vitest"
import { decodeMaskRle } from "../video-mask.js"
import { buildMaskDecodeArgs, eraseMaskRegions, grayFrameToRle, maskEraseRects, regionErased } from "../mask-erase.js"

const W = 10
const H = 10

/** A frame (W × H) with white squares at [x, y, size]. */
function frameWith(squares: Array<[number, number, number]>): Uint8Array {
  const f = new Uint8Array(W * H)
  for (const [x, y, n] of squares) for (let r = y; r < y + n; r++) f.fill(255, r * W + x, r * W + x + n)
  return f
}
const rleOf = (squares: Array<[number, number, number]>) => grayFrameToRle(frameWith(squares))

describe("grayFrameToRle", () => {
  it("writes one-based runs over the pixels at or above 128, which decodeMaskRle draws back exactly", () => {
    const f = new Uint8Array(W * H)
    f[0] = 128 // white (threshold inclusive)
    f[1] = 127 // black
    f.fill(200, 5, 13) // a run across a row end
    f[W * H - 1] = 255 // the last pixel
    expect(grayFrameToRle(f)).toBe("1 1 6 8 100 1")
    const back = new Uint8Array(W * H)
    decodeMaskRle(grayFrameToRle(f), back)
    expect(Array.from(back)).toEqual(Array.from(f).map((v) => (v >= 128 ? 255 : 0)))
  })

  it("is empty for an all-black frame", () => {
    expect(grayFrameToRle(new Uint8Array(W * H))).toBe("")
  })
})

describe("regionErased", () => {
  // A 2×2 region at columns 4–5, rows 4–5: centre (5, 5).
  const box = { top: 4, bottom: 5, left: 4, right: 6 }
  it("is the region's bounding-box centre inside a box (edges included), on a frame in its range", () => {
    const rects = maskEraseRects([{ fromFrame: 2, toFrame: 4, leftPct: 50, topPct: 50, rightPct: 60, bottomPct: 60 }], W, H)
    expect(regionErased(box, 2, rects)).toBe(true)
    expect(regionErased(box, 4, rects)).toBe(true)
    expect(regionErased(box, 1, rects)).toBe(false)
    expect(regionErased(box, 5, rects)).toBe(false)
  })
  it("is false when the centre is outside the box, even if the region overlaps it", () => {
    const rects = maskEraseRects([{ fromFrame: 0, toFrame: 0, leftPct: 0, topPct: 0, rightPct: 49, bottomPct: 100 }], W, H)
    expect(regionErased(box, 0, rects)).toBe(false)
  })
})

describe("eraseMaskRegions", () => {
  it("drops only the region centred in the box on the box's frames; every other region and frame is kept exactly", async () => {
    const both = rleOf([[0, 0, 3], [6, 6, 3]])
    const rle = [both, both, both]
    const boxes = [{ fromFrame: 1, toFrame: 1, leftPct: 50, topPct: 50, rightPct: 100, bottomPct: 100 }]
    const r = await eraseMaskRegions(rle, { width: W, height: H }, boxes)
    expect(r.droppedRegions).toBe(1)
    expect(r.matched).toBe(true)
    expect(r.kept).toBe(true)
    expect(rle[0]).toBe(both)
    expect(rle[2]).toBe(both)
    expect(rle[1]).toBe(rleOf([[0, 0, 3]]))
    expect(rle).toHaveLength(3)
  })

  it("leaves nothing (kept false) when every region is erased everywhere", async () => {
    const rle = [rleOf([[6, 6, 3]]), rleOf([[6, 6, 3]])]
    const r = await eraseMaskRegions(rle, { width: W, height: H }, [{ fromFrame: 0, toFrame: 1, leftPct: 0, topPct: 0, rightPct: 100, bottomPct: 100 }])
    expect(r).toMatchObject({ droppedRegions: 2, matched: true, kept: false })
    expect(rle).toEqual(["", ""])
  })

  it("matches nothing for an empty mask", async () => {
    const r = await eraseMaskRegions(["", ""], { width: W, height: H }, [{ fromFrame: 0, toFrame: 9, leftPct: 0, topPct: 0, rightPct: 100, bottomPct: 100 }])
    expect(r).toMatchObject({ droppedRegions: 0, matched: false, kept: false })
  })
})

describe("buildMaskDecodeArgs", () => {
  it("decodes the first picture stream, every frame as it is, to raw gray on stdout", () => {
    const args = buildMaskDecodeArgs("/w/in.mp4")
    expect(args).toEqual(expect.arrayContaining(["-map", "0:v:0", "-fps_mode", "passthrough", "-pix_fmt", "gray", "pipe:1"]))
    expect(args[args.indexOf("-i") + 1]).toBe("/w/in.mp4")
  })
})
