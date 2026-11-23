/**
 * The face grow's geometry (providers/video/mask-face-grow.ts), on synthetic
 * frames: a skin-coloured face (the mask), skin above it (a forehead the mask
 * left out) and a neck below it, hair of several colours beside it, a green
 * background. The real decode → grow → render is in mask-face-grow.e2e.test.ts.
 */
import { describe, expect, it } from "vitest"
import { decodeMaskRle } from "../video-mask.js"
import { grayFrameToRle } from "../mask-erase.js"
import {
  FACE_GROW_WINDOW_CAP,
  columnTops,
  combineFaceGrowFrames,
  faceGrowRadii,
  faceGrowStep,
  fitSkinModel,
  growFaceMaskFrame,
  growFaceMaskFrameParts,
  skinDistance2,
  squaredDistanceToRegion,
} from "../mask-face-grow.js"

const W = 96
const H = 96
type RGB = readonly [number, number, number]
const SKIN: RGB = [214, 160, 130]
const GREEN: RGB = [60, 120, 70]
const DARK_HAIR: RGB = [58, 40, 30]
const BLOND_HAIR: RGB = [205, 178, 110]
const GRAY_HAIR: RGB = [170, 170, 172]
const RED_HAIR: RGB = [150, 60, 30]

/** A deterministic ±`amp` wobble, so the face's colours have a spread as a filmed face does. */
const wobble = (i: number, amp: number) => (((i * 2654435761) >>> 0) % (2 * amp + 1)) - amp

interface Rect { x0: number; y0: number; x1: number; y1: number } // x1, y1 exclusive

function paint(rgb: Uint8Array, r: Rect, c: RGB, amp = 4): void {
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const p = 3 * (y * W + x)
      for (let k = 0; k < 3; k++) rgb[p + k] = Math.max(0, Math.min(255, c[k]! + wobble(p + k, amp)))
    }
  }
}

function maskOf(rects: Rect[]): string {
  const f = new Uint8Array(W * H)
  for (const r of rects) for (let y = r.y0; y < r.y1; y++) f.fill(255, y * W + r.x0, y * W + r.x1)
  return grayFrameToRle(f)
}

const covered = (rle: string): Uint8Array => {
  const f = new Uint8Array(W * H)
  decodeMaskRle(rle, f)
  return f
}
const on = (f: Uint8Array, x: number, y: number) => f[y * W + x]! > 0

// The face: rows 30..59 (30 rows tall), columns 36..59.
const FACE: Rect = { x0: 36, y0: 30, x1: 60, y1: 60 }

/** The scene: green, skin above the face (forehead) and a neck below, `hair` at both sides of the face. */
function scene(hair: RGB): Uint8Array {
  const rgb = new Uint8Array(W * H * 3)
  paint(rgb, { x0: 0, y0: 0, x1: W, y1: H }, GREEN, 2)
  paint(rgb, { x0: 36, y0: 10, x1: 60, y1: 30 }, SKIN) // the forehead, above the mask's top
  paint(rgb, { x0: 40, y0: 60, x1: 56, y1: H }, SKIN) // the neck
  paint(rgb, { x0: 22, y0: 14, x1: 36, y1: 70 }, hair) // hair at the left
  paint(rgb, { x0: 60, y0: 14, x1: 74, y1: 70 }, hair) // hair at the right
  paint(rgb, FACE, SKIN)
  return rgb
}

describe("faceGrowRadii", () => {
  it("is growPct % of the face's height, the always-kept band 6 % (never wider than the grow, at least a pixel)", () => {
    expect(faceGrowRadii(100, 18)).toEqual({ radius: 18, band: 6 })
    expect(faceGrowRadii(100, 3)).toEqual({ radius: 3, band: 3 })
    expect(faceGrowRadii(10, 1)).toEqual({ radius: 1, band: 1 })
  })
})

describe("squaredDistanceToRegion", () => {
  it("is the exact squared Euclidean distance to the nearest inside pixel", () => {
    const w = 7, h = 5
    const inside = new Uint8Array(w * h)
    inside[2 * w + 3] = 1
    const d = squaredDistanceToRegion(inside, w, h)
    expect(d[2 * w + 3]).toBe(0)
    expect(d[2 * w + 6]).toBe(9)
    expect(d[0]).toBe(9 + 4)
    expect(d[4 * w + 5]).toBe(4 + 4)
  })
})

describe("growFaceMaskFrame", () => {
  it("growPct 0 is the identity: the same string back", () => {
    const rle = maskOf([FACE])
    const r = growFaceMaskFrame(rle, scene(DARK_HAIR), W, H, 0)
    expect(r.rle).toBe(rle)
    expect(r.after).toBe(r.before)
    expect(growFaceMaskFrame("", scene(DARK_HAIR), W, H, 20).rle).toBe("")
  })

  it("never adds a pixel above the face's own top, even onto skin", () => {
    const g = covered(growFaceMaskFrame(maskOf([FACE]), scene(DARK_HAIR), W, H, 20).rle)
    for (let y = 0; y < FACE.y0; y++) for (let x = 0; x < W; x++) expect(on(g, x, y)).toBe(false)
  })

  it("grows onto the face's own skin (the neck) up to growPct of the face's height, and no further", () => {
    const { radius } = faceGrowRadii(30, 20) // 6 px
    const g = covered(growFaceMaskFrame(maskOf([FACE]), scene(DARK_HAIR), W, H, 20).rle)
    for (let y = FACE.y1; y < FACE.y1 + radius; y++) expect(on(g, 47, y)).toBe(true)
    expect(on(g, 47, FACE.y1 + radius + 1)).toBe(false)
    // Below the face but beside the neck is green: only the band at the face's edge.
    expect(on(g, 37, FACE.y1 + radius - 1)).toBe(false)
  })

  it.each([
    ["dark", DARK_HAIR],
    ["blond", BLOND_HAIR],
    ["gray", GRAY_HAIR],
    ["red", RED_HAIR],
  ])("never grows onto %s hair beyond the band at the face's edge", (_name, hair) => {
    const { radius, band } = faceGrowRadii(30, 20)
    const g = covered(growFaceMaskFrame(maskOf([FACE]), scene(hair), W, H, 20).rle)
    for (let y = FACE.y0; y < FACE.y1; y++) {
      // The band at the edge is kept, on hair too.
      for (let d = 1; d <= band; d++) {
        expect(on(g, FACE.x0 - d, y)).toBe(true)
        expect(on(g, FACE.x1 - 1 + d, y)).toBe(true)
      }
      // Beyond it, within the grow, hair is never covered.
      for (let d = band + 1; d <= radius; d++) {
        expect(on(g, FACE.x0 - d, y)).toBe(false)
        expect(on(g, FACE.x1 - 1 + d, y)).toBe(false)
      }
    }
  })

  it("keeps the band at the face's edge whatever is under it (the background too), never above the top", () => {
    const { band } = faceGrowRadii(30, 20)
    const g = covered(growFaceMaskFrame(maskOf([FACE]), scene(GREEN), W, H, 20).rle)
    expect(on(g, FACE.x0 - band, 45)).toBe(true)
    expect(on(g, FACE.x0 - band - 1, 45)).toBe(false)
    expect(on(g, FACE.x0 - 1, FACE.y0 - 1)).toBe(false)
  })

  it("keeps only what joins the face: a skin-coloured patch across a gap of background is not covered", () => {
    const rgb = scene(GREEN)
    paint(rgb, { x0: 63, y0: 40, x1: 66, y1: 50 }, SKIN) // skin within the radius, cut off by green
    const g = covered(growFaceMaskFrame(maskOf([FACE]), rgb, W, H, 30).rle)
    for (let y = 40; y < 50; y++) for (let x = 63; x < 66; x++) expect(on(g, x, y)).toBe(false)
  })

  it("only ever widens: every pixel of the mask stays covered", () => {
    const rle = maskOf([FACE])
    const before = covered(rle)
    const g = covered(growFaceMaskFrame(rle, scene(BLOND_HAIR), W, H, 40).rle)
    for (let i = 0; i < W * H; i++) if (before[i]) expect(g[i]).toBeGreaterThan(0)
  })

  it("sizes and clamps each face on its own: a small face's grow is its own height's, and never above its own top", () => {
    const rgb = scene(DARK_HAIR)
    const small: Rect = { x0: 4, y0: 76, x1: 14, y1: 86 } // 10 rows tall
    paint(rgb, { x0: 0, y0: 66, x1: 20, y1: H }, SKIN) // skin all round it
    const g = covered(growFaceMaskFrame(maskOf([FACE, small]), rgb, W, H, 20).rle)
    const { radius } = faceGrowRadii(10, 20) // 2 px
    expect(on(g, 9, small.y1 + radius - 1)).toBe(true)
    expect(on(g, 9, small.y1 + radius + 1)).toBe(false)
    // Skin right above the small face (and below the big one's reach) stays uncovered.
    expect(on(g, 9, small.y0 - 1)).toBe(false)
  })

  it("refuses a clip frame of another size than the mask", () => {
    expect(() => growFaceMaskFrame(maskOf([FACE]), new Uint8Array(10), W, H, 20)).toThrow(/bytes/)
  })
})

describe("fitSkinModel", () => {
  it("fits the face's own colours: its skin is near, hair and background far", () => {
    const rgb = scene(DARK_HAIR)
    const runs: Array<{ row: number; x0: number; x1: number }> = []
    for (let y = FACE.y0; y < FACE.y1; y++) runs.push({ row: y, x0: FACE.x0, x1: FACE.x1 })
    const model = fitSkinModel(rgb, W, runs)!
    expect(skinDistance2(model, ...SKIN)).toBeLessThan(2)
    for (const c of [DARK_HAIR, BLOND_HAIR, GRAY_HAIR, RED_HAIR, GREEN]) expect(skinDistance2(model, ...c)).toBeGreaterThan(16)
  })
})

describe("the per-column top, the lower half, the hand, two faces, time and size", () => {
  it("a tilted face: the band reaches up to the face's top row and no higher; past the band, never above a column's own top", () => {
    // A face whose top slopes: its left half starts at row 30, its right half at row 40 (a head tilted to one side).
    const rgb = scene(GREEN)
    paint(rgb, { x0: 0, y0: 0, x1: W, y1: H }, SKIN) // skin everywhere: only the top rules can hold the grow back
    const f = new Uint8Array(W * H)
    for (let y = 30; y < 60; y++) f.fill(255, y * W + 36, y * W + 48)
    for (let y = 40; y < 60; y++) f.fill(255, y * W + 48, y * W + 60)
    const { band } = faceGrowRadii(30, 20)
    const g = covered(growFaceMaskFrame(grayFrameToRle(f), rgb, W, H, 20).rle)
    // Nothing anywhere above the face's top row.
    for (let x = 0; x < W; x++) for (let y = 0; y < 30; y++) expect(on(g, x, y), `${x},${y}`).toBe(false)
    // Above the lower side's top (rows 30..39, columns 48+): exactly the band — within it of the face, covered (beside
    // the higher half's edge, and over the lower half's own top edge); past it, never, though it is all skin.
    const inside = new Uint8Array(W * H)
    for (let i = 0; i < W * H; i++) inside[i] = f[i] ? 1 : 0
    const d2 = squaredDistanceToRegion(inside, W, H)
    for (let y = 30; y < 40; y++) {
      for (let x = 48; x < W; x++) expect(on(g, x, y), `${x},${y}`).toBe(d2[y * W + x]! <= band * band)
    }
    for (let d = 1; d <= band; d++) expect(on(g, 47 + d, 31)).toBe(true)
    // Beyond the left edge: the band all the way up to row 30, never above it.
    for (let d = 1; d <= band; d++) expect(on(g, 36 - d, 30)).toBe(true)
    expect(Array.from(columnTops([{ row: 30, x0: 36, x1: 48 }, { row: 40, x0: 48, x1: 60 }], 30, 36, { top: 30, bottom: 59, left: 36, right: 60 })).slice(0, 8)).toEqual([30, 30, 30, 30, 30, 30, 30, 30])
  })

  it("an oval face: the band rings the whole oval up to its top row (the temples and the forehead's sides too), never onto the hair past it", () => {
    // An oval face (rows 27..63, 37 rows tall) with red hair all round it, the way a face mask that reaches the hairline sits.
    const rgb = scene(GREEN)
    paint(rgb, { x0: 20, y0: 8, x1: 76, y1: 80 }, RED_HAIR)
    const f = new Uint8Array(W * H)
    const inOval = (x: number, y: number) => ((x - 48) / 12.5) ** 2 + ((y - 45) / 18.5) ** 2 <= 1
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!inOval(x, y)) continue
        f[y * W + x] = 255
        paint(rgb, { x0: x, y0: y, x1: x + 1, y1: y + 1 }, SKIN)
      }
    }
    let top = H, bottom = 0
    for (let i = 0; i < W * H; i++) if (f[i]) { top = Math.min(top, Math.floor(i / W)); bottom = Math.max(bottom, Math.floor(i / W)) }
    const { radius, band } = faceGrowRadii(bottom - top + 1, 20)
    const inside = new Uint8Array(W * H)
    for (let i = 0; i < W * H; i++) inside[i] = f[i] ? 1 : 0
    const d2 = squaredDistanceToRegion(inside, W, H)
    const g = covered(growFaceMaskFrame(grayFrameToRle(f), rgb, W, H, 20).rle)
    let temples = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (inside[i]) continue
        if (y < top) { expect(on(g, x, y), `${x},${y} above the top`).toBe(false); continue }
        if (d2[i]! <= band * band) {
          expect(on(g, x, y), `${x},${y} in the band`).toBe(true)
          // Beside the oval's upper half, above the face's own pixels in that column: the temples.
          if (y < 40) temples++
        } else if (d2[i]! <= radius * radius && y < 72) {
          expect(on(g, x, y), `${x},${y} hair past the band`).toBe(false)
        }
      }
    }
    expect(temples).toBeGreaterThan(20)
  })

  it("beyond the band, skin is taken only beside or below the face's lower half: a hand at eye level gets the band alone", () => {
    const rgb = scene(GREEN)
    paint(rgb, { x0: 60, y0: 32, x1: 70, y1: 44 }, SKIN) // a hand touching the face's side, in its upper half
    const { band } = faceGrowRadii(30, 30)
    const g = covered(growFaceMaskFrame(maskOf([FACE]), rgb, W, H, 30).rle)
    for (let y = 32; y < 44; y++) {
      expect(on(g, FACE.x1 - 1 + band, y)).toBe(true)
      expect(on(g, FACE.x1 + band + 1, y)).toBe(false)
    }
  })

  it("a hand at the temple of an oval face (above that column's top) gets the band alone", () => {
    const rgb = scene(GREEN)
    const f = new Uint8Array(W * H)
    const inOval = (x: number, y: number) => ((x - 48) / 12.5) ** 2 + ((y - 45) / 18.5) ** 2 <= 1
    paint(rgb, { x0: 52, y0: 24, x1: 76, y1: 40 }, SKIN) // a hand over the oval's upper right, skin like the face's
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inOval(x, y)) { f[y * W + x] = 255; paint(rgb, { x0: x, y0: y, x1: x + 1, y1: y + 1 }, SKIN) }
    const inside = new Uint8Array(W * H)
    for (let i = 0; i < W * H; i++) inside[i] = f[i] ? 1 : 0
    const d2 = squaredDistanceToRegion(inside, W, H)
    const { band } = faceGrowRadii(37, 30)
    const g = covered(growFaceMaskFrame(grayFrameToRle(f), rgb, W, H, 30).rle)
    for (let y = 27; y < 40; y++) for (let x = 52; x < 76; x++) if (!inside[y * W + x]) expect(on(g, x, y), `${x},${y}`).toBe(d2[y * W + x]! <= band * band)
  })

  it("two faces side by side: each grows by its own height and is clamped by its own top", () => {
    const rgb = scene(GREEN)
    paint(rgb, { x0: 0, y0: 0, x1: W, y1: H }, SKIN)
    const a: Rect = { x0: 10, y0: 20, x1: 30, y1: 50 } // 30 rows
    const b: Rect = { x0: 60, y0: 50, x1: 70, y1: 60 } // 10 rows
    const g = covered(growFaceMaskFrame(maskOf([a, b]), rgb, W, H, 20).rle)
    expect(on(g, 20, a.y1 + faceGrowRadii(30, 20).radius - 1)).toBe(true)
    expect(on(g, 65, b.y1 + faceGrowRadii(10, 20).radius - 1)).toBe(true)
    expect(on(g, 65, b.y1 + faceGrowRadii(10, 20).radius + 1)).toBe(false)
    for (let y = 0; y < b.y0; y++) expect(on(g, 65, y)).toBe(false)
  })

  it("over time: a patch the grow adds on one frame alone is left out; one added on two of three frames stays", () => {
    const rle = maskOf([FACE])
    const neck = scene(GREEN)
    const parts = (rgb: Uint8Array) => growFaceMaskFrameParts(rle, rgb, W, H, 20)
    const withNeck = parts(neck)
    const noNeck = scene(GREEN)
    paint(noNeck, { x0: 40, y0: 60, x1: 56, y1: H }, GREEN)
    const without = parts(noNeck)
    const at = (r: { rle: string }) => on(covered(r.rle), 47, FACE.y1 + 3)
    expect(at(combineFaceGrowFrames(without, withNeck, without))).toBe(false)
    expect(at(combineFaceGrowFrames(withNeck, withNeck, without))).toBe(true)
    expect(at(combineFaceGrowFrames(without, without, withNeck))).toBe(false)
    // No neighbours: the frame alone.
    expect(at(combineFaceGrowFrames(null, withNeck, null))).toBe(true)
  })

  it("a very large face window is worked on a grid, and still never above the top nor onto the hair beyond the band", () => {
    expect(faceGrowStep(FACE_GROW_WINDOW_CAP)).toBe(1)
    expect(faceGrowStep(4 * FACE_GROW_WINDOW_CAP)).toBe(2)
    const BW = 1400, BH = 1100
    const rgb = new Uint8Array(BW * BH * 3)
    const fill = (x0: number, y0: number, x1: number, y1: number, c: RGB) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgb.set(c, 3 * (y * BW + x))
    }
    fill(0, 0, BW, BH, GREEN)
    fill(400, 100, 1000, 1100, SKIN) // the face, the forehead above it and the neck below
    fill(250, 100, 400, 900, DARK_HAIR)
    const f = new Uint8Array(BW * BH)
    for (let y = 300; y < 900; y++) f.fill(255, y * BW + 400, y * BW + 1000) // a face 600 rows tall
    const g = new Uint8Array(BW * BH)
    decodeMaskRle(growFaceMaskFrame(grayFrameToRle(f), rgb, BW, BH, 20).rle, g)
    const at = (x: number, y: number) => g[y * BW + x]! > 0
    for (let x = 300; x < 1100; x += 7) for (let y = 100; y < 300; y += 7) expect(at(x, y)).toBe(false)
    expect(at(700, 960)).toBe(true) // the neck, beyond the band
    expect(at(300, 600)).toBe(false) // hair beyond the band
  })
})

