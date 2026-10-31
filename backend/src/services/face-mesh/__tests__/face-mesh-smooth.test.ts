import { describe, expect, it } from "vitest"
import { FaceMeshTracker, OneEuroFilter, boxIou, faceScale } from "../face-mesh-smooth.js"

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
