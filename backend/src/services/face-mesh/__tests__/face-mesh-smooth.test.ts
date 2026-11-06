import { describe, expect, it } from "vitest"
import { FaceMeshTracker, OneEuroFilter, boxIou, faceScale, matchFaceBoxes } from "../face-mesh-smooth.js"
import { FACE_MESH_VISIBILITY, edgeVisibility } from "../face-mesh-visibility.js"
import { CONTOUR_EDGES } from "../face-mesh-draw.js"
import { turnedFace } from "./face-3d.fixture.js"

describe("OneEuroFilter", () => {
  it("passes the first value as it is", () => {
    expect(new OneEuroFilter().filter(12.5, 1 / 30, 100)).toBe(12.5)
  })

  it("holds a still point steady: shimmer is damped", () => {
    const f = new OneEuroFilter()
    const out: number[] = []
    for (let i = 0; i < 60; i++) out.push(f.filter(100 + (i % 2 === 0 ? 1 : -1), 1 / 30, 200))
    const tail = out.slice(30)
    const spread = Math.max(...tail) - Math.min(...tail)
    expect(spread).toBeLessThan(1) // the raw input swings 2 px every frame
  })

  it("follows a fast move with little lag (a mouth opening)", () => {
    const f = new OneEuroFilter()
    f.filter(0, 1 / 30, 100)
    let v = 0
    for (let i = 1; i <= 3; i++) v = f.filter(i * 10, 1 / 30, 100) // a face size per 0.3 s
    expect(v).toBeGreaterThan(25) // within ~5 px of 30 after three frames
  })

  it("restarts on a non-positive step", () => {
    const f = new OneEuroFilter()
    f.filter(0, 1 / 30)
    expect(f.filter(50, 0)).toBe(50)
  })
})

describe("boxIou", () => {
  it("is 1 for the same box, 0 apart, and between for an overlap", () => {
    const a = { x: 0, y: 0, w: 2, h: 2 }
    expect(boxIou(a, a)).toBe(1)
    expect(boxIou(a, { x: 5, y: 5, w: 1, h: 1 })).toBe(0)
    expect(boxIou(a, { x: 1, y: 0, w: 2, h: 2 })).toBeCloseTo(2 / 6)
  })
})

describe("matchFaceBoxes", () => {
  const a = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }
  const b = { x: 0.5, y: 0.1, w: 0.1, h: 0.1 }

  it("pairs each face with the box it overlaps best, whatever the order; a face overlapping none is new (-1)", () => {
    expect(matchFaceBoxes([{ ...b, x: 0.51 }, { ...a, x: 0.11 }, { x: 0.8, y: 0.8, w: 0.1, h: 0.1 }], [a, b])).toEqual([1, 0, -1])
  })

  it("best overlap first, each box taken once: of two faces on one box the closer takes it", () => {
    expect(matchFaceBoxes([{ ...a, x: 0.13 }, { ...a, x: 0.11 }], [a])).toEqual([-1, 0])
  })

  it("an overlap under FACE_MESH_TRACK_MIN_IOU is no match", () => {
    expect(matchFaceBoxes([{ ...a, x: 0.16 }], [a])).toEqual([-1]) // IoU 0.04 / 0.16 = 0.25
    expect(matchFaceBoxes([{ ...a, x: 0.15 }], [a])).toEqual([0]) // IoU 0.05 / 0.15 ≈ 0.33
  })
})

describe("faceScale", () => {
  it("is the mean of the points' extent across and down", () => {
    expect(faceScale([0, 0, 10, 30])).toBe(20)
    expect(faceScale([5, 5])).toBe(1)
  })
})

describe("FaceMeshTracker", () => {
  const pts = (x: number, y: number) => Float64Array.from([x, y, x + 50, y + 50])

  it("smooths a face by the face, whatever its place in the frame's list", () => {
    const t = new FaceMeshTracker(30)
    const a = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }
    const b = { x: 0.7, y: 0.1, w: 0.1, h: 0.1 }
    t.next([{ box: a, points: pts(100, 100) }, { box: b, points: pts(700, 100) }])
    // The order swaps (YuNet answers by score) and each face shimmers by a pixel.
    const [first, second] = t.next([{ box: b, points: pts(701, 100) }, { box: a, points: pts(101, 100) }])
    expect(first![0]).toBeGreaterThan(699)
    expect(first![0]).toBeLessThan(702)
    expect(second![0]).toBeGreaterThan(99)
    expect(second![0]).toBeLessThan(102)
  })

  it("a face not drawn in a frame is forgotten: drawn again, it starts afresh", () => {
    const t = new FaceMeshTracker(30)
    const a = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }
    t.next([{ box: a, points: pts(100, 100) }])
    t.next([])
    const [again] = t.next([{ box: a, points: pts(140, 100) }])
    expect(again![0]).toBe(140)
  })

  it("a new face beside a known one starts afresh, the known one keeps its filter", () => {
    const t = new FaceMeshTracker(30)
    const a = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }
    t.next([{ box: a, points: pts(100, 100) }])
    const [known, fresh] = t.next([
      { box: a, points: pts(101, 100) },
      { box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, points: pts(500, 500) },
    ])
    expect(known![0]).toBeLessThan(101)
    expect(fresh![0]).toBe(500)
  })
})

describe("FaceMeshTracker.track: the depths and what the face hides, held steady with the points", () => {
  const box = { x: 0.4, y: 0.3, w: 0.2, h: 0.4 }
  const contours = (points: Float64Array, depth: Float64Array) => edgeVisibility(points, depth, CONTOUR_EDGES)
  /** The fixture face turned `yaw`, as the pipeline hands it to the tracker (pixels, with its depths). */
  const meshed = (yaw: number) => {
    const f = turnedFace(yaw, { height: 300 })
    return { box, points: f.points, depth: f.depth }
  }

  it("the points are exactly next()'s: the depths and the visibility change nothing drawn by the other parts", () => {
    const a = new FaceMeshTracker(24)
    const b = new FaceMeshTracker(24)
    for (let yaw = 0; yaw < 20; yaw += 2) {
      const [tracked] = a.track([meshed(yaw)], contours)
      const [plain] = b.next([{ box, points: meshed(yaw).points }])
      expect(tracked!.points).toEqual(plain)
    }
  })

  it("no depths, no visibility asked: points alone, as before", () => {
    const [f] = new FaceMeshTracker(24).track([{ box, points: meshed(30).points }], contours)
    expect(f!.depth).toBeUndefined()
    expect(f!.visibility).toBeUndefined()
    const [g] = new FaceMeshTracker(24).track([meshed(30)])
    expect(g!.depth).toBeDefined()
    expect(g!.visibility).toBeUndefined()
  })

  it("a new face's first frame is answered as it is; a held face's depths are smoothed like its points", () => {
    const t = new FaceMeshTracker(24)
    const first = meshed(30)
    const [f0] = t.track([first], contours)
    expect(f0!.visibility).toEqual(contours(first.points, first.depth))
    // The depths shimmer by a pixel from frame to frame: damped, as the points are.
    const out: number[] = []
    for (let i = 0; i < 48; i++) {
      const m = meshed(30)
      const [f] = t.track([{ ...m, depth: m.depth.map((z) => z + (i % 2 === 0 ? 1 : -1)) }], contours)
      out.push(f!.depth![1]!)
    }
    const tail = out.slice(24)
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(1)
  })

  it("the fade is smooth: a face turning 0 → 70° at 12° a second moves no piece more than a third of the way in a frame, and settles on the answer", () => {
    const t = new FaceMeshTracker(24)
    let prev: Float32Array | undefined
    let worst = 0
    for (let yaw = 0; yaw <= 70; yaw += 0.5) {
      const [f] = t.track([meshed(yaw)], contours)
      if (prev) for (let i = 0; i < prev.length; i++) worst = Math.max(worst, Math.abs(f!.visibility![i]! - prev[i]!))
      prev = f!.visibility
    }
    expect(worst).toBeLessThan(1 / 3)
    let still: Float32Array | undefined
    for (let i = 0; i < 48; i++) still = t.track([meshed(70)], contours)[0]!.visibility
    const want = contours(meshed(70).points, meshed(70).depth)
    for (let i = 0; i < want.length; i++) expect(Math.abs(still![i]! - want[i]!)).toBeLessThan(0.01)
  })

  it("a piece that flickers in the raw answer from frame to frame is held near its mean, not switched", () => {
    const t = new FaceMeshTracker(24)
    const flicker = (_p: Float64Array, _d: Float64Array) => Float32Array.from({ length: 4 }, (_, i) => (i === 0 ? 1 : 0))
    let frame = 0
    const alternate = (p: Float64Array, d: Float64Array) => (frame++ % 2 === 0 ? flicker(p, d) : Float32Array.from([0, 0, 0, 0]))
    const seen: number[] = []
    for (let i = 0; i < 48; i++) seen.push(t.track([meshed(10)], alternate)[0]!.visibility![0]!)
    const tail = seen.slice(24)
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.45)
    expect(Math.min(...tail)).toBeGreaterThan(0.2)
    expect(Math.max(...tail)).toBeLessThan(0.8)
    expect(FACE_MESH_VISIBILITY.smoothingCutoffHz).toBeGreaterThan(0)
  })

  it("a face not drawn in a frame is forgotten: drawn again, its visibility starts afresh", () => {
    const t = new FaceMeshTracker(24)
    t.track([meshed(0)], contours)
    t.track([], contours)
    const again = meshed(60)
    expect(t.track([again], contours)[0]!.visibility).toEqual(contours(again.points, again.depth))
  })
})
