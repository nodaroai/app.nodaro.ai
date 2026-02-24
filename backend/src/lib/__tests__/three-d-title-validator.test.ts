import { describe, it, expect } from "vitest"
import { validateThreeDTitlePlan } from "../three-d-title-validator.js"

function makeValidPlan(overrides: Record<string, unknown> = {}) {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 150,
    backgroundColor: "#000000",
    camera: {
      fov: 75,
      position: [0, 0, 5] as [number, number, number],
      lookAt: [0, 0, 0] as [number, number, number],
    },
    lighting: {
      ambient: { intensity: 1.0, color: "#ffffff" },
      directional: [{ intensity: 2.0, color: "#ffffff", position: [5, 5, 5] as [number, number, number] }],
    },
    objects: [
      {
        id: "obj-1",
        type: "3d-text",
        text: "Hello",
        font: "Inter",
        size: 1.5,
        depth: 0.5,
        material: { type: "metallic", color: "#ff0073", metalness: 0.8, roughness: 0.2 },
        position: [0, 0, 0] as [number, number, number],
        animation: {
          type: "fade-in",
          startFrame: 0,
          durationFrames: 60,
        },
      },
    ],
    ...overrides,
  }
}

describe("validateThreeDTitlePlan", () => {
  it("accepts a valid plan", () => {
    const result = validateThreeDTitlePlan(makeValidPlan(), 30, 150, 1920, 1080)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.plan).not.toBeNull()
  })

  it("injects planType and dimensions", () => {
    const result = validateThreeDTitlePlan(
      makeValidPlan({ width: 800, height: 600 }),
      30,
      150,
      1920,
      1080,
    )
    expect(result.valid).toBe(true)
    expect(result.plan!.planType).toBe("3d-title")
    expect(result.plan!.width).toBe(1920)
    expect(result.plan!.height).toBe(1080)
  })

  it("injects backgroundMedia when provided", () => {
    const result = validateThreeDTitlePlan(
      makeValidPlan(),
      30,
      150,
      1920,
      1080,
      "https://example.com/bg.mp4",
    )
    expect(result.valid).toBe(true)
    expect(result.plan!.backgroundMedia).toBe("https://example.com/bg.mp4")
    expect(result.autoFixed).toContainEqual(expect.stringContaining("backgroundMedia"))
  })

  it("auto-fixes fps and duration", () => {
    const result = validateThreeDTitlePlan(
      makeValidPlan({ fps: 24, durationInFrames: 100 }),
      30,
      150,
      1920,
      1080,
    )
    expect(result.valid).toBe(true)
    expect(result.plan!.fps).toBe(30)
    expect(result.plan!.durationInFrames).toBe(150)
  })

  it("clamps material values at boundary of valid ranges", () => {
    const plan = makeValidPlan()
    ;(plan.objects[0] as any).material.metalness = 1.0
    ;(plan.objects[0] as any).material.roughness = 0.0
    const result = validateThreeDTitlePlan(plan, 30, 150, 1920, 1080)
    expect(result.valid).toBe(true)
    const obj = result.plan!.objects[0] as any
    // Values at the boundary should remain unchanged after clamping
    expect(obj.material.metalness).toBe(1)
    expect(obj.material.roughness).toBe(0)
  })

  it("rejects material values outside Zod schema ranges", () => {
    const plan = makeValidPlan()
    ;(plan.objects[0] as any).material.metalness = 5.0
    ;(plan.objects[0] as any).material.roughness = -1.0
    const result = validateThreeDTitlePlan(plan, 30, 150, 1920, 1080)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("clamps animation timing to fit within plan duration", () => {
    const plan = makeValidPlan()
    ;(plan.objects[0] as any).animation.startFrame = 140
    ;(plan.objects[0] as any).animation.durationFrames = 60
    const result = validateThreeDTitlePlan(plan, 30, 150, 1920, 1080)
    expect(result.valid).toBe(true)
    const obj = result.plan!.objects[0] as any
    expect(obj.animation.startFrame + obj.animation.durationFrames).toBeLessThanOrEqual(150)
  })

  it("handles particle-system objects", () => {
    const plan = makeValidPlan({
      objects: [
        {
          id: "p1",
          type: "particle-system",
          count: 500,
          size: 0.05,
          color: "#ffffff",
          spread: [2, 2, 2] as [number, number, number],
          speed: 1.0,
          opacity: 0.8,
        },
      ],
    })
    const result = validateThreeDTitlePlan(plan, 30, 150, 1920, 1080)
    expect(result.valid).toBe(true)
  })

  it("returns Zod errors for invalid data", () => {
    const result = validateThreeDTitlePlan({}, 30, 150, 1920, 1080)
    expect(result.valid).toBe(false)
    expect(result.plan).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
