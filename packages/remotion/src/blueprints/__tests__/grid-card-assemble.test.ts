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

import { cardEntranceProgress } from "../grid-card-assemble"

// STAGGER_FRAMES=6, ENTRANCE_FRAMES=12 (matches component constants).
// cardStart(i) = i * 6.  localFrame = frame - cardStart.

describe("cardEntranceProgress", () => {
  it("returns 0 at frame 0 for any card", () => {
    expect(cardEntranceProgress(0, 0, 60)).toBe(0)
    expect(cardEntranceProgress(0, 1, 60)).toBe(0)
    expect(cardEntranceProgress(0, 3, 60)).toBe(0)
  })

  it("returns 0 when frame is exactly at cardStart (localFrame=0)", () => {
    // Card 1 starts at frame 6; frame 6 → localFrame 0 → 0
    expect(cardEntranceProgress(6, 1, 60)).toBe(0)
    // Card 2 starts at frame 12; frame 12 → localFrame 0 → 0
    expect(cardEntranceProgress(12, 2, 60)).toBe(0)
  })

  it("returns 1 once localFrame reaches ENTRANCE_FRAMES (12)", () => {
    // Card 0: starts at 0, done at frame 12
    expect(cardEntranceProgress(12, 0, 60)).toBe(1)
    // Card 1: starts at 6, done at frame 18
    expect(cardEntranceProgress(18, 1, 60)).toBe(1)
    // Card 2: starts at 12, done at frame 24
    expect(cardEntranceProgress(24, 2, 60)).toBe(1)
  })

  it("clamps at 1 for any frame past the entrance window", () => {
    expect(cardEntranceProgress(30, 0, 60)).toBe(1)
    expect(cardEntranceProgress(60, 0, 60)).toBe(1)
    expect(cardEntranceProgress(100, 1, 60)).toBe(1)
  })

  it("returns eased intermediate at the mid-entrance frame", () => {
    // Card 0: localFrame=6 (half of 12) → t=0.5 → ease-out = 1-(0.5)²=0.75
    expect(cardEntranceProgress(6, 0, 60)).toBeCloseTo(0.75, 5)
    // Card 1: mid at localFrame=6 → frame 6+6=12 → same ease-out
    expect(cardEntranceProgress(12, 1, 60)).toBeCloseTo(0.75, 5)
  })

  it("stagger is exactly STAGGER_FRAMES (6) between consecutive cards", () => {
    // At frame 5 card 0 is partway through; card 1 hasn't started
    expect(cardEntranceProgress(5, 0, 60)).toBeGreaterThan(0)
    expect(cardEntranceProgress(5, 1, 60)).toBe(0)

    // At frame 6 card 1 starts (localFrame=0 → progress 0)
    expect(cardEntranceProgress(6, 1, 60)).toBe(0)

    // At frame 11 card 1 is partway; card 2 hasn't started
    expect(cardEntranceProgress(11, 1, 60)).toBeGreaterThan(0)
    expect(cardEntranceProgress(11, 2, 60)).toBe(0)
  })

  it("is monotonically increasing over the entrance window for each card", () => {
    for (const index of [0, 1, 2]) {
      const start = index * 6
      const frames = [start, start + 3, start + 6, start + 9, start + 12, start + 15]
      const values = frames.map((f) => cardEntranceProgress(f, index, 60))
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
      }
    }
  })

  it("never exceeds 1", () => {
    for (const frame of [0, 3, 6, 9, 12, 18, 30, 60]) {
      expect(cardEntranceProgress(frame, 0, 60)).toBeLessThanOrEqual(1)
    }
  })
})
