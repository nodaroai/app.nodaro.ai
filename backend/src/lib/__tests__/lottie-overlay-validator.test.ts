import { describe, it, expect } from "vitest"
import { validateLottieOverlayPlan } from "../lottie-overlay-validator.js"

function makeValidPlan(overrides: Record<string, unknown> = {}) {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    sourceVideo: "https://example.com/video.mp4",
    overlays: [
      {
        id: "ov-1",
        src: "https://example.com/animation.json",
        startFrame: 0,
        durationInFrames: 150,
        position: { x: 10, y: 10, width: 30, height: 30 },
        opacity: 1,
        playbackRate: 1,
        loop: true,
      },
    ],
    ...overrides,
  }
}

describe("validateLottieOverlayPlan", () => {
  it("accepts a valid plan", () => {
    const result = validateLottieOverlayPlan(
      makeValidPlan(),
      "https://example.com/video.mp4",
      30,
      300,
    )
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.plan).not.toBeNull()
  })

  it("injects planType and sourceVideo", () => {
    const result = validateLottieOverlayPlan(
      makeValidPlan({ sourceVideo: "https://wrong.com/v.mp4" }),
      "https://example.com/actual.mp4",
      30,
      300,
    )
    expect(result.valid).toBe(true)
    expect(result.plan!.planType).toBe("lottie-overlay")
    expect(result.plan!.sourceVideo).toBe("https://example.com/actual.mp4")
  })

  it("auto-fixes fps and duration", () => {
    const result = validateLottieOverlayPlan(
      makeValidPlan({ fps: 24, durationInFrames: 250 }),
      "https://example.com/video.mp4",
      30,
      300,
    )
    expect(result.valid).toBe(true)
    expect(result.plan!.fps).toBe(30)
    expect(result.plan!.durationInFrames).toBe(300)
  })

  it("clamps overlay values at boundary of valid ranges", () => {
    const result = validateLottieOverlayPlan(
      makeValidPlan({
        overlays: [
          {
            id: "ov-1",
            src: "https://example.com/animation.json",
            startFrame: 0,
            durationInFrames: 150,
            position: { x: 100, y: 0, width: 100, height: 50 },
            opacity: 1,
            playbackRate: 3.0,
            loop: true,
          },
        ],
      }),
      "https://example.com/video.mp4",
      30,
      300,
    )
    expect(result.valid).toBe(true)
    const ov = result.plan!.overlays[0]
    // Values at the boundary should remain unchanged after clamping
    expect(ov.position.x).toBe(100)
    expect(ov.position.y).toBe(0)
    expect(ov.opacity).toBe(1)
    expect(ov.playbackRate).toBe(3.0)
  })

  it("rejects overlay values outside Zod schema ranges", () => {
    const result = validateLottieOverlayPlan(
      makeValidPlan({
        overlays: [
          {
            id: "ov-1",
            src: "https://example.com/animation.json",
            startFrame: 0,
            durationInFrames: 150,
            position: { x: 150, y: -10, width: 200, height: 50 },
            opacity: 2.0,
            playbackRate: 5.0,
            loop: true,
          },
        ],
      }),
      "https://example.com/video.mp4",
      30,
      300,
    )
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("clamps overlay timing to fit within plan duration", () => {
    const result = validateLottieOverlayPlan(
      makeValidPlan({
        overlays: [
          {
            id: "ov-1",
            src: "https://example.com/animation.json",
            startFrame: 290,
            durationInFrames: 50,
            position: { x: 10, y: 10, width: 30, height: 30 },
            opacity: 1,
            playbackRate: 1,
            loop: true,
          },
        ],
      }),
      "https://example.com/video.mp4",
      30,
      300,
    )
    expect(result.valid).toBe(true)
    const ov = result.plan!.overlays[0]
    expect(ov.startFrame + ov.durationInFrames).toBeLessThanOrEqual(300)
  })

  it("returns Zod errors for invalid data", () => {
    const result = validateLottieOverlayPlan(
      { overlays: [] },
      "https://example.com/video.mp4",
      30,
      300,
    )
    expect(result.valid).toBe(false)
    expect(result.plan).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
