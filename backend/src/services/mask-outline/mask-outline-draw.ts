/**
 * ONE FRAME OF A MASK OUTLINE (pure, no I/O) — the drawing step of
 * `POST /v1/mask-outline` (draw-mask-outline.ts runs it frame by frame).
 *
 * The mask frame's connected white regions are labelled with Video Mask's own
 * pass (`maskRegionsOf`, the regions Mask Erase judges), and each region is
 * given to the outline whose box holds its bounding-box CENTRE on this mask
 * frame (`centredIn`, Mask Erase's test, so the region a box kept and the
 * region it rings are the same). A region two outlines claim is AMBIGUOUS
 * and is not drawn: two people's boxes hold its centre, or two people touch
 * as one blob (another person's box, holding no region of its own, has its
 * centre on the region or overlaps it by a quarter: `regionOwners`).
 *
 * Each outline's ring is traced just OUTSIDE its regions, on the clip's own
 * pixels: an inner black edge, the colour `strokePx` wide, an outer black
 * edge (`edgePx` each), by an approximate Euclidean distance (a 3-4 chamfer,
 * within a few % of the true distance) from the outline's own pixels. A ring
 * is never painted on a pixel the mask covers (any region, whoever's), so one
 * person's colour never lands on another's fill; where two rings meet, the
 * nearer outline's wins.
 *
 * The mask may be another size than the clip (Video Mask may sample a large
 * clip down): every clip pixel reads the mask pixel under it (nearest).
 */
import { maskRegionsOf, type MaskRegionBox } from "../../providers/video/video-mask.js"
import { MASK_ERASE_THRESHOLD, centredIn, grayFrameToRle, type MaskEraseRect } from "../../providers/video/mask-erase.js"

/** One outline as a frame is drawn with it: its colour and its boxes in MASK pixels (`maskEraseRects`). */
export interface OutlinePlanEntry {
  readonly rgb: readonly [number, number, number]
  readonly rects: readonly MaskEraseRect[]
}

export interface OutlineFrame {
  /** The clip frame, packed RGB (`width × height × 3`); painted IN PLACE. */
  readonly rgb: Uint8Array
  readonly width: number
  readonly height: number
  /** The mask frame drawn with it, one gray byte a pixel (white ≥ 128 = covered). */
  readonly mask: Uint8Array
  readonly maskWidth: number
  readonly maskHeight: number
  /** The mask frame's index: the frame the boxes' ranges are read on. */
  readonly maskFrame: number
}

export interface OutlineStroke {
  /** The colour band's width, px of the clip. */
  readonly strokePx: number
  /** Each black edge's width, px of the clip. */
  readonly edgePx: number
}

export interface OutlineFrameResult {
  /** Per outline (in plan order): the regions drawn on this frame. */
  readonly regionsDrawn: number[]
  /** The regions two or more outlines claimed (left undrawn). */
  readonly ambiguous: number
}

/** The colour `#RRGGBB` as bytes. Pure. */
export function rgbOf(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * The share of the smaller of a region's bounding box and another outline's
 * box that their overlap must reach for the region to read as that other
 * person merged into it (25 %): a box that only grazes a blob's edge (an arm,
 * a box drawn a little wide) leaves it alone, while a quarter of a person's
 * box inside someone else's blob means their mask merged into one.
 */
export const MERGED_OVERLAP_SHARE = 0.25

/** A region's bounding box as an area in continuous coordinates (rows inclusive, columns right-exclusive). */
const areaOf = (b: MaskRegionBox) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom + 1 - b.top)

/**
 * Which outline each region belongs to: its index in `plan`, -1 when no
 * outline's box holds its centre, -2 when it is AMBIGUOUS (never drawn):
 *   - two or more outlines' boxes hold its centre; or
 *   - two people touch as ONE blob: another outline has an active box on
 *     this frame that holds no region's centre of its own (its person was
 *     not found apart), and that box's centre lies on this region's pixels
 *     (`regionAt`, when given), or the box overlaps the region's bounding box
 *     by `MERGED_OVERLAP_SHARE` of the smaller of the two.
 * A box that holds a region of its own is that person found apart: it never
 * makes a neighbour's blob ambiguous. Pure.
 */
export function regionOwners(
  boxes: readonly MaskRegionBox[],
  frame: number,
  plan: readonly OutlinePlanEntry[],
  regionAt?: (x: number, y: number) => number,
): Int32Array {
  const owners = new Int32Array(boxes.length).fill(-1)
  for (let r = 0; r < boxes.length; r++) {
    for (let k = 0; k < plan.length; k++) {
      if (!centredIn(boxes[r]!, frame, plan[k]!.rects)) continue
      owners[r] = owners[r] === -1 ? k : -2
      if (owners[r] === -2) break
    }
  }
  // Each outline's active boxes that hold no region's centre: a person not found apart on this frame.
  const unclaimed = plan.map((p) =>
    p.rects.filter((rect) => frame >= rect.fromFrame && frame <= rect.toFrame && !boxes.some((b) => centredIn(b, frame, [rect]))),
  )
  for (let r = 0; r < boxes.length; r++) {
    const k = owners[r]!
    if (k < 0) continue
    const b = boxes[r]!
    const area = areaOf(b)
    merged: for (let j = 0; j < plan.length; j++) {
      if (j === k) continue
      for (const rect of unclaimed[j]!) {
        if (regionAt && regionAt((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2) === r) {
          owners[r] = -2
          break merged
        }
        const ix = Math.min(b.right, rect.x1) - Math.max(b.left, rect.x0)
        const iy = Math.min(b.bottom + 1, rect.y1) - Math.max(b.top, rect.y0)
        const smaller = Math.min(area, Math.max(0, rect.x1 - rect.x0) * Math.max(0, rect.y1 - rect.y0))
        if (ix > 0 && iy > 0 && smaller > 0 && ix * iy >= MERGED_OVERLAP_SHARE * smaller) {
          owners[r] = -2
          break merged
        }
      }
    }
  }
  return owners
}

/** Chamfer weights (×3 of a pixel): orthogonal 3, diagonal 4. */
const ORTHO = 3
const DIAG = 4
const FAR = 0x3fffffff

/** Working buffers reused frame after frame (grown when a frame needs more). */
interface Scratch {
  label: Int32Array
  dist: Int32Array
  best: Int32Array
}

export function createOutlineScratch(): Scratch {
  return { label: new Int32Array(0), dist: new Int32Array(0), best: new Int32Array(0) }
}

/**
 * Draw the frame's outlines on `frame.rgb` (in place). `scratch` is reused
 * across frames (`createOutlineScratch`). Returns how many regions each
 * outline got on this frame, and how many were ambiguous.
 */
export function drawOutlinesOnFrame(frame: OutlineFrame, plan: readonly OutlinePlanEntry[], stroke: OutlineStroke, scratch: Scratch): OutlineFrameResult {
  const { width: W, height: H, maskWidth: MW, maskHeight: MH } = frame
  const regionsDrawn = plan.map(() => 0)
  // 1. The mask's regions, and whose each one is.
  const regions = maskRegionsOf(grayFrameToRle(frame.mask, MASK_ERASE_THRESHOLD), MW, MH)
  if (regions.boxes.length === 0 || plan.length === 0) return { regionsDrawn, ambiguous: 0 }

  // 2. A mask-sized label image: each covered pixel's region + 1 (0 = not covered).
  const maskPixels = MW * MH
  if (scratch.label.length < maskPixels) scratch.label = new Int32Array(maskPixels)
  const label = scratch.label
  label.fill(0, 0, maskPixels)
  for (let i = 0; i < regions.row.length; i++) {
    const base = regions.row[i]! * MW
    label.fill(regions.region[i]! + 1, base + regions.x0[i]!, base + regions.x1[i]!)
  }
  // Whose each region is (a point in mask pixels → its region, -1 uncovered: for a merged blob).
  const regionAt = (x: number, y: number): number => {
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || py < 0 || px >= MW || py >= MH) return -1
    return label[py * MW + px]! - 1
  }
  const owners = regionOwners(regions.boxes, frame.maskFrame, plan, regionAt)
  let ambiguous = 0
  for (let r = 0; r < owners.length; r++) {
    if (owners[r] === -2) ambiguous++
    else if (owners[r]! >= 0) regionsDrawn[owners[r]!]! += 1
  }
  if (regionsDrawn.every((n) => n === 0)) return { regionsDrawn, ambiguous }
  // Clip pixel → mask pixel (nearest), per column and per row.
  const mx = new Int32Array(W)
  const my = new Int32Array(H)
  for (let x = 0; x < W; x++) mx[x] = Math.min(MW - 1, Math.floor(((x + 0.5) * MW) / W))
  for (let y = 0; y < H; y++) my[y] = Math.min(MH - 1, Math.floor(((y + 0.5) * MH) / H)) * MW

  const reach = (stroke.edgePx * 2 + stroke.strokePx) * ORTHO
  const pad = stroke.edgePx * 2 + stroke.strokePx + 1
  const pixels = W * H
  if (scratch.best.length < pixels) scratch.best = new Int32Array(pixels)
  const best = scratch.best
  const touched: Array<[number, number, number, number]> = []

  // 3. Each outline: a chamfer distance from its own pixels, within its regions' box (grown by the ring).
  for (let k = 0; k < plan.length; k++) {
    if (regionsDrawn[k] === 0) continue
    let top = MH, bottom = -1, left = MW, right = -1
    for (let r = 0; r < owners.length; r++) {
      if (owners[r] !== k) continue
      const b = regions.boxes[r]!
      if (b.top < top) top = b.top
      if (b.bottom > bottom) bottom = b.bottom
      if (b.left < left) left = b.left
      if (b.right > right) right = b.right
    }
    // The box in clip pixels, grown by the ring's reach.
    const x0 = Math.max(0, Math.floor((left * W) / MW) - pad)
    const x1 = Math.min(W, Math.ceil((right * W) / MW) + pad)
    const y0 = Math.max(0, Math.floor((top * H) / MH) - pad)
    const y1 = Math.min(H, Math.ceil(((bottom + 1) * H) / MH) + pad)
    const bw = x1 - x0
    const bh = y1 - y0
    if (bw <= 0 || bh <= 0) continue
    if (scratch.dist.length < bw * bh) scratch.dist = new Int32Array(bw * bh)
    const dist = scratch.dist
    for (let y = 0; y < bh; y++) {
      const mrow = my[y0 + y]!
      for (let x = 0; x < bw; x++) {
        const l = label[mrow + mx[x0 + x]!]!
        dist[y * bw + x] = l > 0 && owners[l - 1] === k ? 0 : FAR
      }
    }
    chamfer(dist, bw, bh)
    // 4. Paint the ring outside every covered pixel, nearer outline first.
    const [cr, cg, cb] = plan[k]!.rgb
    // The inner edge: every pixel within `edgePx` of the region, a diagonal step (4) included, so a convex
    // corner gets its black edge too.
    const inner = stroke.edgePx * ORTHO + 1
    const colourEnd = (stroke.edgePx + stroke.strokePx) * ORTHO
    for (let y = 0; y < bh; y++) {
      const gy = y0 + y
      const mrow = my[gy]!
      for (let x = 0; x < bw; x++) {
        const d = dist[y * bw + x]!
        if (d === 0 || d > reach) continue
        const gx = x0 + x
        if (label[mrow + mx[gx]!]! > 0) continue // covered: never painted
        const p = gy * W + gx
        if (best[p] !== 0 && best[p]! <= d) continue
        best[p] = d
        const o = p * 3
        if (d <= inner || d > colourEnd) {
          frame.rgb[o] = 0
          frame.rgb[o + 1] = 0
          frame.rgb[o + 2] = 0
        } else {
          frame.rgb[o] = cr
          frame.rgb[o + 1] = cg
          frame.rgb[o + 2] = cb
        }
      }
    }
    touched.push([x0, y0, x1, y1])
  }
  // The nearest-wins buffer back to "nothing painted" where this frame touched it.
  for (const [x0, y0, x1, y1] of touched) for (let y = y0; y < y1; y++) best.fill(0, y * W + x0, y * W + x1)
  return { regionsDrawn, ambiguous }
}

/** The 3-4 chamfer distance transform IN PLACE (0 = a source pixel, FAR = none yet). */
function chamfer(d: Int32Array, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let v = d[i]!
      if (v === 0) continue
      if (x > 0) v = Math.min(v, d[i - 1]! + ORTHO)
      if (y > 0) {
        v = Math.min(v, d[i - w]! + ORTHO)
        if (x > 0) v = Math.min(v, d[i - w - 1]! + DIAG)
        if (x < w - 1) v = Math.min(v, d[i - w + 1]! + DIAG)
      }
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      let v = d[i]!
      if (v === 0) continue
      if (x < w - 1) v = Math.min(v, d[i + 1]! + ORTHO)
      if (y < h - 1) {
        v = Math.min(v, d[i + w]! + ORTHO)
        if (x < w - 1) v = Math.min(v, d[i + w + 1]! + DIAG)
        if (x > 0) v = Math.min(v, d[i + w - 1]! + DIAG)
      }
      d[i] = v
    }
  }
}
