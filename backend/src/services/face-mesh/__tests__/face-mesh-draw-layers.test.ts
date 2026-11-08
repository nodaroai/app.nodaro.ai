import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { VIDEO_FACE_MESH_PARTS, videoFaceMeshLayersOfParts } from "@nodaro/shared/media"
import { CONTOUR_FADE_LEVELS, FACE_MESH_STYLE, compositeFaceMesh, faceMeshOverlay, lineTone } from "../face-mesh-draw.js"
import { MESH_EDGES, layerSetOf, outlineEdgesOf, visibilityLayoutOf, visibilityOfLayout } from "../face-mesh-layers.js"
import { FACE_MESH_IRISES, FACE_MESH_POINTS_WITH_IRISES } from "../face-mesh-irises.js"
import { FACE_MESH_VISIBILITY, edgeVisibility } from "../face-mesh-visibility.js"
import { FACEMESH_FACE_OVAL, FACEMESH_LEFT_EYE, FACEMESH_LIPS, FACEMESH_RIGHT_EYE } from "../face-mesh-topology.js"
import { turnedFace } from "./face-3d.fixture.js"

const W = 1280
const H = 720
const P = FACE_MESH_VISIBILITY.pieces
const frac = (p: Float64Array, w = W, h = H) => p.map((v, i) => v / (i % 2 === 0 ? w : h))
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16)
const segments = (svg: string) => (svg.match(/M/g) ?? []).length
const gray = (v = 160) => Buffer.alloc(W * H * 3, v)
/**
 * Where two frames first differ, -1 when they are the same bytes (a length
 * that differs counts too). Not `toEqual`: vitest walks a Buffer a byte at a
 * time, about 3 s for a pair of these 2.7 MB frames; `equals` compares them
 * natively.
 */
function firstDifference(a: Buffer, b: Buffer): number {
  if (a.equals(b)) return -1
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
  return n
}

/** A face's 468 points with the irises' 10 after them: each centre in the middle of its eye, its rim `r` px round it. */
function withIrises(points: Float64Array, r = 6): Float64Array {
  const out = new Float64Array(FACE_MESH_POINTS_WITH_IRISES * 2)
  out.set(points, 0)
  for (const iris of [FACE_MESH_IRISES.right, FACE_MESH_IRISES.left]) {
    const cx = iris.opening.reduce((s, p) => s + points[2 * p]!, 0) / iris.opening.length
    const cy = iris.opening.reduce((s, p) => s + points[2 * p + 1]!, 0) / iris.opening.length
    out[2 * iris.centre] = cx
    out[2 * iris.centre + 1] = cy
    iris.rim.forEach((p, k) => {
      out[2 * p] = cx + r * Math.cos((k * Math.PI) / 2)
      out[2 * p + 1] = cy + r * Math.sin((k * Math.PI) / 2)
    })
  }
  return out
}

describe("every parts value drawn as its layers is that value's drawing, byte for byte", { timeout: 30_000 }, () => {
  const cases: Array<[string, () => Float64Array[]]> = [
    ["frontal", () => [frac(turnedFace(0, { height: 300 }).points)]],
    ["turned", () => [frac(turnedFace(40, { height: 300 }).points), frac(turnedFace(-25, { height: 120, cx: 300 }).points)]],
  ]
  for (const [name, faces] of cases) {
    for (const parts of VIDEO_FACE_MESH_PARTS) {
      it(`${name} ${parts}`, async () => {
        const byParts = faceMeshOverlay(faces(), W, H, parts)!
        const byLayers = faceMeshOverlay(faces(), W, H, { layers: videoFaceMeshLayersOfParts(parts) })!
        expect(byLayers).toEqual(byParts)
        const [fromLayers, fromParts] = [await compositeFaceMesh(gray(), W, H, byLayers), await compositeFaceMesh(gray(), W, H, byParts)]
        expect(firstDifference(fromLayers, fromParts), "the first byte that differs").toBe(-1)
      })
    }
  }

  it("the contours' visibility too: the contours' own layout is the contours' edges, read the same", () => {
    const t = turnedFace(40, { height: 300 })
    const layout = visibilityLayoutOf(layerSetOf("contours"))
    expect(Array.from(layout.edges)).toEqual(Array.from(outlineEdgesOf(layerSetOf("contours"))))
    expect(layout.meshPointsFrom).toBeUndefined()
    const vis = visibilityOfLayout(t.points, t.depth, layout)
    expect(vis).toEqual(edgeVisibility(t.points, t.depth, outlineEdgesOf(layerSetOf("contours"))))
    const byParts = faceMeshOverlay([frac(t.points)], W, H, "contours", [vis])!
    expect(byParts.fadedSvgs?.length).toBeGreaterThan(0)
    expect(faceMeshOverlay([frac(t.points)], W, H, { layers: { lips: true, eyes: true, contours: true } }, [vis])).toEqual(byParts)
  })
})

describe("each layer on its own", { timeout: 30_000 }, () => {
  const face = () => [frac(turnedFace(0, { height: 300 }).points)]
  const lips = FACEMESH_LIPS.length / 2
  const eyes = (FACEMESH_LEFT_EYE.length + FACEMESH_RIGHT_EYE.length) / 2

  it("the wireframe alone: its edges, no outline", () => {
    const o = faceMeshOverlay(face(), W, H, { layers: { wireframe: true } })!
    expect(segments(o.meshSvg)).toBe(MESH_EDGES.length / 2)
    expect(segments(o.outlineSvg)).toBe(0)
  })

  it("the eyes alone and the lips alone: their own outlines, in the outlines' width", () => {
    const full = faceMeshOverlay(face(), W, H, "full")!
    const e = faceMeshOverlay(face(), W, H, { layers: { eyes: true } })!
    const l = faceMeshOverlay(face(), W, H, { layers: { lips: true } })!
    expect([e.meshSvg, l.meshSvg]).toEqual(["", ""])
    expect(segments(e.outlineSvg)).toBe(eyes)
    expect(segments(l.outlineSvg)).toBe(lips)
    const width = (svg: string) => svg.match(/stroke-width="([^"]*)"/)![1]
    expect(width(e.outlineSvg)).toBe(width(full.outlineSvg))
    expect([e.left, e.top, e.width, e.height]).toEqual([full.left, full.top, full.width, full.height])
  })

  it("the contours alone: the oval, the brows and the nose, without the eyes and the lips", () => {
    const o = faceMeshOverlay(face(), W, H, { layers: { contours: true } })!
    const all = faceMeshOverlay(face(), W, H, "contours")!
    expect(segments(o.outlineSvg)).toBe(segments(all.outlineSvg) - lips - eyes)
    expect(segments(o.outlineSvg)).toBeGreaterThan(FACEMESH_FACE_OVAL.length / 2)
  })

  it("the contours off: a visibility is never read, whatever else is drawn", () => {
    const hidden = [new Float32Array(10_000)]
    for (const layers of [{ wireframe: true, eyes: true }, { lips: true, irises: true }]) {
      const f = [withIrises(turnedFace(0, { height: 300 }).points)].map((p) => frac(p))
      expect(faceMeshOverlay(f, W, H, { layers }, hidden)).toEqual(faceMeshOverlay(f, W, H, { layers }))
    }
  })
})

describe("the irises", { timeout: 30_000 }, () => {
  const face = () => [frac(withIrises(turnedFace(0, { height: 300 }).points))]

  it("a circle and a centre dot per eye, each clipped to the eye's opening", () => {
    const o = faceMeshOverlay(face(), W, H, { layers: { irises: true } })!
    expect(o.meshSvg).toBe("")
    expect(o.outlineSvg.match(/<clipPath /g)).toHaveLength(2)
    expect(o.outlineSvg.match(/<circle /g)).toHaveLength(4)
    expect(o.outlineSvg.match(/clip-path="url\(#iris-0-(left|right)\)"/g)).toHaveLength(2)
    // The circle's radius is the rim's (6 px); the dot is filled.
    expect(o.outlineSvg).toMatch(/<circle cx="[^"]+" cy="[^"]+" r="6" stroke-width="[^"]+"\/>/)
    expect(o.outlineSvg).toMatch(/fill="#FFFFFF" stroke="none"/)
    expect(sha(o.outlineSvg)).toBe(sha(faceMeshOverlay(face(), W, H, { layers: { irises: true } })!.outlineSvg))
  })

  it("the box and the widths are the face's 468 points', the irises' or not", () => {
    const plain = faceMeshOverlay([frac(turnedFace(0, { height: 300 }).points)], W, H, "full")!
    const o = faceMeshOverlay(face(), W, H, { layers: { wireframe: true, eyes: true, lips: true, irises: true } })!
    expect([o.left, o.top, o.width, o.height]).toEqual([plain.left, plain.top, plain.width, plain.height])
    expect(o.meshSvg).toBe(plain.meshSvg)
  })

  it("a face without the irises' points draws none (and nothing else changes)", () => {
    const f = [frac(turnedFace(0, { height: 300 }).points)]
    const o = faceMeshOverlay(f, W, H, { layers: { eyes: true, irises: true } })!
    expect(o.outlineSvg).not.toMatch(/circle/)
    expect(o.outlineSvg).toBe(faceMeshOverlay(f, W, H, { layers: { eyes: true } })!.outlineSvg)
  })

  it("an iris is drawn inside its eye only: a shut eye (its opening flat) draws nothing of it", async () => {
    const pts = withIrises(turnedFace(0, { height: 300 }).points)
    const shut = Float64Array.from(pts)
    // Every point of both eyes' outlines on one line: no opening.
    for (const iris of [FACE_MESH_IRISES.left, FACE_MESH_IRISES.right]) for (const p of iris.opening) shut[2 * p + 1] = pts[2 * iris.centre + 1]!
    const open = await compositeFaceMesh(gray(), W, H, faceMeshOverlay([frac(pts)], W, H, { layers: { irises: true } })!)
    const closed = await compositeFaceMesh(gray(), W, H, faceMeshOverlay([frac(shut)], W, H, { layers: { irises: true } })!)
    const changed = (b: Buffer) => b.reduce((n, v) => n + (v !== 160 ? 1 : 0), 0)
    expect(changed(open)).toBeGreaterThan(100)
    expect(changed(closed)).toBe(0)
  })

  it("with the contours on, an iris fades with its eye: hidden with it, faint with it", () => {
    const set = layerSetOf({ layers: { irises: true, contours: true } })
    const layout = visibilityLayoutOf(set)
    const n = (layout.edges.length / 2) * P
    const left = layout.leftIris!
    const vis = new Float32Array(n).fill(1)
    vis.fill(0, left[0] * P, left[1] * P)
    const o = faceMeshOverlay(face(), W, H, { layers: { irises: true, contours: true } }, [vis])!
    expect(o.outlineSvg).toMatch(/iris-0-right/)
    expect(o.outlineSvg).not.toMatch(/iris-0-left/)
    vis.fill(0.5, left[0] * P, left[1] * P)
    const faint = faceMeshOverlay(face(), W, H, { layers: { irises: true, contours: true } }, [vis])!
    expect(faint.outlineSvg).not.toMatch(/iris-0-left/)
    expect(faint.fadedSvgs?.find((f) => f.alpha === 0.5)?.svg).toMatch(/iris-0-left/)
  })
})

describe("bold lines", { timeout: 30_000 }, () => {
  const face = () => [frac(turnedFace(0, { height: 300 }).points)]

  it("twice as wide, the box widened to hold them; the same edges", () => {
    const plain = faceMeshOverlay(face(), W, H, "full")!
    const bold = faceMeshOverlay(face(), W, H, { layers: { wireframe: true, eyes: true, lips: true, bold: true } })!
    const widths = (svg: string) => [...svg.matchAll(/stroke-width="([^"]*)"/g)].map((m) => Number(m[1]))
    expect(widths(bold.meshSvg)).toEqual(widths(plain.meshSvg).map((w) => w * FACE_MESH_STYLE.bold.widthScale))
    expect(widths(bold.outlineSvg)).toEqual(widths(plain.outlineSvg).map((w) => w * FACE_MESH_STYLE.bold.widthScale))
    expect(segments(bold.meshSvg)).toBe(segments(plain.meshSvg))
    expect(bold.bold).toBe(true)
    expect(plain.bold).toBeUndefined()
    expect(bold.width).toBeGreaterThan(plain.width)
    expect(bold.left).toBeLessThan(plain.left)
  })

  it("deeper tones than the usual ones, on a bright pixel and a near-black one", () => {
    for (const l of [200, 120, 40]) {
      expect(lineTone(l, FACE_MESH_STYLE.bold.mesh)).toBeLessThan(lineTone(l, FACE_MESH_STYLE.mesh))
      expect(lineTone(l, FACE_MESH_STYLE.bold.outline)).toBeLessThan(lineTone(l, FACE_MESH_STYLE.outline))
    }
    expect(lineTone(4, FACE_MESH_STYLE.bold.outline)).toBeGreaterThan(lineTone(4, FACE_MESH_STYLE.outline))
  })

  it("a bold line is darker on the frame, and covers more of it", async () => {
    const plain = await compositeFaceMesh(gray(), W, H, faceMeshOverlay(face(), W, H, { layers: { eyes: true, lips: true } })!)
    const bold = await compositeFaceMesh(gray(), W, H, faceMeshOverlay(face(), W, H, { layers: { eyes: true, lips: true, bold: true } })!)
    const stats = (b: Buffer) => ({ covered: b.reduce((n, v) => n + (v < 150 ? 1 : 0), 0), min: b.reduce((m, v) => Math.min(m, v), 255) })
    expect(stats(bold).covered).toBeGreaterThan(stats(plain).covered * 1.5)
    expect(stats(bold).min).toBeLessThan(stats(plain).min)
  })
})

describe("the wireframe with the contours on: it leaves out what the face hides, point by point", { timeout: 30_000 }, () => {
  const layers = { wireframe: true, contours: true } as const
  const t = () => turnedFace(45, { height: 300 })

  it("a turned face: part of its wireframe hidden or fading, the near side whole", () => {
    const layout = visibilityLayoutOf(layerSetOf({ layers }))
    expect(layout.meshPointsFrom).toBe((layout.edges.length / 2) * P)
    const vis = visibilityOfLayout(t().points, t().depth, layout)
    expect(vis).toHaveLength(layout.meshPointsFrom! + 468)
    const o = faceMeshOverlay([frac(t().points)], W, H, { layers }, [vis])!
    const whole = faceMeshOverlay([frac(t().points)], W, H, { layers })!
    const faint = (o.meshFadedSvgs ?? []).reduce((n, f) => n + segments(f.svg), 0)
    expect(segments(o.meshSvg)).toBeLessThan(segments(whole.meshSvg))
    expect(segments(o.meshSvg)).toBeGreaterThan(segments(whole.meshSvg) / 2)
    expect(segments(o.meshSvg) + faint).toBeLessThanOrEqual(segments(whole.meshSvg))
  })

  it("every point visible: the whole wireframe, nothing faint", () => {
    const layout = visibilityLayoutOf(layerSetOf({ layers }))
    const vis = new Float32Array(layout.meshPointsFrom! + 468).fill(1)
    const o = faceMeshOverlay([frac(t().points)], W, H, { layers }, [vis])!
    expect(o.meshSvg).toBe(faceMeshOverlay([frac(t().points)], W, H, { layers })!.meshSvg)
    expect(o.meshFadedSvgs).toBeUndefined()
  })

  it(`an edge takes the less visible of its two points' strength (${CONTOUR_FADE_LEVELS} levels)`, () => {
    const layout = visibilityLayoutOf(layerSetOf({ layers }))
    const vis = new Float32Array(layout.meshPointsFrom! + 468).fill(1)
    const [a] = MESH_EDGES
    vis[layout.meshPointsFrom! + a!] = 0.5
    const o = faceMeshOverlay([frac(t().points)], W, H, { layers }, [vis])!
    const edgesOfA = Array.from({ length: MESH_EDGES.length / 2 }, (_, e) => e).filter((e) => MESH_EDGES[2 * e] === a || MESH_EDGES[2 * e + 1] === a).length
    expect(o.meshFadedSvgs).toHaveLength(1)
    expect(o.meshFadedSvgs![0]!.alpha).toBe(0.5)
    expect(segments(o.meshFadedSvgs![0]!.svg)).toBe(edgesOfA)
  })

  it("faded wireframe pieces are toned in the wireframe's tone, not the outlines'", async () => {
    const layout = visibilityLayoutOf(layerSetOf({ layers: { wireframe: true, contours: true } }))
    const vis = new Float32Array(layout.meshPointsFrom! + 468).fill(1)
    const whole = await compositeFaceMesh(gray(), W, H, faceMeshOverlay([frac(t().points)], W, H, { layers: { wireframe: true } })!)
    const darkest = whole.reduce((m, v) => Math.min(m, v), 255)
    expect(darkest).toBeGreaterThanOrEqual(Math.floor(lineTone(160, FACE_MESH_STYLE.mesh)) - 1)
    const all = await compositeFaceMesh(gray(), W, H, faceMeshOverlay([frac(t().points)], W, H, { layers: { wireframe: true, contours: true } }, [vis])!)
    expect(all.reduce((m, v) => Math.min(m, v), 255)).toBeLessThan(darkest)
  })
})
