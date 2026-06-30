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

import { letterEntranceProgress } from "../logo-assemble-lockup"

// Reference constants matching the component:
//   LETTER_ENTRANCE_FRAMES = 12
//   STAGGER_WINDOW_FRACTION = 0.5
//
// With count=4, durationFrames=60:
//   staggerWindow = round(60 * 0.5) = 30
//   staggerPerLetter = floor(30 / 3) = 10
//   letterStart(i) = i * 10
//   lastLetterEnd = 3*10 + 12 = 42

describe("letterEntranceProgress", () => {
  it("returns 0 at frame 0 for letter 0 (localFrame=0)", () => {
    expect(letterEntranceProgress(0, 0, 4, 60)).toBe(0)
  })

  it("returns 1 once letter 0 completes its entrance (frame >= 12)", () => {
    expect(letterEntranceProgress(12, 0, 4, 60)).toBe(1)
    expect(letterEntranceProgress(30, 0, 4, 60)).toBe(1)
  })

  it("returns 0 for letter 1 before its start frame (frame < 10)", () => {
    expect(letterEntranceProgress(0, 1, 4, 60)).toBe(0)
    expect(letterEntranceProgress(9, 1, 4, 60)).toBe(0)
  })

  it("returns 0 for letter 1 at exactly its start frame (localFrame=0 → progress 0)", () => {
    // letterStart(1) = 10 → localFrame = 10-10 = 0 → 0
    expect(letterEntranceProgress(10, 1, 4, 60)).toBe(0)
  })

  it("returns 1 once letter 1 completes its entrance (frame >= 10+12=22)", () => {
    expect(letterEntranceProgress(22, 1, 4, 60)).toBe(1)
    expect(letterEntranceProgress(40, 1, 4, 60)).toBe(1)
  })

  it("returns 0 for letter 3 at frame 0 (hasn't started)", () => {
    // letterStart(3) = 30 > 0
    expect(letterEntranceProgress(0, 3, 4, 60)).toBe(0)
  })

  it("returns 1 for the last letter (index 3) once it has completed (frame >= 30+12=42)", () => {
    expect(letterEntranceProgress(42, 3, 4, 60)).toBe(1)
    expect(letterEntranceProgress(60, 3, 4, 60)).toBe(1)
  })

  it("returns eased intermediate at mid-entrance for letter 0 (frame=6)", () => {
    // localFrame=6, t=0.5 → ease-out = 1 - (0.5)² = 0.75
    expect(letterEntranceProgress(6, 0, 4, 60)).toBeCloseTo(0.75, 5)
  })

  it("returns eased intermediate at mid-entrance for letter 2 (frame=20+6=26)", () => {
    // letterStart(2) = 20, mid-entrance = 20+6 = 26, t=0.5 → 0.75
    expect(letterEntranceProgress(26, 2, 4, 60)).toBeCloseTo(0.75, 5)
  })

  it("handles count=1 (single letter starts immediately at frame 0)", () => {
    // staggerPerLetter=0 when count=1 → letterStart=0 for index 0
    expect(letterEntranceProgress(0, 0, 1, 60)).toBe(0)
    expect(letterEntranceProgress(12, 0, 1, 60)).toBe(1)
    expect(letterEntranceProgress(6, 0, 1, 60)).toBeCloseTo(0.75, 5)
  })

  it("is monotonically increasing over the entrance window for each letter", () => {
    for (const index of [0, 1, 2, 3]) {
      const start = index * 10
      const frames = [start, start + 3, start + 6, start + 9, start + 12, start + 15]
      const values = frames.map((f) => letterEntranceProgress(f, index, 4, 60))
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
      }
    }
  })

  it("never exceeds 1", () => {
    for (const frame of [0, 5, 10, 15, 20, 30, 42, 60]) {
      for (const index of [0, 1, 2, 3]) {
        expect(letterEntranceProgress(frame, index, 4, 60)).toBeLessThanOrEqual(1)
      }
    }
  })
})
