import { describe, it, expect } from "vitest"

import { easeOutQuad, easeInQuad, ringAngle, popWithSettle, POP_OVERSHOOT } from "../motion"

describe("easeOutQuad", () => {
  it("maps 0→0 and 1→1 with a decelerating middle", () => {
    expect(easeOutQuad(0)).toBe(0)
    expect(easeOutQuad(1)).toBe(1)
    expect(easeOutQuad(0.5)).toBe(0.75)
  })
})

describe("easeInQuad", () => {
  it("maps 0→0 and 1→1 with an accelerating middle — the mirror of easeOutQuad", () => {
    expect(easeInQuad(0)).toBe(0)
    expect(easeInQuad(1)).toBe(1)
    expect(easeInQuad(0.5)).toBe(0.25)
  })

  it("is slower than linear at the start (accelerating), unlike easeOutQuad", () => {
    expect(easeInQuad(0.3)).toBeLessThan(0.3)
    expect(easeOutQuad(0.3)).toBeGreaterThan(0.3)
  })
})

describe("ringAngle", () => {
  it("starts at 12 o'clock and distributes evenly clockwise", () => {
    expect(ringAngle(0, 4)).toBeCloseTo(-Math.PI / 2, 9)
    expect(ringAngle(1, 4)).toBeCloseTo(0, 9)
    expect(ringAngle(2, 4)).toBeCloseTo(Math.PI / 2, 9)
  })

  it("guards count 0 without dividing by zero", () => {
    expect(Number.isFinite(ringAngle(0, 0))).toBe(true)
  })
})

describe("popWithSettle", () => {
  it("is clamped to 0 before the window and 1 after", () => {
    expect(popWithSettle(-0.1)).toBe(0)
    expect(popWithSettle(0)).toBe(0)
    expect(popWithSettle(1)).toBe(1)
    expect(popWithSettle(1.5)).toBe(1)
  })

  it("peaks at exactly POP_OVERSHOOT at 70% and settles to 1", () => {
    expect(popWithSettle(0.7)).toBeCloseTo(POP_OVERSHOOT, 9)
    let max = 0
    for (let e = 0; e <= 1; e += 0.01) max = Math.max(max, popWithSettle(e))
    expect(max).toBeLessThanOrEqual(POP_OVERSHOOT + 1e-9)
  })
})
