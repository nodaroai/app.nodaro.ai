import { describe, it, expect, vi } from "vitest"

// Stub out module-level side effects before importing the component file
vi.mock("remotion", () => ({
  useCurrentFrame: () => 0,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 300 }),
}))
vi.mock("../../lib/font-registry", () => ({
  FONT_MAP: { Montserrat: "Montserrat, sans-serif" },
  SUPPORTED_FONTS: ["Montserrat"],
}))

import { takeoverPositions, TYPE_FRACTION, CYCLE_END_FRACTION, HOLD_FRACTION } from "../ticker-takeover"

const DURATION = 180
const OPTIONS = 3

describe("takeoverPositions", () => {
  it("phases run type → cycle → collision → hold across the window", () => {
    expect(takeoverPositions(5, DURATION, OPTIONS).phase).toBe("type")
    expect(takeoverPositions(Math.round(DURATION * 0.4), DURATION, OPTIONS).phase).toBe("cycle")
    expect(takeoverPositions(Math.round(DURATION * 0.62), DURATION, OPTIONS).phase).toBe("collision")
    expect(takeoverPositions(Math.round(DURATION * 0.9), DURATION, OPTIONS).phase).toBe("hold")
  })

  it("typing completes by the end of the type phase", () => {
    const endOfType = Math.round(DURATION * TYPE_FRACTION)
    expect(takeoverPositions(endOfType, DURATION, OPTIONS).typedFraction).toBe(1)
    expect(takeoverPositions(2, DURATION, OPTIONS).typedFraction).toBeLessThan(1)
  })

  it("the option ticker visits every option exactly once, in order", () => {
    const seen: number[] = []
    for (let f = 0; f <= Math.round(DURATION * CYCLE_END_FRACTION); f++) {
      const { optionIndex } = takeoverPositions(f, DURATION, OPTIONS)
      if (seen[seen.length - 1] !== optionIndex) seen.push(optionIndex)
    }
    expect(seen).toEqual([0, 1, 2])
  })

  it("the text group holds at 0 until contact, then is shoved strictly left (displacement, not fade)", () => {
    // Before and during early collision (pre-contact) the text group is centered.
    expect(takeoverPositions(Math.round(DURATION * 0.5), DURATION, OPTIONS).textGroupX).toBe(0)
    // After contact it moves strictly left, monotonically.
    const post = [0.68, 0.72, 0.75].map(
      (t) => takeoverPositions(Math.round(DURATION * t), DURATION, OPTIONS).textGroupX,
    )
    expect(post[0]).toBeLessThan(0)
    expect(post[1]).toBeLessThan(post[0])
    expect(post[2]).toBeLessThanOrEqual(post[1])
  })

  it("the hero starts off-screen right, is still travelling during collision, and rests dead-center only in hold", () => {
    expect(takeoverPositions(0, DURATION, OPTIONS).heroX).toBeGreaterThanOrEqual(1)
    const during = takeoverPositions(Math.round(DURATION * 0.6), DURATION, OPTIONS).heroX
    expect(during).toBeGreaterThan(0)
    const hold = takeoverPositions(Math.round(DURATION * (HOLD_FRACTION + 0.05)), DURATION, OPTIONS)
    expect(hold.heroX).toBe(0)
    expect(hold.phase).toBe("hold")
  })

  it("hero X is monotonically non-increasing (arrives with momentum, never bounces back)", () => {
    let prev = Infinity
    for (let f = 0; f <= DURATION; f += 3) {
      const { heroX } = takeoverPositions(f, DURATION, OPTIONS)
      expect(heroX).toBeLessThanOrEqual(prev + 1e-9)
      prev = heroX
    }
  })
})
