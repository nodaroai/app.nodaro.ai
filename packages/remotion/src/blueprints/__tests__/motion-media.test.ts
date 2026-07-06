import { describe, it, expect } from "vitest"
import { scaleSwap, headlineSwap, chaseCamera } from "../motion"

describe("scaleSwap", () => {
  it("at e=0 the outgoing is full, incoming absent", () => {
    const s = scaleSwap(0)
    expect(s.outOpacity).toBeCloseTo(1); expect(s.inOpacity).toBeCloseTo(0)
  })
  it("at e=1 the incoming is full, outgoing gone", () => {
    const s = scaleSwap(1)
    expect(s.outOpacity).toBeCloseTo(0); expect(s.inOpacity).toBeCloseTo(1); expect(s.inScale).toBeCloseTo(1)
  })
})

describe("headlineSwap", () => {
  it("at e=1 the incoming headline has settled (y≈0, opacity≈1)", () => {
    const s = headlineSwap(1)
    expect(s.inY).toBeCloseTo(0); expect(s.inOpacity).toBeCloseTo(1)
  })
})

describe("chaseCamera", () => {
  const targets = [{ xPct: 50, yPct: 50 }, { xPct: 80, yPct: 20 }]
  it("holds centered on the first target at frame 0 (no translation, scale≥1)", () => {
    const c = chaseCamera(0, 120, targets, 1000, 1000)
    expect(c.translateX).toBeCloseTo(0); expect(c.translateY).toBeCloseTo(0); expect(c.scale).toBeGreaterThanOrEqual(1)
  })
  it("has moved toward the second target by end of frame window", () => {
    const c = chaseCamera(119, 120, targets, 1000, 1000)
    // target 2 is right+up of center → world translates left+down (negative x, positive y)
    expect(c.translateX).toBeLessThan(0); expect(c.translateY).toBeGreaterThan(0)
  })
})
