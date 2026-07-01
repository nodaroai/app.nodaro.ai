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

import { sideEntranceProgress } from "../comparison-split"

const DURATION = 180

describe("sideEntranceProgress", () => {
  it("returns 0 at frame 0", () => {
    expect(sideEntranceProgress(0, DURATION)).toBe(0)
  })

  it("returns 1 at the entrance end (frame 12)", () => {
    expect(sideEntranceProgress(12, DURATION)).toBe(1)
  })

  it("returns 1 for any frame past the entrance window", () => {
    expect(sideEntranceProgress(30, DURATION)).toBe(1)
    expect(sideEntranceProgress(179, DURATION)).toBe(1)
  })

  it("returns ~0.75 at the midpoint of the entrance (quadratic ease-out at t=0.5)", () => {
    // Entrance is 12 frames; midpoint is frame 6 → t = 0.5, ease-out = 1-(0.5)^2 = 0.75
    expect(sideEntranceProgress(6, DURATION)).toBeCloseTo(0.75, 5)
  })

  it("is monotonically increasing over the entrance window", () => {
    const frames = [0, 2, 4, 6, 8, 10, 12]
    const values = frames.map((f) => sideEntranceProgress(f, DURATION))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
    }
  })

  it("is bounded to [0, 1] for all frames", () => {
    const testFrames = [0, 1, 6, 12, 50, 180]
    for (const f of testFrames) {
      const v = sideEntranceProgress(f, DURATION)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it("clamps entrance window to durationFrames when shorter", () => {
    // durationFrames=6, entranceEnd = min(12, 6) = 6
    expect(sideEntranceProgress(6, 6)).toBe(1)
    expect(sideEntranceProgress(3, 6)).toBeCloseTo(0.75, 5)
  })
})
