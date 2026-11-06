import { describe, expect, it } from "vitest"
import { FACE_MESH_VISIBILITY, edgeVisibility } from "../face-mesh-visibility.js"
import { CONTOUR_EDGES } from "../face-mesh-draw.js"
import { FACEMESH_FACE_OVAL, FACEMESH_NOSE } from "../face-mesh-topology.js"
import { turnedFace } from "./face-3d.fixture.js"

const P = FACE_MESH_VISIBILITY.pieces
const OVAL = Uint16Array.from(FACEMESH_FACE_OVAL)
const NOSE = Uint16Array.from(FACEMESH_NOSE)

/** The convex hull of 2D points (monotone chain), counter-clockwise in y-down pixels. */
function hull(points: Float64Array): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  for (let i = 0; i < points.length; i += 2) pts.push([points[i]!, points[i + 1]!])
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Array<[number, number]> = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Array<[number, number]> = []
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** How far inside the face's outline (its points' hull) a point lies, px (0 on it or outside). */
function depthInside(h: Array<[number, number]>, x: number, y: number): number {
  let best = Infinity
  for (let i = 0; i < h.length; i++) {
    const [ax, ay] = h[i]!
    const [bx, by] = h[(i + 1) % h.length]!
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
    best = Math.min(best, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))))
  }
  return best
}

/** Each piece's midpoint, in the edge list's order (`edgeVisibility`'s layout). */
function pieceMidpoints(points: Float64Array, edges: Uint16Array): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e]!, b = edges[e + 1]!
    for (let k = 0; k < P; k++) {
      const t = (k + 0.5) / P
      out.push([points[2 * a]! + (points[2 * b]! - points[2 * a]!) * t, points[2 * a + 1]! + (points[2 * b + 1]! - points[2 * a + 1]!) * t])
    }
  }
  return out
}

describe("edgeVisibility: which pieces of a contour the face itself hides", () => {
  it("one value per piece of each edge, each in [0, 1]", () => {
    const { points, depth } = turnedFace(30)
    const v = edgeVisibility(points, depth, CONTOUR_EDGES)
    expect(v.length).toBe((CONTOUR_EDGES.length / 2) * P)
    for (const x of v) expect(x >= 0 && x <= 1).toBe(true)
  })

  it("a face looking at the camera hides nothing: the whole oval, and every other contour, is drawn", () => {
    const { points, depth } = turnedFace(0)
    expect(Math.min(...edgeVisibility(points, depth, OVAL))).toBeGreaterThan(0.99)
    expect(Math.min(...edgeVisibility(points, depth, CONTOUR_EDGES))).toBeGreaterThan(0.99)
  })

  it.each([30, 45, -45, 60])("a face turned %d°: the oval's far side is hidden, and no piece drawn lies inside the face", (yaw) => {
    const { points, depth } = turnedFace(yaw, { height: 300 })
    const v = edgeVisibility(points, depth, OVAL)
    const mids = pieceMidpoints(points, OVAL)
    const h = hull(points)
    const interior = 0.08 * 300
    // Without the test the far side runs across the face: some of the oval lies well inside its outline.
    expect(mids.some(([x, y]) => depthInside(h, x, y) > interior)).toBe(true)
    // With it, every piece still drawn (at any strength) is on the face's edge.
    mids.forEach(([x, y], i) => {
      if (v[i]! > 0) expect(depthInside(h, x, y), `piece ${i} at ${x.toFixed(0)},${y.toFixed(0)}, drawn at ${v[i]}`).toBeLessThanOrEqual(interior)
    })
    // The near side and the top and bottom are kept: at least half the oval is drawn.
    expect(v.filter((x) => x === 1).length).toBeGreaterThan(v.length / 2)
  })

  it("the far side of the nose is hidden behind it once the face is turned well away", () => {
    const frontal = turnedFace(0)
    expect(Math.min(...edgeVisibility(frontal.points, frontal.depth, NOSE))).toBeGreaterThan(0.99)
    const turned = turnedFace(60)
    const v = edgeVisibility(turned.points, turned.depth, NOSE)
    expect(v.filter((x) => x < 0.5).length).toBeGreaterThan(0)
  })

  it("does not depend on the face's size or place in the frame", () => {
    const small = turnedFace(40, { height: 80, cx: 100, cy: 90 })
    const big = turnedFace(40, { height: 640, cx: 900, cy: 500 })
    const a = edgeVisibility(small.points, small.depth, CONTOUR_EDGES)
    const b = edgeVisibility(big.points, big.depth, CONTOUR_EDGES)
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(1e-4)
  })

  it("is pure: the same face gives the same answer", () => {
    const { points, depth } = turnedFace(35)
    expect(edgeVisibility(points, depth, CONTOUR_EDGES)).toEqual(edgeVisibility(points, depth, CONTOUR_EDGES))
  })

  it("fades as the face turns: a degree of turn moves no piece far (the depth margin, before any smoothing over time)", () => {
    let prev = edgeVisibility(turnedFace(0).points, turnedFace(0).depth, OVAL)
    let worst = 0
    for (let yaw = 0.5; yaw <= 70; yaw += 0.5) {
      const f = turnedFace(yaw, { height: 300 })
      const v = edgeVisibility(f.points, f.depth, OVAL)
      for (let i = 0; i < v.length; i++) worst = Math.max(worst, Math.abs(v[i]! - prev[i]!))
      prev = v
    }
    expect(worst).toBeLessThan(0.5)
  })
})
