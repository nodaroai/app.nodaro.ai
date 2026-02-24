import { describe, it, expect } from "vitest"
import { validateAfterEffectsPlan } from "../after-effects-validator.js"

function makeValidPlan(overrides: Record<string, unknown> = {}) {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    sourceVideo: "https://example.com/video.mp4",
    effects: [
      {
        type: "color-grade",
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.0,
        temperature: 0,
      },
    ],
    ...overrides,
  }
}

describe("validateAfterEffectsPlan", () => {
  it("accepts a valid plan", () => {
    const result = validateAfterEffectsPlan(
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
    const result = validateAfterEffectsPlan(
      makeValidPlan({ sourceVideo: "https://wrong.com/vid.mp4" }),
      "https://example.com/actual.mp4",
      30,
      300,
    )
    expect(result.valid).toBe(true)
    expect(result.plan!.planType).toBe("after-effects")
    expect(result.plan!.sourceVideo).toBe("https://example.com/actual.mp4")
    expect(result.autoFixed).toContainEqual(expect.stringContaining("sourceVideo"))
  })

  it("auto-fixes fps to expected value", () => {
    const result = validateAfterEffectsPlan(
      makeValidPlan({ fps: 24 }),
      "https://example.com/video.mp4",
      30,
      300,
    )
    expect(result.valid).toBe(true)
    expect(result.plan!.fps).toBe(30)
    expect(result.autoFixed).toContainEqual(expect.stringContaining("fps"))
  })

  it("auto-fixes durationInFrames to expected value", () => {
    const result = validateAfterEffectsPlan(
      makeValidPlan({ durationInFrames: 250 }),
      "https://example.com/video.mp4",
      30,
      300,
    )
    expect(result.valid).toBe(true)
    expect(result.plan!.durationInFrames).toBe(300)
  })

  it("clamps effect values within valid ranges", () => {
    const result = validateAfterEffectsPlan(
      makeValidPlan({
        effects: [
          {
            type: "color-grade",
            brightness: 2.0,
            contrast: 0.5,
            saturation: 3.0,
            temperature: 100,
          },
        ],
      }),
      "https://example.com/video.mp4",
      30,
      300,
    )
    expect(result.valid).toBe(true)
    const effect = result.plan!.effects[0] as any
    // Values at the boundary should be clamped to stay within range
    expect(effect.brightness).toBe(2.0)
    expect(effect.contrast).toBe(0.5)
    expect(effect.saturation).toBe(3.0)
    expect(effect.temperature).toBe(100)
  })

  it("rejects effect values outside Zod schema ranges", () => {
    const result = validateAfterEffectsPlan(
      makeValidPlan({
        effects: [
          {
            type: "color-grade",
            brightness: 5.0,
            contrast: -1.0,
            saturation: 10.0,
            temperature: 200,
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

  it("rounds text overlay frames to integers", () => {
    const result = validateAfterEffectsPlan(
      makeValidPlan({
        textOverlays: [
          {
            id: "t1",
            text: "Hello",
            startFrame: 10.7,
            durationInFrames: 50.3,
            position: "center",
            fontSize: 48,
            color: "#ffffff",
            animation: "fade",
          },
        ],
      }),
      "https://example.com/video.mp4",
      30,
      300,
    )
    expect(result.valid).toBe(true)
    expect(result.plan!.textOverlays![0].startFrame).toBe(11)
    expect(result.plan!.textOverlays![0].durationInFrames).toBe(50)
  })

  it("returns Zod errors for invalid data", () => {
    const result = validateAfterEffectsPlan(
      { effects: [] },
      "https://example.com/video.mp4",
      30,
      300,
    )
    expect(result.valid).toBe(false)
    expect(result.plan).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
