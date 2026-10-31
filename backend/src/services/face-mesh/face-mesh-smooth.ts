/**
 * Landmarks held steady over time — pure.
 *
 * The model answers each frame on its own, so its points shimmer by a pixel
 * or two from frame to frame. Each point of each face is passed through a
 * one-euro filter (Casiez et al., 2012): a low-pass whose cut-off rises with
 * the point's speed, so a still face is held steady and a moving mouth or a
 * blink still follows at once. Speed is measured in face sizes per second
 * (the face's own size in pixels), so a small face in the back and a close-up
 * are smoothed alike. The parameters are those MediaPipe's own face pipeline
 * smooths its landmarks with.
 *
 * Filters belong to a FACE, not to a detection's place in the list: YuNet
 * answers highest score first, and two people swap places in that order from
 * frame to frame. Each frame's faces are matched to the faces drawn in the
 * frame before by box overlap (greedy, best overlap first); a face with no
 * match starts afresh, and a face not drawn in a frame is forgotten — drawn
 * again later, it starts afresh too (never pulled toward where it was).
 */
import type { FaceBox } from "./face-mesh-filters.js"

export const FACE_MESH_ONE_EURO = {
  /** Hz: the cut-off of a still point. */
  minCutoff: 0.05,
  /** How fast the cut-off rises with speed (per face size per second). */
  beta: 80,
  /** Hz: the cut-off of the speed estimate itself. */
  derivativeCutoff: 1,
} as const

/** Two boxes overlapping less than this are two faces. */
export const FACE_MESH_TRACK_MIN_IOU = 0.3

const alphaOf = (cutoff: number, dt: number): number => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))

/** One value's one-euro filter. */
export class OneEuroFilter {
  private prev: number | undefined
  private prevDerivative = 0

  constructor(
    private readonly minCutoff = FACE_MESH_ONE_EURO.minCutoff,
    private readonly beta = FACE_MESH_ONE_EURO.beta,
    private readonly derivativeCutoff = FACE_MESH_ONE_EURO.derivativeCutoff,
  ) {}

  /** The filtered value of `x`, `dt` seconds after the last one; `scale` is the size speed is measured in. */
  filter(x: number, dt: number, scale = 1): number {
    if (this.prev === undefined || !(dt > 0)) {
      this.prev = x
      return x
    }
    const derivative = (x - this.prev) / dt / (scale > 0 ? scale : 1)
    const ad = alphaOf(this.derivativeCutoff, dt)
    const smoothedDerivative = ad * derivative + (1 - ad) * this.prevDerivative
    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDerivative)
    const a = alphaOf(cutoff, dt)
    const out = a * x + (1 - a) * this.prev
    this.prev = out
    this.prevDerivative = smoothedDerivative
    return out
  }
}

/** Intersection over union of two boxes. */
export function boxIou(a: FaceBox, b: FaceBox): number {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

/** One face found and meshed in a frame: its box (fractions of the frame) and its points (PIXELS of the detection frame). */
export interface MeshedFace {
  readonly box: FaceBox
  /** `[x0, y0, x1, y1, …]`, pixels. */
  readonly points: Float64Array
}

interface Track {
  box: FaceBox
  readonly filters: OneEuroFilter[]
}

/** The faces of a clip, tracked from frame to frame, each point smoothed. */
export class FaceMeshTracker {
  private tracks: Track[] = []
  private readonly dt: number

  constructor(fps: number) {
    this.dt = fps > 0 && Number.isFinite(fps) ? 1 / fps : 1 / 30
  }

  /**
   * This frame's faces (those drawn), each matched to a face drawn in the
   * frame before or started afresh; returns each one's smoothed points, in
   * the input's order. Faces not in `faces` are forgotten.
   */
  next(faces: readonly MeshedFace[]): Float64Array[] {
    const pairs: Array<{ face: number; track: number; iou: number }> = []
    faces.forEach((f, i) =>
      this.tracks.forEach((t, j) => {
        const iou = boxIou(f.box, t.box)
        if (iou >= FACE_MESH_TRACK_MIN_IOU) pairs.push({ face: i, track: j, iou })
      }),
    )
    pairs.sort((a, b) => b.iou - a.iou)
    const trackOf = new Map<number, Track>()
    const taken = new Set<number>()
    for (const p of pairs) {
      if (trackOf.has(p.face) || taken.has(p.track)) continue
      trackOf.set(p.face, this.tracks[p.track]!)
      taken.add(p.track)
    }
    const next: Track[] = []
    const out = faces.map((f, i) => {
      const track = trackOf.get(i) ?? { box: f.box, filters: Array.from({ length: f.points.length }, () => new OneEuroFilter()) }
      track.box = f.box
      next.push(track)
      const scale = faceScale(f.points)
      return f.points.map((v, k) => track.filters[k]!.filter(v, this.dt, scale))
    })
    this.tracks = next
    return out
  }
}

/** The face's size in pixels: the mean of its points' extent across and down. */
export function faceScale(points: ArrayLike<number>): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i]!, y = points[i + 1]!
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return x1 > x0 && y1 > y0 ? (x1 - x0 + (y1 - y0)) / 2 : 1
}
