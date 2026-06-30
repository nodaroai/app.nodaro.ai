import { describe, it, expect, vi } from "vitest"

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

import { countupValue } from "../dataviz-countup"

describe("countupValue", () => {
  it("returns 0 at frame 0", () => {
    expect(countupValue(0, 100, 1000)).toBe(0)
  })

  it("returns exactly target at the countup end frame (80% of duration)", () => {
    // countupEnd = Math.round(100 * 0.8) = 80
    expect(countupValue(80, 100, 1000)).toBe(1000)
  })

  it("clamps at target past the countup end", () => {
    expect(countupValue(100, 100, 1000)).toBe(1000)
    expect(countupValue(200, 100, 1000)).toBe(1000)
  })

  it("returns an eased intermediate at the mid-countup frame (frame 40)", () => {
    // countupEnd=80, t=0.5 → quadratic ease-out 0.75 → 750
    expect(countupValue(40, 100, 1000)).toBeCloseTo(750, 5)
  })

  it("works with non-integer targets", () => {
    // frame 0 → 0, frame countupEnd → target
    expect(countupValue(0, 60, 3.14)).toBe(0)
    expect(countupValue(Math.round(60 * 0.8), 60, 3.14)).toBeCloseTo(3.14, 5)
  })

  it("is monotonically increasing toward the target", () => {
    const frames = [0, 10, 20, 40, 60, 80, 100]
    const values = frames.map((f) => countupValue(f, 100, 1000))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
    }
  })

  it("never exceeds the target", () => {
    for (const frame of [0, 25, 50, 75, 80, 90, 100]) {
      expect(countupValue(frame, 100, 500)).toBeLessThanOrEqual(500)
    }
  })
})
