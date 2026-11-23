/**
 * Mask Composite's face grow (decided 2026-11-23): a face mask (white = a
 * face, Video Mask's) widened outwards before it is filled, so the video
 * model sees less of the filmed face's outline (jaw, cheeks, the skin around
 * them) while the hair it was told to keep stays as filmed. Reached only
 * through Mask Composite's internal `faceGrowPct` (routes/mask-composite.ts),
 * which the Cast Swap engine sends for a Video Remake Precise setting with
 * target "face" and a grow (`faceMasking.growPct`).
 *
 * Per frame, per connected region of the mask (one face; the same 8-connected
 * regions every mask filter reads, `maskRegionsOf`), with `fh` the region's
 * height in rows:
 *   1. the grow radius is `growPct` % of `fh`, the always-kept band at its
 *      edge `CAST_SWAP_FACE_GROW_BOUNDS.nearBandPct` % (never wider than the
 *      grow), both measured as exact Euclidean distance from the region
 *      (`squaredDistanceToRegion`);
 *   2. nothing is ever added above the face in its own column
 *      (`columnTops`; left and right of the face, the edge column's top), so
 *      the grow never climbs to the hair at the temples or on a tilted head;
 *   3. the band at the edge is always added; further out — and only beside
 *      or below the face's lower half (the jaw, the neck) — only a pixel the
 *      face's own skin model accepts (`fitSkinModel`: the mean and covariance
 *      of the face's own colours in Y Cb Cr, refined once without its
 *      outliers — eyes, brows, lips — luma and chroma alike, so hair of any
 *      colour, darker or of another tint than the face, does not pass);
 *   4. only what is connected to the face is kept (a skin-coloured patch of
 *      the background inside the radius is not), the result is closed 3 × 3
 *      (pin holes in the skin test), and the close is held to the same rules:
 *      never above the top, and never a pixel far from the face's colours
 *      outside the band (a strand of hair);
 *   5. over time (`combineFaceGrowFrames`): a pixel is added only when the
 *      grow adds it on at least two of the frame and its two neighbours, and
 *      within the frame's own reach, so the edge does not flicker.
 * A very large face window (a face filling a 4K frame) is worked on a grid of
 * every k-th pixel (`FACE_GROW_WINDOW_CAP`), so a frame's cost is bounded.
 * The rest of the mask is kept exactly; a region is only ever widened.
 * Pure apart from the frame buffers it is handed.
 */
import { CAST_SWAP_FACE_GROW_BOUNDS } from "@nodaro/render-rules"
import { maskRegionsOf, type MaskRegionBox } from "./video-mask.js"

/** A skin colour's squared distance from the face's model at or under which a pixel beyond the band is the face's skin. */
export const FACE_GROW_SKIN_D2 = 9
/** Over this, a pixel the close filled in beyond the band is taken back out: it is not skin (hair, an edge). */
export const FACE_GROW_NOT_SKIN_D2 = 16
/**
 * How much less a luma difference counts than a chroma one in the skin model (its luma variance × this). 1: as
 * much. Measured on a fair-skinned, red-haired test clip (2026-11-23): at 4 the grow took in the red hair beside the
 * forehead (area × 1.73 at 18 %), at 1 it kept to the face, the jaw and the neck (× 1.31; the hand-tuned test × 1.39).
 */
export const FACE_GROW_LUMA_SLACK = 1
/** At most this many of a face's pixels are read to fit its skin model (an even sample of them). */
const MODEL_SAMPLE_MAX = 20_000

/** A face's skin colour model: the mean Y Cb Cr and the inverse of its (regularised) covariance, row-major 3 × 3. */
export interface SkinModel {
  readonly mean: readonly [number, number, number]
  readonly inverse: readonly number[]
}

const ycc = (r: number, g: number, b: number): [number, number, number] => [
  0.299 * r + 0.587 * g + 0.114 * b,
  128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
  128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
]

/** The inverse of a symmetric 3 × 3 matrix (row-major), or null when it is singular. */
function invert3(m: readonly number[]): number[] | null {
  const [a, b, c, , e, f, , , i] = m as [number, number, number, number, number, number, number, number, number]
  const A = e * i - f * f
  const B = c * f - b * i
  const C = b * f - c * e
  const det = a * A + b * B + c * C
  if (!(Math.abs(det) > 1e-9)) return null
  const E = a * i - c * c
  const F = b * c - a * f
  const I = a * e - b * b
  return [A / det, B / det, C / det, B / det, E / det, F / det, C / det, F / det, I / det]
}

/** The squared Mahalanobis distance of a colour from a skin model. */
export function skinDistance2(model: SkinModel, r: number, g: number, b: number): number {
  const [y, cb, cr] = ycc(r, g, b)
  const d0 = y - model.mean[0]
  const d1 = cb - model.mean[1]
  const d2 = cr - model.mean[2]
  const v = model.inverse
  return d0 * (v[0]! * d0 + v[1]! * d1 + v[2]! * d2) + d1 * (v[3]! * d0 + v[4]! * d1 + v[5]! * d2) + d2 * (v[6]! * d0 + v[7]! * d1 + v[8]! * d2)
}

/** Mean and covariance of the sampled colours `keep` accepts; null when fewer than 3 are. */
function moments(samples: Float64Array, n: number, keep: (y: number, cb: number, cr: number) => boolean): SkinModel | null {
  let count = 0
  const sum = [0, 0, 0]
  for (let k = 0; k < n; k++) {
    const y = samples[3 * k]!, cb = samples[3 * k + 1]!, cr = samples[3 * k + 2]!
    if (!keep(y, cb, cr)) continue
    sum[0]! += y; sum[1]! += cb; sum[2]! += cr
    count++
  }
  if (count < 3) return null
  const mean: [number, number, number] = [sum[0]! / count, sum[1]! / count, sum[2]! / count]
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (let k = 0; k < n; k++) {
    const y = samples[3 * k]!, cb = samples[3 * k + 1]!, cr = samples[3 * k + 2]!
    if (!keep(y, cb, cr)) continue
    const d = [y - mean[0], cb - mean[1], cr - mean[2]]
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[3 * a + b]! += d[a]! * d[b]!
  }
  for (let j = 0; j < 9; j++) cov[j] = cov[j]! / count
  // Luma weighted by FACE_GROW_LUMA_SLACK, and a floor on every variance: a flat synthetic face still has a usable model.
  cov[0] = cov[0]! * FACE_GROW_LUMA_SLACK + 25
  cov[4] = cov[4]! + 4
  cov[8] = cov[8]! + 4
  const inverse = invert3(cov) ?? [1 / cov[0]!, 0, 0, 0, 1 / cov[4]!, 0, 0, 0, 1 / cov[8]!]
  return { mean, inverse }
}

/**
 * The skin model of one face: its own pixels (the region's runs, `x1`
 * exclusive), an even sample of at most `MODEL_SAMPLE_MAX`, fitted, then
 * fitted again without the pixels over `FACE_GROW_SKIN_D2` (eyes, brows,
 * lips, a strand of hair the mask took in). Null for a region with no pixel.
 */
export function fitSkinModel(
  rgb: Uint8Array,
  width: number,
  runs: ReadonlyArray<{ readonly row: number; readonly x0: number; readonly x1: number }>,
): SkinModel | null {
  let total = 0
  for (const run of runs) total += run.x1 - run.x0
  if (total === 0) return null
  const step = Math.max(1, Math.ceil(total / MODEL_SAMPLE_MAX))
  const samples = new Float64Array(3 * Math.ceil(total / step) + 3)
  let n = 0
  let k = 0
  for (const run of runs) {
    for (let x = run.x0; x < run.x1; x++, k++) {
      if (k % step !== 0) continue
      const p = 3 * (run.row * width + x)
      const [y, cb, cr] = ycc(rgb[p]!, rgb[p + 1]!, rgb[p + 2]!)
      samples[3 * n] = y; samples[3 * n + 1] = cb; samples[3 * n + 2] = cr
      n++
    }
  }
  const first = moments(samples, n, () => true)
  if (!first) return null
  const near = (y: number, cb: number, cr: number) => {
    const d0 = y - first.mean[0], d1 = cb - first.mean[1], d2 = cr - first.mean[2]
    const v = first.inverse
    const d = d0 * (v[0]! * d0 + v[1]! * d1 + v[2]! * d2) + d1 * (v[3]! * d0 + v[4]! * d1 + v[5]! * d2) + d2 * (v[6]! * d0 + v[7]! * d1 + v[8]! * d2)
    return d <= FACE_GROW_SKIN_D2
  }
  return moments(samples, n, near) ?? first
}

const INF = 1e20

/** One row (or column) of Felzenszwalb–Huttenlocher's squared distance transform, `f` in place over `n` values. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    while (s <= z[k]!) {
      k--
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    const dq = q - v[k]!
    d[q] = dq * dq + f[v[k]!]!
  }
  for (let q = 0; q < n; q++) f[q] = d[q]!
}

/** Each pixel's exact squared Euclidean distance to the nearest `inside` pixel, over a `w × h` window. */
export function squaredDistanceToRegion(inside: Uint8Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = inside[i] ? 0 : INF
  const len = Math.max(w, h)
  const f = new Float64Array(len), d = new Float64Array(len), v = new Int32Array(len), z = new Float64Array(len + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x]!
    edt1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) out[y * w + x] = f[y]!
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x]!
    edt1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) out[y * w + x] = f[x]!
  }
  return out
}

/** The 3 × 3 dilation (`grow`) or erosion of a binary window, separable (a row pass, then a column pass); outside the window is 0. */
function morph3(src: Uint8Array, w: number, h: number, grow: boolean): Uint8Array {
  const rows = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const o = y * w
    for (let x = 0; x < w; x++) {
      const l = x > 0 ? src[o + x - 1]! : 0, c = src[o + x]!, r = x < w - 1 ? src[o + x + 1]! : 0
      rows[o + x] = grow ? l | c | r : l & c & r
    }
  }
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const o = y * w
    for (let x = 0; x < w; x++) {
      const u = y > 0 ? rows[o - w + x]! : 0, c = rows[o + x]!, d = y < h - 1 ? rows[o + w + x]! : 0
      out[o + x] = grow ? u | c | d : u & c & d
    }
  }
  return out
}

/** The grow radius and the always-kept band of a face `fh` rows tall, in pixels (the band never wider than the radius). */
export function faceGrowRadii(fh: number, growPct: number): { readonly radius: number; readonly band: number } {
  const radius = Math.max(1, Math.round((growPct / 100) * fh))
  const band = Math.min(radius, Math.max(1, Math.round((CAST_SWAP_FACE_GROW_BOUNDS.nearBandPct / 100) * fh)))
  return { radius, band }
}

/**
 * The most pixels one face's window is worked at full size: a larger window (a face filling a 4K frame) is worked
 * on a grid of every k-th pixel (`faceGrowStep`), so a frame's cost stays bounded whatever the face's size.
 */
export const FACE_GROW_WINDOW_CAP = 360_000

/** The grid step a window of `pixels` is worked at (1: every pixel). */
export function faceGrowStep(pixels: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(pixels / FACE_GROW_WINDOW_CAP)))
}

type Run = { readonly row: number; readonly x0: number; readonly x1: number }

/**
 * Each window column's own top: the first row of the face in that column; a column inside the face's span with none
 * (a notch) takes its nearest neighbour's; left and right of the face, the edge column's. Nothing is ever added above
 * it, so the grow never climbs past the hairline at the temples or on a tilted head.
 */
export function columnTops(runs: readonly Run[], wx0: number, w: number, box: MaskRegionBox): Int32Array {
  const tops = new Int32Array(w).fill(-1)
  for (const run of runs) {
    for (let x = run.x0; x < run.x1; x++) {
      const i = x - wx0
      if (tops[i] === -1 || run.row < tops[i]!) tops[i] = run.row
    }
  }
  const left = box.left - wx0, right = box.right - 1 - wx0
  // A notch inside the span: the nearest column that has one (left first).
  for (let i = left; i <= right; i++) {
    if (tops[i] !== -1) continue
    let d = 1
    while (tops[i] === -1 && (i - d >= left || i + d <= right)) {
      if (i - d >= left && tops[i - d] !== -1 && tops[i - d]! >= 0) tops[i] = tops[i - d]!
      else if (i + d <= right && tops[i + d] !== -1) tops[i] = tops[i + d]!
      d++
    }
    if (tops[i] === -1) tops[i] = box.top
  }
  for (let i = 0; i < left; i++) tops[i] = tops[left]!
  for (let i = right + 1; i < w; i++) tops[i] = tops[right]!
  return tops
}

/** One frame's grow, before it is smoothed over time: the mask, what the grow adds, and how far it may reach. */
export interface FaceGrowFrameParts {
  /** The mask as found (1 = covered), frame-sized. */
  readonly orig: Uint8Array
  /** The pixels this frame's grow adds (never the mask's own). */
  readonly added: Uint8Array
  /** Where an added pixel may be on this frame: within the radius, under each column's top (the smoothing's bound). */
  readonly reach: Uint8Array
  /** The mask's covered pixels. */
  readonly before: number
}

/**
 * One region grown: the rules of the header, read inside the region's window (its box, widened by the radius at the
 * left, right and bottom; its top is the window's top), on a grid of every `k`-th pixel for a very large window.
 * Writes `added` and `reach` (frame-sized).
 */
function growRegion(parts: FaceGrowFrameParts, rgb: Uint8Array, width: number, height: number, box: MaskRegionBox, runs: readonly Run[], growPct: number): void {
  const fh = box.bottom - box.top + 1
  const { radius, band } = faceGrowRadii(fh, growPct)
  const model = fitSkinModel(rgb, width, runs)
  if (!model) return
  const wx0 = Math.max(0, box.left - radius)
  const wx1 = Math.min(width, box.right + radius)
  const wy0 = box.top
  const wy1 = Math.min(height, box.bottom + 1 + radius)
  const w = wx1 - wx0, h = wy1 - wy0
  const tops = columnTops(runs, wx0, w, box)
  // Beyond the band the grow takes skin only from the face's lower half: the jaw, the cheeks' sides, the neck.
  const lowerHalf = box.top + fh / 2
  const k = faceGrowStep(w * h)
  const gw = Math.ceil(w / k), gh = Math.ceil(h / k)
  const sx = (gx: number) => Math.min(w - 1, gx * k + (k >> 1))
  const sy = (gy: number) => Math.min(h - 1, gy * k + (k >> 1))
  const inside = new Uint8Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) inside[gy * gw + gx] = parts.orig[(sy(gy) + wy0) * width + sx(gx) + wx0]!
  }
  const dist = squaredDistanceToRegion(inside, gw, gh)
  const r2 = radius * radius, b2 = band * band, k2 = k * k
  const skin = new Float64Array(gw * gh)
  const candidate = new Uint8Array(gw * gh)
  const reachG = new Uint8Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx
      if (inside[i]) { candidate[i] = 1; continue }
      const d2 = dist[i]! * k2
      const x = sx(gx), y = sy(gy) + wy0
      if (d2 > r2 || y < tops[x]!) continue
      reachG[i] = 1
      const p = 3 * (y * width + x + wx0)
      skin[i] = skinDistance2(model, rgb[p]!, rgb[p + 1]!, rgb[p + 2]!)
      if (d2 <= b2 || (skin[i]! <= FACE_GROW_SKIN_D2 && y >= lowerHalf)) candidate[i] = 1
    }
  }
  // Only what joins the face (8-connected), from its own pixels outwards.
  const reached = new Uint8Array(gw * gh)
  const stack = new Int32Array(gw * gh)
  let top = 0
  for (let i = 0; i < gw * gh; i++) if (inside[i]) { reached[i] = 1; stack[top++] = i }
  while (top > 0) {
    const i = stack[--top]!
    const y = Math.floor(i / gw), x = i - y * gw
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx
        if (yy < 0 || yy >= gh || xx < 0 || xx >= gw) continue
        const j = yy * gw + xx
        if (!reached[j] && candidate[j]) { reached[j] = 1; stack[top++] = j }
      }
    }
  }
  const closed = morph3(morph3(reached, gw, gh, true), gw, gh, false)
  const sel = new Uint8Array(gw * gh)
  for (let i = 0; i < gw * gh; i++) {
    if (inside[i] || !(closed[i] || reached[i]) || !reachG[i]) continue
    const d2 = dist[i]! * k2
    // The close only ever adds, held to the rules: beyond the band, only the lower half, and never far from the skin.
    if (!reached[i] && d2 > b2 && (sy(Math.floor(i / gw)) + wy0 < lowerHalf || skin[i]! > FACE_GROW_NOT_SKIN_D2)) continue
    sel[i] = 1
  }
  // Back to full size: each pixel takes its grid cell, held under its own column's top.
  for (let y = wy0; y < wy1; y++) {
    const gy = Math.min(gh - 1, Math.floor((y - wy0) / k))
    for (let x = wx0; x < wx1; x++) {
      if (y < tops[x - wx0]!) continue
      const g = gy * gw + Math.min(gw - 1, Math.floor((x - wx0) / k))
      const p = y * width + x
      if (reachG[g] || inside[g]) parts.reach[p] = 1
      if (sel[g] && !parts.orig[p]) parts.added[p] = 1
    }
  }
}

/**
 * One frame's grow (the header's rules), before smoothing: the mask decoded, each region grown into `added`, its
 * reach into `reach`. `rgb` is the clip's frame at the mask's size (`width × height × 3`).
 */
export function growFaceMaskFrameParts(rle: string, rgb: Uint8Array, width: number, height: number, growPct: number): FaceGrowFrameParts {
  const pixels = width * height
  const parts: FaceGrowFrameParts = { orig: new Uint8Array(pixels), added: new Uint8Array(pixels), reach: new Uint8Array(pixels), before: 0 }
  if (rle.trim() === "") return parts
  const regions = maskRegionsOf(rle, width, height)
  const perRegion: Run[][] = regions.boxes.map(() => [])
  let before = 0
  for (let i = 0; i < regions.row.length; i++) {
    const run = { row: regions.row[i]!, x0: regions.x0[i]!, x1: regions.x1[i]! }
    perRegion[regions.region[i]!]!.push(run)
    parts.orig.fill(1, run.row * width + run.x0, run.row * width + run.x1)
    before += run.x1 - run.x0
  }
  ;(parts as { before: number }).before = before
  if (!(growPct > 0)) return parts
  if (rgb.length !== pixels * 3) throw new Error(`The clip frame holds ${rgb.length} bytes, not the mask's ${width}×${height}×3.`)
  regions.boxes.forEach((box, r) => growRegion(parts, rgb, width, height, box, perRegion[r]!, growPct))
  return parts
}

/**
 * A frame's grown mask, smoothed over time: the mask as found, plus each pixel added on at least two of this frame
 * and its two neighbours (a frame with no neighbour counts as itself), held within this frame's own reach — so a
 * patch that flickers in for a single frame is left out, and a neighbour never adds past this frame's rules. As
 * Video Mask's RLE, with the pixels covered before and after.
 */
export function combineFaceGrowFrames(
  prev: FaceGrowFrameParts | null,
  cur: FaceGrowFrameParts,
  next: FaceGrowFrameParts | null,
): { readonly rle: string; readonly before: number; readonly after: number } {
  const n = cur.orig.length
  const a = prev?.added ?? cur.added, b = cur.added, c = next?.added ?? cur.added
  const parts: string[] = []
  let after = 0
  let start = -1
  for (let i = 0; i <= n; i++) {
    const on = i < n && (cur.orig[i] === 1 || (cur.reach[i] === 1 && a[i]! + b[i]! + c[i]! >= 2))
    if (on && start < 0) start = i
    else if (!on && start >= 0) {
      parts.push(`${start + 1} ${i - start}`)
      after += i - start
      start = -1
    }
  }
  return { rle: parts.join(" "), before: cur.before, after }
}

/**
 * One frame's face mask grown by `growPct` % of each face's height, alone (no neighbours to smooth with), as Video
 * Mask's RLE, and the pixels it covered before and after. `growPct` 0 (or an empty frame) returns the RLE unchanged
 * — the same string.
 */
export function growFaceMaskFrame(
  rle: string,
  rgb: Uint8Array,
  width: number,
  height: number,
  growPct: number,
): { readonly rle: string; readonly before: number; readonly after: number } {
  if (!(growPct > 0) || rle.trim() === "") {
    const before = rle.trim() === "" ? 0 : growFaceMaskFrameParts(rle, rgb, width, height, 0).before
    return { rle, before, after: before }
  }
  return combineFaceGrowFrames(null, growFaceMaskFrameParts(rle, rgb, width, height, growPct), null)
}
