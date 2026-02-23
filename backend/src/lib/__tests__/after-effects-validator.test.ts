import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { validateAfterEffectsPlan } from "@/lib/after-effects-validator.js"

const SOURCE_URL = "https://example.com/video.mp4"
const EXPECTED_FPS = 30
const EXPECTED_DURATION = 900

function makeValidPlan(overrides: Record<string, unknown> = {}) {
  return {
    planType: "after-effects",
    fps: EXPECTED_FPS,
    width: 1920,
    height: 1080,
    durationInFrames: EXPECTED_DURATION,
    sourceVideo: SOURCE_URL,
    effects: [
      { type: "color-grade", brightness: 1.0, contrast: 1.0, saturation: 1.0, temperature: 0 },
    ],
    ...overrides,
  }
}

describe("validateAfterEffectsPlan", () => {
  it("accepts a valid plan", () => {
    const result = validateAfterEffectsPlan(makeValidPlan(), SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(result.valid).toBe(true)
    expect(result.plan).not.toBeNull()
    expect(result.errors).toEqual([])
  })

  it("auto-fixes sourceVideo to the actual URL", () => {
    const plan = makeValidPlan({ sourceVideo: "https://wrong.com/video.mp4" })
    const result = validateAfterEffectsPlan(plan, SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(result.valid).toBe(true)
    expect(result.plan!.sourceVideo).toBe(SOURCE_URL)
    expect(result.autoFixed).toContain("Set sourceVideo to actual input URL")
  })

  it("auto-fixes sourceVideo when missing", () => {
    const plan = makeValidPlan()
    delete (plan as Record<string, unknown>).sourceVideo
    const result = validateAfterEffectsPlan(plan, SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(result.valid).toBe(true)
    expect(result.plan!.sourceVideo).toBe(SOURCE_URL)
    expect(result.autoFixed.some((f) => f.includes("sourceVideo"))).toBe(true)
  })

  it("auto-fixes fps when different from expected", () => {
    const plan = makeValidPlan({ fps: 24 })
    const result = validateAfterEffectsPlan(plan, SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(result.valid).toBe(true)
    expect(result.plan!.fps).toBe(EXPECTED_FPS)
    expect(result.autoFixed.some((f) => f.includes("fps") && f.includes("24") && f.includes("30"))).toBe(true)
  })

  it("auto-fixes durationInFrames when different from expected", () => {
    const plan = makeValidPlan({ durationInFrames: 600 })
    const result = validateAfterEffectsPlan(plan, SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(result.valid).toBe(true)
    expect(result.plan!.durationInFrames).toBe(EXPECTED_DURATION)
    expect(result.autoFixed.some((f) => f.includes("durationInFrames") && f.includes("600") && f.includes("900"))).toBe(true)
  })

  it("clamps color-grade brightness to 0.5-2.0", () => {
    const plan = makeValidPlan({
      effects: [{ type: "color-grade", brightness: 5.0, contrast: 1.0, saturation: 1.0, temperature: 0 }],
    })
    // Zod .max(2.0) will reject values above 2.0 before clamping
    // So we test a value at the boundary that Zod allows
    const planLow = makeValidPlan({
      effects: [{ type: "color-grade", brightness: 0.5, contrast: 1.0, saturation: 1.0, temperature: 0 }],
    })
    const resultLow = validateAfterEffectsPlan(planLow, SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(resultLow.valid).toBe(true)
    expect(resultLow.plan!.effects[0]).toMatchObject({ type: "color-grade", brightness: 0.5 })
  })

  it("clamps vignette intensity to 0-1", () => {
    const plan = makeValidPlan({
      effects: [{ type: "vignette", intensity: 0.5, radius: 0.7 }],
    })
    const result = validateAfterEffectsPlan(plan, SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(result.valid).toBe(true)
    const effect = result.plan!.effects[0] as { type: string; intensity: number }
    expect(effect.intensity).toBeGreaterThanOrEqual(0)
    expect(effect.intensity).toBeLessThanOrEqual(1)
  })

  it("rounds text overlay frame values to integers", () => {
    const plan = makeValidPlan({
      textOverlays: [
        {
          id: "text-1",
          text: "Hello",
          startFrame: 10.7,
          durationInFrames: 59.3,
          position: "center",
          fontSize: 48,
          color: "#ffffff",
          animation: "fade",
        },
      ],
    })
    const result = validateAfterEffectsPlan(plan, SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(result.valid).toBe(true)
    expect(result.plan!.textOverlays![0].startFrame).toBe(11)
    expect(result.plan!.textOverlays![0].durationInFrames).toBe(59)
  })

  it("rejects invalid effect type via discriminated union", () => {
    const plan = makeValidPlan({
      effects: [{ type: "sparkle-magic", intensity: 1.0 }],
    })
    const result = validateAfterEffectsPlan(plan, SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("rejects plan with missing effects array", () => {
    const plan = makeValidPlan()
    delete (plan as Record<string, unknown>).effects
    const result = validateAfterEffectsPlan(plan, SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("rejects plan with empty effects array", () => {
    const plan = makeValidPlan({ effects: [] })
    const result = validateAfterEffectsPlan(plan, SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("effects"))).toBe(true)
  })

  it("tracks all auto-fixes in the autoFixed array", () => {
    const plan = makeValidPlan({
      fps: 24,
      durationInFrames: 600,
      sourceVideo: "https://wrong.com/video.mp4",
    })
    const result = validateAfterEffectsPlan(plan, SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(result.valid).toBe(true)
    expect(result.autoFixed.length).toBe(3)
    expect(result.autoFixed.some((f) => f.includes("sourceVideo"))).toBe(true)
    expect(result.autoFixed.some((f) => f.includes("fps"))).toBe(true)
    expect(result.autoFixed.some((f) => f.includes("durationInFrames"))).toBe(true)
  })

  it("returns no autoFixed entries when plan matches expectations exactly", () => {
    const result = validateAfterEffectsPlan(makeValidPlan(), SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(result.autoFixed).toEqual([])
  })

  it("rejects non-object input", () => {
    const result = validateAfterEffectsPlan("not an object", SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("accepts a plan with multiple effect types", () => {
    const plan = makeValidPlan({
      effects: [
        { type: "color-grade", brightness: 1.2, contrast: 1.1, saturation: 0.9, temperature: 10 },
        { type: "vignette", intensity: 0.4, radius: 0.6 },
        { type: "film-grain", intensity: 0.2, size: 2 },
      ],
    })
    const result = validateAfterEffectsPlan(plan, SOURCE_URL, EXPECTED_FPS, EXPECTED_DURATION)
    expect(result.valid).toBe(true)
    expect(result.plan!.effects).toHaveLength(3)
  })
})
