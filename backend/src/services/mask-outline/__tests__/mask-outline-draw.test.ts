/**
 * One frame of a mask outline (mask-outline-draw.ts): which region is whose,
 * and the ring traced just outside it — never on a covered pixel, never for a
 * region two outlines claim.
 */
import { describe, it, expect } from "vitest"
import { maskEraseRects } from "../../../providers/video/mask-erase.js"
import { createOutlineScratch, drawOutlinesOnFrame, regionOwners, rgbOf, type OutlinePlanEntry } from "../mask-outline-draw.js"
import { maskOutlineStrokePx } from "../draw-mask-outline.js"

const W = 60
const H = 40

/** A gray mask with white rectangles (x0..x1, y0..y1 exclusive). */
function maskWith(w: number, h: number, rects: Array<[number, number, number, number]>): Uint8Array {
  const m = new Uint8Array(w * h)
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 255
  return m
}

/** A mid-gray clip frame. */
const grayClip = (w = W, h = H) => new Uint8Array(w * h * 3).fill(128)
const px = (rgb: Uint8Array, x: number, y: number, w = W) => Array.from(rgb.subarray((y * w + x) * 3, (y * w + x) * 3 + 3))

/** A box over every frame, % of the frame. */
const box = (leftPct: number, topPct: number, rightPct: number, bottomPct: number) => ({ fromFrame: 0, toFrame: 999, leftPct, topPct, rightPct, bottomPct })
const plan = (hex: string, boxes: ReturnType<typeof box>[], w = W, h = H): OutlinePlanEntry => ({ rgb: rgbOf(hex), rects: maskEraseRects(boxes, w, h) })

// Two people: one on the left (x 10–20, y 10–30), one on the right (x 40–50, y 10–30).
const TWO = maskWith(W, H, [[10, 10, 20, 30], [40, 10, 50, 30]])
const LEFT = box(0, 0, 50, 100)
const RIGHT = box(50, 0, 100, 100)
const STROKE = { strokePx: 3, edgePx: 1 }

describe("rgbOf", () => {
  it("reads #RRGGBB", () => {
    expect(rgbOf("#FF00FF")).toEqual([255, 0, 255])
    expect(rgbOf("#ffe600")).toEqual([255, 230, 0])
  })
})

describe("regionOwners", () => {
  it("gives a region to the outline whose box holds its centre; none = -1; two = -2 (ambiguous)", () => {
    const boxes = [
      { top: 10, bottom: 29, left: 10, right: 20 },
      { top: 10, bottom: 29, left: 40, right: 50 },
    ]
    expect(Array.from(regionOwners(boxes, 0, [plan("#FF00FF", [LEFT])]))).toEqual([0, -1])
    expect(Array.from(regionOwners(boxes, 0, [plan("#FF00FF", [LEFT]), plan("#FFE600", [RIGHT])]))).toEqual([0, 1])
    expect(Array.from(regionOwners(boxes, 0, [plan("#FF00FF", [box(0, 0, 100, 100)]), plan("#FFE600", [RIGHT])]))).toEqual([0, -2])
  })

  it("reads a box's range on the frame given", () => {
    const boxes = [{ top: 10, bottom: 29, left: 10, right: 20 }]
    const later = plan("#FF00FF", [{ ...LEFT, fromFrame: 5, toFrame: 9 }])
    expect(Array.from(regionOwners(boxes, 4, [later]))).toEqual([-1])
    expect(Array.from(regionOwners(boxes, 5, [later]))).toEqual([0])
    expect(Array.from(regionOwners(boxes, 10, [later]))).toEqual([-1])
  })
})

describe("drawOutlinesOnFrame", () => {
  const draw = (rgb: Uint8Array, mask: Uint8Array, p: OutlinePlanEntry[], o: { w?: number; h?: number; mw?: number; mh?: number; frame?: number } = {}) =>
    drawOutlinesOnFrame(
      { rgb, width: o.w ?? W, height: o.h ?? H, mask, maskWidth: o.mw ?? W, maskHeight: o.mh ?? H, maskFrame: o.frame ?? 0 },
      p,
      STROKE,
      createOutlineScratch(),
    )

  it("rings the outline's region just outside it: a black edge, the colour, a black edge; the region itself untouched", () => {
    const rgb = grayClip()
    const r = draw(rgb, TWO, [plan("#FF00FF", [LEFT])])
    expect(r).toEqual({ regionsDrawn: [1], ambiguous: 0 })
    // Inside the region: as filmed (the fill stays the fill).
    expect(px(rgb, 15, 20)).toEqual([128, 128, 128])
    expect(px(rgb, 10, 20)).toEqual([128, 128, 128])
    // Left of it, row 20: x 9 the inner edge, 8–6 the colour, 5 the outer edge, 4 untouched.
    expect(px(rgb, 9, 20)).toEqual([0, 0, 0])
    expect(px(rgb, 8, 20)).toEqual([255, 0, 255])
    expect(px(rgb, 6, 20)).toEqual([255, 0, 255])
    expect(px(rgb, 5, 20)).toEqual([0, 0, 0])
    expect(px(rgb, 4, 20)).toEqual([128, 128, 128])
    // The other person has no outline: nothing around them.
    expect(px(rgb, 38, 20)).toEqual([128, 128, 128])
  })

  it("draws each outline in its own colour", () => {
    const rgb = grayClip()
    const r = draw(rgb, TWO, [plan("#FF00FF", [LEFT]), plan("#FFE600", [RIGHT])])
    expect(r.regionsDrawn).toEqual([1, 1])
    expect(px(rgb, 7, 20)).toEqual([255, 0, 255])
    expect(px(rgb, 52, 20)).toEqual([255, 230, 0])
  })

  it("leaves a region two outlines claim undrawn, and counts it", () => {
    const rgb = grayClip()
    const before = Buffer.from(rgb)
    const r = draw(rgb, TWO, [plan("#FF00FF", [box(0, 0, 100, 100)]), plan("#FFE600", [box(0, 0, 50, 100)])])
    // Left: both claim it (ambiguous); right: only the first.
    expect(r).toEqual({ regionsDrawn: [1, 0], ambiguous: 1 })
    expect(px(rgb, 7, 20)).toEqual([128, 128, 128])
    expect(px(rgb, 52, 20)).toEqual([255, 0, 255])
    expect(Buffer.from(rgb).equals(before)).toBe(false)
  })

  it("never paints a covered pixel, even another person's: two people two pixels apart", () => {
    const close = maskWith(W, H, [[10, 10, 20, 30], [22, 10, 32, 30]])
    const rgb = grayClip()
    draw(rgb, close, [plan("#FF00FF", [box(0, 0, 25, 100)])])
    // x 20–21 are the two free pixels between them: the inner edge, then the colour. Every pixel of the
    // right person stays as filmed.
    expect(px(rgb, 20, 20)).toEqual([0, 0, 0])
    expect(px(rgb, 21, 20)).toEqual([255, 0, 255])
    for (let x = 22; x < 32; x++) expect(px(rgb, x, 20)).toEqual([128, 128, 128])
  })

  it("where two rings meet, the nearer outline's colour wins", () => {
    const near = maskWith(W, H, [[10, 10, 20, 30], [28, 10, 38, 30]])
    const rgb = grayClip()
    draw(rgb, near, [plan("#FF00FF", [box(0, 0, 40, 100)]), plan("#FFE600", [box(40, 0, 100, 100)])])
    // Gap x 20–27: x 22 is 3 px from the left person (colour), 6 px from the right one.
    expect(px(rgb, 22, 20)).toEqual([255, 0, 255])
    // x 25 is 3 px from the right person, 6 from the left.
    expect(px(rgb, 25, 20)).toEqual([255, 230, 0])
  })

  it("reads a smaller mask under the clip (nearest): the ring follows the region at the clip's size", () => {
    // The mask at half the size: the left person is x 5–10, y 5–15 there, x 10–20, y 10–30 on the clip.
    const half = maskWith(W / 2, H / 2, [[5, 5, 10, 15]])
    const rgb = grayClip()
    const r = draw(rgb, half, [plan("#FF00FF", [LEFT], W / 2, H / 2)], { mw: W / 2, mh: H / 2 })
    expect(r.regionsDrawn).toEqual([1])
    expect(px(rgb, 15, 20)).toEqual([128, 128, 128])
    expect(px(rgb, 9, 20)).toEqual([0, 0, 0])
    expect(px(rgb, 7, 20)).toEqual([255, 0, 255])
  })

  it("draws nothing for an empty mask, or a box on other frames", () => {
    const rgb = grayClip()
    expect(draw(rgb, new Uint8Array(W * H), [plan("#FF00FF", [LEFT])])).toEqual({ regionsDrawn: [0], ambiguous: 0 })
    expect(draw(rgb, TWO, [plan("#FF00FF", [{ ...LEFT, fromFrame: 3, toFrame: 4 }])], { frame: 2 })).toEqual({ regionsDrawn: [0], ambiguous: 0 })
    expect(rgb.every((v) => v === 128)).toBe(true)
  })

  it("reuses its scratch across frames: a second frame is drawn exactly as the first", () => {
    const scratch = createOutlineScratch()
    const frame = () => {
      const rgb = grayClip()
      drawOutlinesOnFrame({ rgb, width: W, height: H, mask: TWO, maskWidth: W, maskHeight: H, maskFrame: 0 }, [plan("#FF00FF", [LEFT]), plan("#FFE600", [RIGHT])], STROKE, scratch)
      return Buffer.from(rgb)
    }
    expect(frame().equals(frame())).toBe(true)
  })
})

describe("two people touching as one blob", () => {
  const draw = (mask: Uint8Array, p: OutlinePlanEntry[]) => {
    const rgb = grayClip()
    const r = drawOutlinesOnFrame({ rgb, width: W, height: H, mask, maskWidth: W, maskHeight: H, maskFrame: 0 }, p, STROKE, createOutlineScratch())
    return { r, rgb }
  }
  // One merged region: the lead (x 10–25) and a second person (x 25–40) as one blob, x 10–40, y 10–30.
  const MERGED = maskWith(W, H, [[10, 10, 40, 30]])

  it("the lead's box holds the blob's centre, the second person's box overlaps it: not drawn, counted ambiguous", () => {
    // The blob's centre (x 25) is in the lead's box (x 0–45 %, 0–27 px); the second person's box (x 40–70 %, 24–42 px)
    // holds no region of its own and overlaps the blob by more than a quarter of the smaller box.
    const { r, rgb } = draw(MERGED, [plan("#FF00FF", [box(0, 0, 45, 100)]), plan("#FFE600", [box(40, 0, 70, 100)])])
    expect(r).toEqual({ regionsDrawn: [0, 0], ambiguous: 1 })
    expect(rgb.every((v) => v === 128)).toBe(true)
  })

  it("another person's box whose centre lies on the blob's pixels makes it ambiguous, however little it overlaps", () => {
    // A small box (x 33–38 px, y 18–22 px) centred on the blob's right part: the merged second person.
    const small = { fromFrame: 0, toFrame: 999, leftPct: 55, topPct: 45, rightPct: 63, bottomPct: 55 }
    const { r } = draw(MERGED, [plan("#FF00FF", [box(0, 0, 45, 100)]), plan("#FFE600", [small])])
    expect(r).toEqual({ regionsDrawn: [0, 0], ambiguous: 1 })
  })

  it("a box that only grazes the blob's edge (under a quarter) leaves it to its owner", () => {
    // The second person's box x 64–100 % (38–60 px): 2 px of the blob's 30 px width.
    const { r, rgb } = draw(MERGED, [plan("#FF00FF", [box(0, 0, 45, 100)]), plan("#FFE600", [box(64, 0, 100, 100)])])
    expect(r).toEqual({ regionsDrawn: [1, 0], ambiguous: 0 })
    expect(px(rgb, 7, 20)).toEqual([255, 0, 255])
  })

  it("a box that holds its own person's region is that person found apart: the neighbour's ring stays", () => {
    // Two separate people; the second person's box (x 15.6–60 px) holds its own person and overlaps the lead's blob
    // (x 10–20) by over 40 %, yet misses the lead's centre (x 15).
    const { r, rgb } = draw(TWO, [plan("#FF00FF", [box(0, 0, 40, 100)]), plan("#FFE600", [box(26, 0, 100, 100)])])
    expect(r).toEqual({ regionsDrawn: [1, 1], ambiguous: 0 })
    expect(px(rgb, 7, 20)).toEqual([255, 0, 255])
  })

  it("only boxes active on this frame count: the second person's box on other frames changes nothing", () => {
    const later = { ...box(40, 0, 70, 100), fromFrame: 10, toFrame: 20 }
    const { r } = draw(MERGED, [plan("#FF00FF", [box(0, 0, 45, 100)]), plan("#FFE600", [later])])
    expect(r).toEqual({ regionsDrawn: [1, 0], ambiguous: 0 })
  })
})

describe("the ring's corners and sizes", () => {
  it("a convex corner gets its inner black edge too (the diagonal step)", () => {
    const rgb = grayClip()
    drawOutlinesOnFrame({ rgb, width: W, height: H, mask: TWO, maskWidth: W, maskHeight: H, maskFrame: 0 }, [plan("#FF00FF", [LEFT])], STROKE, createOutlineScratch())
    // The left person's top-left pixel is (10, 10): (9, 9) is one diagonal step out, black, never the colour.
    expect(px(rgb, 9, 9)).toEqual([0, 0, 0])
    expect(px(rgb, 8, 8)).toEqual([255, 0, 255])
  })

  it("reads a mask LARGER than the clip (nearest): the ring follows the region at the clip's size", () => {
    // The mask at twice the size: the left person is x 20–40, y 20–60 there, x 10–20, y 10–30 on the clip.
    const big = maskWith(W * 2, H * 2, [[20, 20, 40, 60]])
    const rgb = grayClip()
    const r = drawOutlinesOnFrame(
      { rgb, width: W, height: H, mask: big, maskWidth: W * 2, maskHeight: H * 2, maskFrame: 0 },
      [plan("#FF00FF", [LEFT], W * 2, H * 2)],
      STROKE,
      createOutlineScratch(),
    )
    expect(r.regionsDrawn).toEqual([1])
    expect(px(rgb, 15, 20)).toEqual([128, 128, 128])
    expect(px(rgb, 10, 20)).toEqual([128, 128, 128])
    expect(px(rgb, 9, 20)).toEqual([0, 0, 0])
    expect(px(rgb, 7, 20)).toEqual([255, 0, 255])
  })
})

describe("maskOutlineStrokePx", () => {
  it("is 0.6 % of the short side, rounded, at least 3 px", () => {
    expect(maskOutlineStrokePx(1920, 1080)).toBe(6)
    expect(maskOutlineStrokePx(720, 1280)).toBe(4)
    expect(maskOutlineStrokePx(320, 240)).toBe(3)
    expect(maskOutlineStrokePx(3840, 2160)).toBe(13)
  })
})
