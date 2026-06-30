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

import { lineIndexAtFrame, popScale } from "../kinetic-type-beats"

describe("lineIndexAtFrame", () => {
  it("returns 0 at frame 0 (first line)", () => {
    expect(lineIndexAtFrame(0, 60, 4)).toBe(0)
  })

  it("advances to line 1 at the start of the second segment", () => {
    // segment = 60/4 = 15
    expect(lineIndexAtFrame(15, 60, 4)).toBe(1)
  })

  it("returns the last index at the final frame", () => {
    expect(lineIndexAtFrame(59, 60, 4)).toBe(3)
    expect(lineIndexAtFrame(60, 60, 4)).toBe(3) // clamped
  })

  it("always returns 0 for count=1", () => {
    expect(lineIndexAtFrame(0, 60, 1)).toBe(0)
    expect(lineIndexAtFrame(59, 60, 1)).toBe(0)
  })

  it("distributes four lines evenly across the window", () => {
    // segment = 60/4 = 15
    expect(lineIndexAtFrame(0, 60, 4)).toBe(0)
    expect(lineIndexAtFrame(14, 60, 4)).toBe(0)
    expect(lineIndexAtFrame(15, 60, 4)).toBe(1)
    expect(lineIndexAtFrame(29, 60, 4)).toBe(1)
    expect(lineIndexAtFrame(30, 60, 4)).toBe(2)
    expect(lineIndexAtFrame(45, 60, 4)).toBe(3)
  })
})

describe("popScale", () => {
  it("starts at 0.8 at local frame 0", () => {
    expect(popScale(0)).toBeCloseTo(0.8, 5)
  })

  it("reaches 1.0 by local frame 10", () => {
    expect(popScale(10)).toBeCloseTo(1.0, 5)
  })

  it("clamps at 1.0 past frame 10", () => {
    expect(popScale(20)).toBeCloseTo(1.0, 5)
    expect(popScale(100)).toBeCloseTo(1.0, 5)
  })

  it("is between 0.8 and 1.0 in the middle (local frame 5)", () => {
    const mid = popScale(5)
    // Quadratic ease-out at t=0.5 → 0.75; 0.8 + 0.2*0.75 = 0.95
    expect(mid).toBeCloseTo(0.95, 5)
    expect(mid).toBeGreaterThan(0.8)
    expect(mid).toBeLessThan(1.0)
  })

  it("is monotonically increasing over the pop window", () => {
    const frames = [0, 2, 4, 6, 8, 10]
    const scales = frames.map(popScale)
    for (let i = 1; i < scales.length; i++) {
      expect(scales[i]).toBeGreaterThanOrEqual(scales[i - 1])
    }
  })
})
