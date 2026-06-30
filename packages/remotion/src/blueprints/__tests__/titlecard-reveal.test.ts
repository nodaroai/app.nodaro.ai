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

import { titlecardEntranceProgress } from "../titlecard-reveal"

describe("titlecardEntranceProgress", () => {
  it("returns 0 at frame 0", () => {
    expect(titlecardEntranceProgress(0, 60)).toBe(0)
  })

  it("returns 1 at the end of the entrance (frame 12)", () => {
    expect(titlecardEntranceProgress(12, 60)).toBe(1)
  })

  it("returns 1 for any frame past the entrance window", () => {
    expect(titlecardEntranceProgress(30, 60)).toBe(1)
    expect(titlecardEntranceProgress(60, 60)).toBe(1)
  })

  it("returns an intermediate value at mid-entrance (frame 6)", () => {
    const mid = titlecardEntranceProgress(6, 60)
    // Quadratic ease-out at t=0.5 → 0.75
    expect(mid).toBeCloseTo(0.75, 5)
  })

  it("clamps the entrance window to durationFrames when shorter", () => {
    // durationFrames=6, so entrance ends at frame 6
    expect(titlecardEntranceProgress(6, 6)).toBe(1)
    expect(titlecardEntranceProgress(3, 6)).toBeCloseTo(0.75, 5)
  })

  it("is monotonically increasing over the entrance window", () => {
    const frames = [0, 2, 4, 6, 8, 10, 12]
    const values = frames.map((f) => titlecardEntranceProgress(f, 60))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
    }
  })
})
