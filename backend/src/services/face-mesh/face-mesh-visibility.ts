/**
 * Which parts of a face's lines the face itself hides — pure, no state, no drawing.
 *
 * The landmark model answers all 468 points in 3D, the far side of a turned
 * face included: the oval's far half sits behind the cheek and the nose, and
 * drawn flat it runs ACROSS the face. A line is hidden where the face's own
 * surface is in front of it, so this is a depth test against the mesh (its
 * 852 triangles, `FACEMESH_TRIANGLES`, with the eyes' and the mouth's
 * openings closed, `FACEMESH_OPENINGS`: an eye hides what is behind it as the
 * skin does), done on the points themselves, never on a raster:
 *   - each edge is judged in `pieces` equal pieces, at each piece's midpoint
 *     (its depth between its two ends');
 *   - a triangle hides a point when, as drawn, it holds the point, it faces
 *     the camera, and its depth there (barycentric) is nearer than the
 *     point's by more than a margin: `hiddenFrom` × the face's size, plus the
 *     triangle's own slope × `slopeReach` × the face's size. The slope term
 *     is what keeps the face's OUTLINE drawn: where the mesh turns away from
 *     the camera (the side of a face seen straight on) it folds over itself a
 *     little as drawn, and a slanted triangle there is "in front" of the line
 *     by far more than its distance across the picture; it hides the line
 *     only when it is in front by more than its slope accounts for. A
 *     triangle seen edge-on, or from behind, hides nothing;
 *   - past that margin the point fades out over (`hiddenAt` − `hiddenFrom`) ×
 *     the face's size (a smoothstep), so a line slipping behind the cheek as
 *     the face turns fades rather than pops;
 *   - a piece's visibility is the share of a small disc around it
 *     (`discRadius`, 19 samples at the piece's depth) left unhidden, ramped
 *     from `discDrawn` (drawn whole) to `discGone` (gone): where the cheek or
 *     the nose ENDS on the picture, that edge sweeps over the disc as the
 *     face turns, and the line fades instead of switching.
 * Every length is measured in the face's own size (forehead to chin, in 3D,
 * so it does not shrink as the face turns): the answer is the same whatever
 * the face's size or place, and whichever clip the lines go on.
 *
 * Why a depth test and not a back-face test (a triangle's winding alone):
 * turned away is not the same as hidden. The oval runs along the side of the
 * face, on triangles seen nearly edge-on, which flip with the slightest turn
 * though the line is the face's outline and stays drawn; and part of a face
 * can face the camera yet be behind the nose. Only something IN FRONT of a
 * line hides it.
 *
 * Smoothing over time is the caller's: the points come in already smoothed,
 * and `FaceMeshTracker` low-passes each piece's answer per face.
 */
import { FACEMESH_OPENINGS, FACEMESH_TRIANGLES } from "./face-mesh-topology.js"

export const FACE_MESH_VISIBILITY = {
  /** Each edge is judged, and drawn, in this many equal pieces. */
  pieces: 8,
  /** A piece this far behind the surface in front of it (× the face's size) starts to fade… */
  hiddenFrom: 0.03,
  /** …and is gone at this far. */
  hiddenAt: 0.08,
  /**
   * How far (× the face's size, across the picture) a line may run under the edge of what is in front of it and stay
   * drawn: a triangle in front of a piece must also be in front by its depth's change over this distance (its slope ×
   * this). A slanted triangle's depth runs far over a short distance, so where the mesh slants away (the side of a
   * face seen straight on, its outline) it must be well in front to hide a line, and one seen edge-on hides nothing.
   */
  slopeReach: 0.04,
  /**
   * The disc around a piece (× the face's size) whose share hidden is the piece's: an edge of what is in front of a
   * line (where the cheek or the nose ends, on the picture) sweeps over the disc as the face turns, so the line fades
   * rather than popping. Smaller than the reach: a slanted surface through the piece never hides its own disc.
   */
  discRadius: 0.025,
  /** A piece is drawn whole while at most this share of its disc is hidden… */
  discDrawn: 0.25,
  /** …and gone once this share is. */
  discGone: 0.75,
  /** Hz: the cut-off of the low-pass each piece's visibility is held steady with over time (`FaceMeshTracker`). */
  smoothingCutoffHz: 2,
} as const

/** The forehead's top and the chin's point: the face's size is the distance between them, in 3D. */
const FOREHEAD = 10
const CHIN = 152
/** The triangles are binned on a grid of this many cells a side over the face's box, so a point tests only its cell's. */
const GRID = 16

/** What can hide a line: the mesh's triangles and its openings closed. */
const SURFACE = Uint16Array.from([...FACEMESH_TRIANGLES, ...FACEMESH_OPENINGS])

const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/** The disc's samples, in units of its radius: its centre, a ring of 6 half way out and a ring of 12 on its edge. */
const DISC: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  ...Array.from({ length: 6 }, (_, i) => [0.5 * Math.cos((Math.PI * i) / 3), 0.5 * Math.sin((Math.PI * i) / 3)] as const),
  ...Array.from({ length: 12 }, (_, i) => [Math.cos((Math.PI * (i + 0.5)) / 6), Math.sin((Math.PI * (i + 0.5)) / 6)] as const),
]

/**
 * Each piece's visibility (1 drawn, 0 hidden), `pieces` per edge of `edges`
 * (`[a0, b0, a1, b1, …]`), in their order: `[edge 0 piece 0, …, edge 0 piece
 * pieces − 1, edge 1 piece 0, …]`. `points` are the face's 468 points
 * `[x0, y0, …]` and `depth` their depths, in the same units (pixels of the
 * frame they were found in; smaller = nearer the camera, the model's own
 * convention).
 */
export function edgeVisibility(
  points: ArrayLike<number>,
  depth: ArrayLike<number>,
  edges: ArrayLike<number>,
  pieces: number = FACE_MESH_VISIBILITY.pieces,
): Float32Array {
  const V = FACE_MESH_VISIBILITY
  const out = new Float32Array((edges.length >> 1) * pieces).fill(1)
  const size = Math.hypot(
    points[2 * CHIN]! - points[2 * FOREHEAD]!,
    points[2 * CHIN + 1]! - points[2 * FOREHEAD + 1]!,
    depth[CHIN]! - depth[FOREHEAD]!,
  )
  if (!(size > 0)) return out
  const from = V.hiddenFrom * size
  const span = (V.hiddenAt - V.hiddenFrom) * size
  const reach = V.slopeReach * size
  const disc = V.discRadius * size

  // Each triangle once: how far in front it must be to hide anything (its slope × the reach; Infinity seen edge-on or
  // from behind), and what its barycentric weights need.
  const T = SURFACE
  const n = T.length / 3
  const bias = new Float64Array(n)
  const bary = new Float64Array(7 * n)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i + 1 < points.length; i += 2) {
    x0 = Math.min(x0, points[i]!)
    x1 = Math.max(x1, points[i]!)
    y0 = Math.min(y0, points[i + 1]!)
    y1 = Math.max(y1, points[i + 1]!)
  }
  for (let t = 0; t < n; t++) {
    const a = T[3 * t]!, b = T[3 * t + 1]!, c = T[3 * t + 2]!
    const ax = points[2 * a]!, ay = points[2 * a + 1]!
    const bx = points[2 * b]!, by = points[2 * b + 1]!
    const cx = points[2 * c]!, cy = points[2 * c + 1]!
    // w_a = ((by − cy)(x − cx) + (cx − bx)(y − cy)) / d, w_b = ((cy − ay)(x − cx) + (ax − cx)(y − cy)) / d; d is
    // twice the drawn triangle's signed area, NEGATIVE for a triangle facing the camera (the mesh's winding, y down),
    // so −d over twice its area in 3D is its unit normal's z toward the camera.
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    const ux = bx - ax, uy = by - ay, uz = depth[b]! - depth[a]!
    const vx = cx - ax, vy = cy - ay, vz = depth[c]! - depth[a]!
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
    // Its unit normal's z toward the camera, and its depth's slope across the picture, tan of its tilt: √(1 − nz²) / nz.
    const nz = area > 0 ? -d / area : 0
    bias[t] = nz > 1e-6 ? from + (reach * Math.sqrt(Math.max(0, 1 - nz * nz))) / nz : Infinity
    bary[7 * t] = d
    bary[7 * t + 1] = by - cy
    bary[7 * t + 2] = cx - bx
    bary[7 * t + 3] = cy - ay
    bary[7 * t + 4] = ax - cx
    bary[7 * t + 5] = cx
    bary[7 * t + 6] = cy
  }

  // The triangles that can hide anything, binned by the cells their boxes touch (a cell's list: `cells[start[i]…start[i + 1]]`).
  const cw = (x1 - x0) / GRID || 1
  const ch = (y1 - y0) / GRID || 1
  const cellOf = (v: number, lo: number, step: number) => Math.min(GRID - 1, Math.max(0, Math.floor((v - lo) / step)))
  const spans: number[] = []
  const count = new Int32Array(GRID * GRID + 1)
  for (let t = 0; t < n; t++) {
    if (bias[t] === Infinity) continue
    const xs = [points[2 * T[3 * t]!]!, points[2 * T[3 * t + 1]!]!, points[2 * T[3 * t + 2]!]!]
    const ys = [points[2 * T[3 * t]! + 1]!, points[2 * T[3 * t + 1]! + 1]!, points[2 * T[3 * t + 2]! + 1]!]
    const gx0 = cellOf(Math.min(...xs), x0, cw), gx1 = cellOf(Math.max(...xs), x0, cw)
    const gy0 = cellOf(Math.min(...ys), y0, ch), gy1 = cellOf(Math.max(...ys), y0, ch)
    spans.push(t, gx0, gx1, gy0, gy1)
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) count[gy * GRID + gx + 1]!++
  }
  for (let i = 1; i <= GRID * GRID; i++) count[i]! += count[i - 1]!
  const start = Int32Array.from(count)
  const cells = new Int32Array(count[GRID * GRID]!)
  const fill = Int32Array.from(count)
  for (let i = 0; i < spans.length; i += 5) {
    for (let gy = spans[i + 3]!; gy <= spans[i + 4]!; gy++) {
      for (let gx = spans[i + 1]!; gx <= spans[i + 2]!; gx++) cells[fill[gy * GRID + gx]!++] = spans[i]!
    }
  }

  /** How hidden a point of depth `z` at (x, y) is: the most any triangle over it, in front of it, hides it. */
  const hiddenAt = (x: number, y: number, z: number): number => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return 0
    const cell = cellOf(y, y0, ch) * GRID + cellOf(x, x0, cw)
    let hidden = 0
    for (let i = start[cell]!; i < start[cell + 1]! && hidden < 1; i++) {
      const t = cells[i]!
      const d = bary[7 * t]!
      const dx = x - bary[7 * t + 5]!, dy = y - bary[7 * t + 6]!
      const wp = (bary[7 * t + 1]! * dx + bary[7 * t + 2]! * dy) / d
      const wq = (bary[7 * t + 3]! * dx + bary[7 * t + 4]! * dy) / d
      const wr = 1 - wp - wq
      if (wp < 0 || wq < 0 || wr < 0) continue
      const zt = wp * depth[T[3 * t]!]! + wq * depth[T[3 * t + 1]!]! + wr * depth[T[3 * t + 2]!]!
      const h = smoothstep((z - zt - bias[t]!) / span)
      if (h > hidden) hidden = h
    }
    return hidden
  }

  for (let e = 0, o = 0; e + 1 < edges.length; e += 2) {
    const a = edges[e]!, b = edges[e + 1]!
    for (let k = 0; k < pieces; k++, o++) {
      const s = (k + 0.5) / pieces
      const x = points[2 * a]! + (points[2 * b]! - points[2 * a]!) * s
      const y = points[2 * a + 1]! + (points[2 * b + 1]! - points[2 * a + 1]!) * s
      const z = depth[a]! + (depth[b]! - depth[a]!) * s
      let sum = 0
      for (const [dx, dy] of DISC) sum += hiddenAt(x + disc * dx, y + disc * dy, z)
      out[o] = 1 - Math.min(1, Math.max(0, (sum / DISC.length - V.discDrawn) / (V.discGone - V.discDrawn)))
    }
  }
  return out
}
