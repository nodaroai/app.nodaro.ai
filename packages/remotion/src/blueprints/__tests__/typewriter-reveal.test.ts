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

import { typedCharCount, caretMarginStyle } from "../typewriter-reveal"

const TOTAL = 10
const DURATION = 180

describe("typedCharCount", () => {
  it("returns 0 at frame 0", () => {
    expect(typedCharCount(0, DURATION, TOTAL)).toBe(0)
  })

  it("returns totalChars at the typing boundary (~70% of duration)", () => {
    // Typing ends at round(180 * 0.7) = 126
    expect(typedCharCount(126, DURATION, TOTAL)).toBe(TOTAL)
  })

  it("returns totalChars for any frame past the typing window (held portion)", () => {
    expect(typedCharCount(150, DURATION, TOTAL)).toBe(TOTAL)
    expect(typedCharCount(179, DURATION, TOTAL)).toBe(TOTAL)
  })

  it("returns an intermediate count at the midpoint of the typing window", () => {
    // Midpoint frame = round(126 / 2) = 63
    // At t = 63/126 = 0.5, ceil(0.5 * 10) = 5
    const mid = typedCharCount(63, DURATION, TOTAL)
    expect(mid).toBe(5)
  })

  it("is monotonically non-decreasing over the typing window", () => {
    const frames = [0, 20, 40, 63, 80, 100, 126, 150]
    const values = frames.map((f) => typedCharCount(f, DURATION, TOTAL))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
    }
  })

  it("is clamped to totalChars — never exceeds it", () => {
    for (let f = 0; f <= DURATION; f += 10) {
      expect(typedCharCount(f, DURATION, TOTAL)).toBeLessThanOrEqual(TOTAL)
    }
  })

  it("handles totalChars = 0 gracefully", () => {
    expect(typedCharCount(50, DURATION, 0)).toBe(0)
  })

  it("returns totalChars immediately when durationFrames = 1", () => {
    // typingEnd = max(1, round(1 * 0.7)) = 1; frame ≥ 1 → totalChars
    expect(typedCharCount(1, 1, TOTAL)).toBe(TOTAL)
  })
})

describe("caretMarginStyle", () => {
  it("uses marginInlineStart so the caret trails the text's leading edge regardless of direction", () => {
    expect(caretMarginStyle()).toEqual({ marginInlineStart: 2 })
  })
})
