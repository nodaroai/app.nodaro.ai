/**
 * THE JOB-ONLY FACE DESCRIPTOR (P3.2b round 3, decided 2026-10-08) — pure, no
 * onnxruntime, no I/O.
 *
 * Speaker Frames' linker never links across a gap between kept spans by
 * position: a gap is never decoded, so a cut may hide in it. It relinks a face
 * across a gap only by how the face LOOKS, and only when it is sure. This is
 * the look, computed in core from the 540p proxy frame the detector already
 * decoded (inside the same admission hold), for the boxes of the frames the
 * caller names — the span-edge samples.
 *
 * WHAT IT IS — appearance plus landmarks, deliberately NOT a face embedding
 * (the spec's non-goal stays in force: no learned identity vector, no identity
 * across episodes):
 *  - `luma`: an 8×8 crop of the face's luma, ALIGNED on YuNet's five landmarks
 *    (a least-squares similarity onto the canonical five-point face template),
 *    each cell the mean of a 4×4 bilinear sub-grid, then zero-mean and scaled to
 *    unit length (exposure-invariant) and quantised to signed bytes. Compared by
 *    cosine.
 *  - `hist`: two 64-bin RGB histograms (4 levels per channel), the FACE (its
 *    box) then the region just BELOW it (one box height down, 1.5 box widths
 *    across: collar and clothing), each from a 16×16 grid of samples,
 *    normalised to a total of 255 and quantised to bytes. A region less than
 *    half inside the frame is all zeros: absent, never a sliver's histogram.
 *  Landmark geometry is not repeated here: the caller has the landmarks.
 *
 * LIFETIME. It exists in a `detectFaces` result and the caller's memory for the
 * job, and nowhere else: never stored, never in a checkpoint, never in the
 * output artifact (`normalizeSpeakerTracks` drops it), never across episodes.
 * The guard tests pin each.
 */
import type { YunetFace } from "./yunet-decode.js"

/** Bumped when the layout or the computation changes: a caller compares only equal versions. */
export const FACE_DESCRIPTOR_VERSION = 1 as const
/** The aligned luma crop is this many cells on a side. */
export const FACE_DESCRIPTOR_LUMA_SIDE = 8
/** Bins per region histogram: 4 levels per RGB channel. */
export const FACE_DESCRIPTOR_HIST_BINS = 64

const HIST_LEVELS = 4
/** Samples per side of a region's histogram grid. */
const HIST_GRID = 16
/** Bilinear sub-samples per side of one luma cell. */
const CELL_SUB = 4
/** A region with less of its area than this inside the frame is absent. */
const MIN_REGION_INSIDE = 0.5

/**
 * The canonical five-point face template (the widely used 112 × 112 alignment
 * template, image-left eye first), in the template's own units. YuNet's order
 * is the same: right eye, left eye (the subject's — image-left first), nose
 * tip, right and left mouth corners.
 */
const TEMPLATE_112: ReadonlyArray<readonly [number, number]> = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
]

export interface FaceDescriptor {
  readonly version: typeof FACE_DESCRIPTOR_VERSION
  /** 64 signed bytes, base64: the aligned 8×8 luma crop, row-major. */
  readonly luma: string
  /** 128 bytes, base64: the face's 64-bin RGB histogram, then the region below's. */
  readonly hist: string
}

/** A descriptor's bytes, decoded. */
export interface FaceDescriptorBytes {
  readonly luma: Int8Array
  readonly face: Uint8Array
  readonly below: Uint8Array
}

export function readFaceDescriptor(d: FaceDescriptor): FaceDescriptorBytes {
  const l = Buffer.from(d.luma, "base64")
  const h = Buffer.from(d.hist, "base64")
  return {
    luma: new Int8Array(l.buffer, l.byteOffset, l.length).slice(),
    face: new Uint8Array(h.subarray(0, FACE_DESCRIPTOR_HIST_BINS)),
    below: new Uint8Array(h.subarray(FACE_DESCRIPTOR_HIST_BINS, 2 * FACE_DESCRIPTOR_HIST_BINS)),
  }
}

/**
 * The least-squares similarity (rotation, uniform scale, translation; no
 * reflection) taking `src` onto `dst`: x' = a·x − b·y + tx, y' = b·x + a·y + ty.
 */
function similarity(src: ReadonlyArray<readonly [number, number]>, dst: ReadonlyArray<readonly [number, number]>) {
  const n = src.length
  let sx = 0, sy = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    sx += src[i]![0]; sy += src[i]![1]; dx += dst[i]![0]; dy += dst[i]![1]
  }
  sx /= n; sy /= n; dx /= n; dy /= n
  let num1 = 0, num2 = 0, den = 0
  for (let i = 0; i < n; i++) {
    const px = src[i]![0] - sx, py = src[i]![1] - sy
    const qx = dst[i]![0] - dx, qy = dst[i]![1] - dy
    num1 += px * qx + py * qy
    num2 += px * qy - py * qx
    den += px * px + py * py
  }
  const a = den > 0 ? num1 / den : 0
  const b = den > 0 ? num2 / den : 0
  return { a, b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) }
}

/** Luma of pixel (x, y), clamped to the frame. */
function lumaAt(bgr: Uint8Array, width: number, height: number, x: number, y: number): number {
  const cx = x < 0 ? 0 : x >= width ? width - 1 : x
  const cy = y < 0 ? 0 : y >= height ? height - 1 : y
  const o = (cy * width + cx) * 3
  return 0.114 * bgr[o]! + 0.587 * bgr[o + 1]! + 0.299 * bgr[o + 2]!
}

function bilinearLuma(bgr: Uint8Array, width: number, height: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = x - x0, fy = y - y0
  const a = lumaAt(bgr, width, height, x0, y0), b = lumaAt(bgr, width, height, x0 + 1, y0)
  const c = lumaAt(bgr, width, height, x0, y0 + 1), d = lumaAt(bgr, width, height, x0 + 1, y0 + 1)
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
}

/** The aligned 8×8 luma crop, zero-mean, unit length, as signed bytes. */
function alignedLuma(bgr: Uint8Array, width: number, height: number, face: YunetFace): Int8Array {
  const side = FACE_DESCRIPTOR_LUMA_SIDE
  const px = face.landmarks.map(([lx, ly]) => [lx * width, ly * height] as const)
  // Image → template cells (the template scaled from 112 units to `side` cells), then inverted.
  const t = TEMPLATE_112.map(([x, y]) => [(x * side) / 112, (y * side) / 112] as const)
  const fwd = similarity(px, t)
  const det = fwd.a * fwd.a + fwd.b * fwd.b
  const out = new Int8Array(side * side)
  if (!(det > 0)) return out
  // Inverse of [a −b; b a]: [a b; −b a] / det.
  const ia = fwd.a / det, ib = fwd.b / det
  const cells = new Float64Array(side * side)
  for (let v = 0; v < side; v++) {
    for (let u = 0; u < side; u++) {
      let sum = 0
      for (let j = 0; j < CELL_SUB; j++) {
        for (let i = 0; i < CELL_SUB; i++) {
          const tu = u + (i + 0.5) / CELL_SUB - fwd.tx
          const tv = v + (j + 0.5) / CELL_SUB - fwd.ty
          sum += bilinearLuma(bgr, width, height, ia * tu + ib * tv, -ib * tu + ia * tv)
        }
      }
      cells[v * side + u] = sum / (CELL_SUB * CELL_SUB)
    }
  }
  let mean = 0
  for (const c of cells) mean += c
  mean /= cells.length
  let norm = 0
  for (let k = 0; k < cells.length; k++) {
    cells[k] -= mean
    norm += cells[k]! * cells[k]!
  }
  norm = Math.sqrt(norm)
  // Below a quarter of a grey level of spread there is no pattern to compare.
  if (norm < 0.25 * side) return out
  for (let k = 0; k < cells.length; k++) out[k] = Math.max(-127, Math.min(127, Math.round((cells[k]! / norm) * 127)))
  return out
}

/** A region's 64-bin RGB histogram on a 16×16 sample grid, totalling 255; zeros when mostly outside. */
function regionHist(bgr: Uint8Array, width: number, height: number, x0: number, y0: number, w: number, h: number, out: Uint8Array): void {
  const ix0 = Math.max(0, x0), iy0 = Math.max(0, y0)
  const ix1 = Math.min(width, x0 + w), iy1 = Math.min(height, y0 + h)
  const inside = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0)
  if (!(w > 0 && h > 0) || inside < MIN_REGION_INSIDE * w * h || ix1 - ix0 < 1 || iy1 - iy0 < 1) return
  const counts = new Float64Array(FACE_DESCRIPTOR_HIST_BINS)
  const q = 256 / HIST_LEVELS
  for (let j = 0; j < HIST_GRID; j++) {
    const y = Math.min(height - 1, Math.floor(iy0 + ((j + 0.5) * (iy1 - iy0)) / HIST_GRID))
    for (let i = 0; i < HIST_GRID; i++) {
      const x = Math.min(width - 1, Math.floor(ix0 + ((i + 0.5) * (ix1 - ix0)) / HIST_GRID))
      const o = (y * width + x) * 3
      const r = Math.floor(bgr[o + 2]! / q), g = Math.floor(bgr[o + 1]! / q), b = Math.floor(bgr[o]! / q)
      counts[(r * HIST_LEVELS + g) * HIST_LEVELS + b]++
    }
  }
  const total = HIST_GRID * HIST_GRID
  for (let k = 0; k < counts.length; k++) out[k] = Math.round((counts[k]! * 255) / total)
}

/**
 * The descriptor of `face` in one packed BGR frame of `width × height` (the
 * frame the detector decoded; the face's box and landmarks are fractions of it).
 */
export function faceDescriptor(bgr: Uint8Array, width: number, height: number, face: YunetFace): FaceDescriptor {
  if (bgr.length !== width * height * 3) {
    throw new Error(`face descriptor: a ${bgr.length}-byte buffer is not one ${width}×${height} BGR frame`)
  }
  const luma = alignedLuma(bgr, width, height, face)
  const hist = new Uint8Array(2 * FACE_DESCRIPTOR_HIST_BINS)
  const bx = face.x * width, by = face.y * height, bw = face.w * width, bh = face.h * height
  regionHist(bgr, width, height, bx, by, bw, bh, hist.subarray(0, FACE_DESCRIPTOR_HIST_BINS))
  regionHist(bgr, width, height, bx + bw / 2 - 0.75 * bw, by + bh, 1.5 * bw, bh, hist.subarray(FACE_DESCRIPTOR_HIST_BINS))
  return {
    version: FACE_DESCRIPTOR_VERSION,
    luma: Buffer.from(luma.buffer, luma.byteOffset, luma.byteLength).toString("base64"),
    hist: Buffer.from(hist).toString("base64"),
  }
}
