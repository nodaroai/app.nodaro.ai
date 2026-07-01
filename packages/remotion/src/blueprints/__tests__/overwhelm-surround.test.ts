import { describe, it, expect, vi } from "vitest"

// Stub out module-level side effects before importing the component file
vi.mock("remotion", () => ({
  useCurrentFrame: () => 0,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 300 }),
  interpolate: (v: number, [a, b]: number[], [c, d]: number[]) => {
    if (v <= a) return c
    if (v >= b) return d
    return c + ((v - a) / (b - a)) * (d - c)
  },
  Easing: { ease: (t: number) => t, out: (fn: (t: number) => number) => fn },
}))
vi.mock("../../lib/font-registry", () => ({
  FONT_MAP: { Montserrat: "Montserrat, sans-serif" },
  SUPPORTED_FONTS: ["Montserrat"],
}))

import {
  surroundState,
  scatterPoint,
  CLOSE_IN_START_FRACTION,
  BUBBLE_STOP_DISTANCE,
} from "../overwhelm-surround"

const DURATION = 210
const DEMANDS = 6

describe("surroundState", () => {
  it("morphProgress is 0 before the morph window, mid-way inside it, and 1 after", () => {
    expect(surroundState(Math.round(DURATION * 0.3), DURATION, DEMANDS, 0).morphProgress).toBe(0)
    const mid = surroundState(Math.round(DURATION * 0.5), DURATION, DEMANDS, 0).morphProgress
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    expect(surroundState(Math.round(DURATION * 0.62), DURATION, DEMANDS, 0).morphProgress).toBe(1)
  })

  it("bubbles have not entered before the close-in phase", () => {
    const s = surroundState(Math.round(DURATION * 0.55), DURATION, DEMANDS, 0)
    expect(s.bubbleEntered).toBe(false)
    expect(s.bubbleDistance).toBe(1)
  })

  it("bubble entries are staggered by index", () => {
    const probe = Math.round(DURATION * CLOSE_IN_START_FRACTION) + 2
    expect(surroundState(probe, DURATION, DEMANDS, 0).bubbleEntered).toBe(true)
    expect(surroundState(probe, DURATION, DEMANDS, DEMANDS - 1).bubbleEntered).toBe(false)
  })

  it("a bubble closes in strictly monotonically and never crosses the stop-short radius", () => {
    const entry = Math.round(DURATION * CLOSE_IN_START_FRACTION)
    let prev = 1
    for (let f = entry + 1; f <= DURATION; f += 2) {
      const { bubbleDistance } = surroundState(f, DURATION, DEMANDS, 0)
      expect(bubbleDistance).toBeLessThanOrEqual(prev + 1e-9)
      expect(bubbleDistance).toBeGreaterThanOrEqual(BUBBLE_STOP_DISTANCE - 1e-9)
      prev = bubbleDistance
    }
    // By the end it has reached the stop-short ring (surrounding, not touching).
    expect(prev).toBeCloseTo(BUBBLE_STOP_DISTANCE, 3)
  })

  it("exposes no camera/world transform — the frame is static by contract", () => {
    const keys = Object.keys(surroundState(100, DURATION, DEMANDS, 0)).sort()
    expect(keys).toEqual(["bubbleDistance", "bubbleEntered", "morphProgress"])
  })
})

describe("scatterPoint", () => {
  it("is deterministic — same index, same point", () => {
    expect(scatterPoint(3)).toEqual(scatterPoint(3))
  })

  it("stays within the unit box and spreads distinct indices apart", () => {
    for (let i = 0; i < 12; i++) {
      const { x, y } = scatterPoint(i)
      expect(Math.abs(x)).toBeLessThanOrEqual(1)
      expect(Math.abs(y)).toBeLessThanOrEqual(1)
    }
    const a = scatterPoint(0)
    const b = scatterPoint(1)
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.1)
  })
})
