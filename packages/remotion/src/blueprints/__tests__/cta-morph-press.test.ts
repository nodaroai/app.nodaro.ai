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

import { cursorProgress, pressCompression } from "../cta-morph-press"

// Reference constants matching the component:
//   CURSOR_START_FRACTION = 0.15  → cursorStart = round(60*0.15) = round(9)  = 9
//   PRESS_FRACTION        = 0.70  → pressFrame  = round(60*0.70) = round(42) = 42
//   COMPRESS_FRAMES = 12, COMPRESS_HALF = 6

describe("cursorProgress (durationFrames=60)", () => {
  it("returns 0 before cursor start (frame 0 through 8)", () => {
    expect(cursorProgress(0, 60)).toBe(0)
    expect(cursorProgress(8, 60)).toBe(0)
  })

  it("returns 0 at exactly cursorStart=9 (localT=0)", () => {
    expect(cursorProgress(9, 60)).toBe(0)
  })

  it("returns 1 at the press frame (frame=42)", () => {
    expect(cursorProgress(42, 60)).toBe(1)
  })

  it("returns 1 for any frame past the press frame", () => {
    expect(cursorProgress(50, 60)).toBe(1)
    expect(cursorProgress(60, 60)).toBe(1)
  })

  it("returns an ease-out intermediate at the midpoint between cursorStart and pressFrame", () => {
    // frame=25: t = (25-9)/(42-9) = 16/33 ≈ 0.4848
    // quadratic ease-out = 1 - (1-t)² = 1 - (17/33)² = 800/1089 ≈ 0.7346
    // A linear impl would give t ≈ 0.485 — this literal catches that regression.
    const mid = cursorProgress(25, 60)
    expect(mid).toBeCloseTo(0.7346, 3)
  })

  it("is monotonically increasing from cursorStart to pressFrame", () => {
    const frames = [9, 15, 20, 25, 30, 35, 42]
    const values = frames.map((f) => cursorProgress(f, 60))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
    }
  })

  it("scales proportionally with durationFrames (pressFrame = round(dur * 0.7))", () => {
    // durationFrames=120: cursorStart=round(18)=18, pressFrame=round(84)=84
    expect(cursorProgress(18, 120)).toBe(0)
    expect(cursorProgress(84, 120)).toBe(1)
    expect(cursorProgress(120, 120)).toBe(1)
  })
})

describe("pressCompression (durationFrames=60)", () => {
  // pressFrame = 42

  it("returns 1 before the press frame", () => {
    expect(pressCompression(0, 60)).toBe(1)
    expect(pressCompression(41, 60)).toBe(1)
  })

  it("returns 1 at exactly the press frame (localFrame=0, t=0)", () => {
    // Down: t=0 → 1 - 0.04*0 = 1
    expect(pressCompression(42, 60)).toBe(1)
  })

  it("reaches minimum ~0.96 at halfway through the compression (localFrame=6)", () => {
    // Down: t=1 → 1 - 0.04*1 = 0.96
    expect(pressCompression(48, 60)).toBeCloseTo(0.96, 5)
  })

  it("returns intermediate during down phase (localFrame=3)", () => {
    // t=0.5 → 1 - 0.04*0.25 = 0.99
    expect(pressCompression(45, 60)).toBeCloseTo(0.99, 5)
  })

  it("returns intermediate during up phase (localFrame=9)", () => {
    // t=(9-6)/6=0.5 → 0.96 + 0.04*(1-0.25) = 0.96+0.03 = 0.99
    expect(pressCompression(51, 60)).toBeCloseTo(0.99, 5)
  })

  it("returns 1 once the compression cycle ends (localFrame=12)", () => {
    // localFrame=12: t=1 → 0.96 + 0.04*(1-0) = 1.0
    expect(pressCompression(54, 60)).toBeCloseTo(1.0, 5)
  })

  it("returns 1 past the compression window", () => {
    expect(pressCompression(55, 60)).toBe(1)
    expect(pressCompression(60, 60)).toBe(1)
  })

  it("compression value never falls below 0.95 or exceeds 1", () => {
    for (let f = 0; f <= 60; f++) {
      const c = pressCompression(f, 60)
      expect(c).toBeGreaterThanOrEqual(0.95)
      expect(c).toBeLessThanOrEqual(1.0)
    }
  })

  it("is smooth — no instant jumps larger than 0.02 between consecutive frames", () => {
    for (let f = 1; f <= 60; f++) {
      const prev = pressCompression(f - 1, 60)
      const curr = pressCompression(f, 60)
      expect(Math.abs(curr - prev)).toBeLessThan(0.02)
    }
  })
})
