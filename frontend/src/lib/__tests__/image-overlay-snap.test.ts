import { describe, it, expect } from "vitest"
import { snapBox } from "../image-overlay-snap"

const stage = { left: 100, top: 100, width: 1000, height: 500 }

describe("snapBox", () => {
  it("pulls a layer whose centre is near the stage centre onto it and reports both guides", () => {
    const box = { left: 100 + 500 - 50 + 4, top: 100 + 250 - 25 - 3, width: 100, height: 50 }
    const r = snapBox(box, stage, undefined, 6)
    expect(r.dx).toBe(-4)
    expect(r.dy).toBe(3)
    expect(r.vertical).toEqual([0.5])
    expect(r.horizontal).toEqual([0.5])
  })

  it("snaps an edge to the stage edge and to a safe-area edge", () => {
    const r = snapBox({ left: 103, top: 300, width: 100, height: 50 }, stage, undefined, 6)
    expect(r.dx).toBe(-3)
    const safe = { left: 300, top: 150, width: 600, height: 400 }
    const s = snapBox({ left: 296, top: 300, width: 100, height: 50 }, stage, safe, 6)
    expect(s.dx).toBe(4)
    expect(s.vertical).toEqual([0.2])
  })

  it("does nothing outside the threshold", () => {
    const r = snapBox({ left: 400, top: 300, width: 100, height: 50 }, stage, undefined, 6)
    expect(r.dx).toBe(0)
    expect(r.dy).toBe(0)
    expect(r.vertical).toEqual([])
  })
})
