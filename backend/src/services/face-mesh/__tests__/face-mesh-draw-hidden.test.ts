import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { CONTOUR_EDGES, CONTOUR_FADE_LEVELS, compositeFaceMesh, faceMeshOverlay } from "../face-mesh-draw.js"
import { FACE_MESH_VISIBILITY, edgeVisibility } from "../face-mesh-visibility.js"
import { FACEMESH_FACE_OVAL } from "../face-mesh-topology.js"
import { FACE_MESH_POINTS } from "../face-mesh-model.js"
import { turnedFace } from "./face-3d.fixture.js"

const P = FACE_MESH_VISIBILITY.pieces
const EDGES = CONTOUR_EDGES.length / 2
/** Where the oval's 36 edges sit in the contours' list: after the eye and lip outlines' 72. */
const OVAL_FROM = 72
const OVAL_TO = OVAL_FROM + FACEMESH_FACE_OVAL.length / 2

/** 468 points spread on a grid inside [x0, x0 + w] × [y0, y0 + h] (fractions). */
function grid(x0: number, y0: number, w: number, h: number): Float64Array {
  const out = new Float64Array(FACE_MESH_POINTS * 2)
  for (let i = 0; i < FACE_MESH_POINTS; i++) {
    out[2 * i] = x0 + ((i % 22) / 21) * w
    out[2 * i + 1] = y0 + (Math.floor(i / 22) / 21) * h
  }
  return out
}

const frac = (p: Float64Array, w: number, h: number) => p.map((v, i) => v / (i % 2 === 0 ? w : h))
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16)
const segments = (svg: string) => (svg.match(/M/g) ?? []).length
const allVisible = () => new Float32Array(EDGES * P).fill(1)

/** A visibility with the edges `from`…`to` (contour edge indices) at `v`, the rest drawn. */
function visibleBut(from: number, to: number, v: number): Float32Array {
  const out = allVisible()
  out.fill(v, from * P, to * P)
  return out
}

/** A packed RGB frame of one gray. */
const gray = (w: number, h: number, v = 160) => Buffer.alloc(w * h * 3, v)

describe("the other parts are drawn exactly as before (pinned on the code before the hidden sides were taken out)", () => {
  // The SVGs' sha256 (first 16 hex) for each case, recorded on origin/dev before this change.
  const cases: Array<[string, () => Float64Array[], number, number]> = [
    ["grid", () => [grid(0.3, 0.2, 0.4, 0.6)], 200, 100],
    ["frontal", () => [frac(turnedFace(0, { height: 300 }).points, 1280, 720)], 1280, 720],
    ["turned", () => [frac(turnedFace(40, { height: 300 }).points, 1280, 720), frac(turnedFace(-25, { height: 120, cx: 300 }).points, 1280, 720)], 1280, 720],
  ]
  const pins: Record<string, [string, string, string]> = {
    "grid full": ["13e545e919dbf8eb", "e95340e22b2ebf9f", "57,17,86,66"],
    "grid features": ["e3b0c44298fc1c14", "e95340e22b2ebf9f", "57,17,86,66"],
    "grid mouth": ["e3b0c44298fc1c14", "36adba732ba554cd", "57,17,86,66"],
    "grid contours": ["e3b0c44298fc1c14", "f06f6a13b2b17bfc", "57,17,86,66"],
    "frontal full": ["63d04fdad3e2f283", "efb47dc2698e2ff1", "497,201,280,309"],
    "frontal features": ["e3b0c44298fc1c14", "efb47dc2698e2ff1", "497,201,280,309"],
    "frontal mouth": ["e3b0c44298fc1c14", "ad417b88b6b2b29f", "497,201,280,309"],
    "frontal contours": ["e3b0c44298fc1c14", "aedacbacab0cc1a6", "497,201,280,309"],
    "turned full": ["e23708cf004cf749", "0857db9b90b5f4c7", "257,201,456,309"],
    "turned features": ["e3b0c44298fc1c14", "0857db9b90b5f4c7", "257,201,456,309"],
    "turned mouth": ["e3b0c44298fc1c14", "3515b2cd51a8f114", "257,201,456,309"],
    "turned contours": ["e3b0c44298fc1c14", "93f3729527360823", "257,201,456,309"],
  }
  for (const [name, faces, w, h] of cases) {
    for (const parts of ["full", "features", "mouth", "contours"] as const) {
      it(`${name} ${parts}${parts === "contours" ? " (no visibility given)" : ", with or without a visibility"}`, () => {
        const want = pins[`${name} ${parts}`]!
        const withNone = faceMeshOverlay(faces(), w, h, parts)!
        expect([sha(withNone.meshSvg), sha(withNone.outlineSvg), `${withNone.left},${withNone.top},${withNone.width},${withNone.height}`]).toEqual(want)
        expect(withNone.fadedSvgs).toBeUndefined()
        if (parts !== "contours") {
          // A visibility is the contours' alone: any other part ignores it.
          const hidden = faces().map(() => new Float32Array(EDGES * P))
          expect(faceMeshOverlay(faces(), w, h, parts, hidden)).toEqual(withNone)
        }
      })
    }
  }
})

describe('"contours" with a visibility: hidden pieces left out, fading pieces drawn fainter', () => {
  const W = 1280
  const H = 720
  const faces = () => [frac(turnedFace(40, { height: 300 }).points, W, H)]

  it("everything visible: exactly the contours of before", () => {
    expect(faceMeshOverlay(faces(), W, H, "contours", [allVisible()])).toEqual(faceMeshOverlay(faces(), W, H, "contours"))
    // A face with no visibility given beside one with: the first drawn whole.
    const two = [...faces(), frac(turnedFace(0, { height: 120, cx: 200 }).points, W, H)]
    expect(faceMeshOverlay(two, W, H, "contours", [undefined, allVisible()])).toEqual(faceMeshOverlay(two, W, H, "contours"))
  })

  it("a hidden edge is not drawn: the oval hidden, its 36 segments gone, nothing faint", () => {
    const o = faceMeshOverlay(faces(), W, H, "contours", [visibleBut(OVAL_FROM, OVAL_TO, 0)])!
    expect(segments(o.outlineSvg)).toBe(EDGES - 36)
    expect(o.fadedSvgs).toBeUndefined()
    // The box and the widths are worked out from every point, as before.
    const all = faceMeshOverlay(faces(), W, H, "contours")!
    expect([o.left, o.top, o.width, o.height]).toEqual([all.left, all.top, all.width, all.height])
    expect(o.outlineSvg.match(/stroke-width="[^"]*"/)![0]).toBe(all.outlineSvg.match(/stroke-width="[^"]*"/)![0])
  })

  it("an edge hidden from half way: drawn to its middle, whole pieces kept in one segment", () => {
    const v = allVisible()
    const e = OVAL_FROM // the oval's first edge, 10 → 338
    v.fill(0, e * P + P / 2, (e + 1) * P)
    const o = faceMeshOverlay(faces(), W, H, "contours", [v])!
    expect(segments(o.outlineSvg)).toBe(EDGES)
    const px = faces()[0]!
    const mid = [((px[20]! + px[676]!) / 2) * W, ((px[21]! + px[677]!) / 2) * H] // points 10 and 338
    const r1 = (n: number) => (Math.round(n * 10) / 10).toString()
    expect(o.outlineSvg).toContain(`L${r1(mid[0]! - o.left)} ${r1(mid[1]! - o.top)}`)
  })

  it(`a fading piece is drawn in a faint layer of its own: ${CONTOUR_FADE_LEVELS} levels, the faintest left out`, () => {
    const o = faceMeshOverlay(faces(), W, H, "contours", [visibleBut(OVAL_FROM, OVAL_FROM + 4, 0.5)])!
    expect(segments(o.outlineSvg)).toBe(EDGES - 4)
    expect(o.fadedSvgs).toHaveLength(1)
    expect(o.fadedSvgs![0]!.alpha).toBe(0.5)
    expect(segments(o.fadedSvgs![0]!.svg)).toBe(4)
    expect(o.fadedSvgs![0]!.svg).not.toMatch(/opacity/) // the layer's strength is applied when it is drawn
    // Under half a level: not drawn at all.
    const faint = faceMeshOverlay(faces(), W, H, "contours", [visibleBut(OVAL_FROM, OVAL_FROM + 4, 0.4 / CONTOUR_FADE_LEVELS)])!
    expect(segments(faint.outlineSvg)).toBe(EDGES - 4)
    expect(faint.fadedSvgs).toBeUndefined()
  })

  it("a faint line is between the picture and the full line; where it meets a full one, the full one wins (never darker)", async () => {
    const rgb = gray(W, H)
    const full = await compositeFaceMesh(rgb, W, H, faceMeshOverlay(faces(), W, H, "contours")!)
    const half = await compositeFaceMesh(rgb, W, H, faceMeshOverlay(faces(), W, H, "contours", [visibleBut(OVAL_FROM, OVAL_TO, 0.5)])!)
    const none = await compositeFaceMesh(rgb, W, H, faceMeshOverlay(faces(), W, H, "contours", [visibleBut(OVAL_FROM, OVAL_TO, 0)])!)
    // Never darker than the full line, never lighter than without it. (Where the oval met another line, the path
    // without the oval's segments may rasterise that line a few levels differently: there, between the two.)
    let fainter = 0
    let outside = 0
    for (let i = 0; i < rgb.length; i++) {
      if (half[i]! < Math.min(full[i]!, none[i]!) - 1 || half[i]! > Math.max(full[i]!, none[i]!) + 1) outside++
      if (half[i]! > full[i]! + 1 && half[i]! < none[i]! - 1) fainter++
    }
    expect(outside).toBe(0)
    expect(fainter).toBeGreaterThan(100)
  })
})

describe("a turned face draws no oval across itself", () => {
  const W = 1280
  const H = 720

  /** The pixels the oval alone darkens (by more than a rasterising hair): the contours with it, against the contours with it hidden. */
  async function ovalPixels(yaw: number, visibility: (v: Float32Array) => Float32Array): Promise<Array<[number, number]>> {
    const f = turnedFace(yaw, { height: 300 })
    const v = visibility(edgeVisibility(f.points, f.depth, CONTOUR_EDGES))
    const withoutOval = Float32Array.from(v).fill(0, OVAL_FROM * P, OVAL_TO * P)
    const rgb = gray(W, H)
    const a = await compositeFaceMesh(rgb, W, H, faceMeshOverlay([frac(f.points, W, H)], W, H, "contours", [v])!)
    const b = await compositeFaceMesh(rgb, W, H, faceMeshOverlay([frac(f.points, W, H)], W, H, "contours", [withoutOval])!)
    const out: Array<[number, number]> = []
    for (let i = 0; i < W * H; i++) if (a[3 * i]! < b[3 * i]! - 6) out.push([i % W, Math.floor(i / W)])
    return out
  }

  /** How far each pixel is inside the face: the distance to the nearest point of the face's points' hull, 0 outside. */
  function insideFace(yaw: number): (x: number, y: number) => number {
    const f = turnedFace(yaw, { height: 300 }).points
    const pts: Array<[number, number]> = []
    for (let i = 0; i < f.length; i += 2) pts.push([f[i]!, f[i + 1]!])
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    const half = (list: Array<[number, number]>) => {
      const h: Array<[number, number]> = []
      for (const p of list) {
        while (h.length >= 2 && cross(h.at(-2)!, h.at(-1)!, p) <= 0) h.pop()
        h.push(p)
      }
      return h.slice(0, -1)
    }
    const hull = [...half(pts), ...half([...pts].reverse())]
    return (x, y) => {
      let best = Infinity
      let inside = true
      for (let i = 0; i < hull.length; i++) {
        const [ax, ay] = hull[i]!
        const [bx, by] = hull[(i + 1) % hull.length]!
        if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) inside = false
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
        best = Math.min(best, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))))
      }
      return inside ? best : 0
    }
  }

  for (const yaw of [35, -45]) {
    it(`turned ${yaw}°: drawn whole, the oval cuts across the face; with what the face hides left out, it only runs along its edge`, async () => {
      const inside = insideFace(yaw)
      const interior = 0.08 * 300
      const before = await ovalPixels(yaw, () => allVisible())
      expect(before.filter(([x, y]) => inside(x, y) > interior).length).toBeGreaterThan(50)
      const after = await ovalPixels(yaw, (v) => v)
      expect(after.length).toBeGreaterThan(before.length / 3)
      expect(after.filter(([x, y]) => inside(x, y) > interior).map(([x, y]) => `${x},${y}: ${inside(x, y).toFixed(1)}`)).toEqual([])
    })
  }

  it("a frontal face's oval is drawn whole", async () => {
    const f = turnedFace(0, { height: 300 })
    const v = edgeVisibility(f.points, f.depth, CONTOUR_EDGES)
    const o = faceMeshOverlay([frac(f.points, W, H)], W, H, "contours", [v])!
    expect(o).toEqual(faceMeshOverlay([frac(f.points, W, H)], W, H, "contours"))
  })
})
