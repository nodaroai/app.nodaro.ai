import { describe, it, expect } from "vitest"
import { validateMotionGraphicsPlan } from "../motion-graphics-validator.js"

function makeValidPlan(overrides: Record<string, unknown> = {}) {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 150,
    backgroundColor: "#000000",
    elements: [
      {
        id: "el-1",
        type: "text",
        text: "Hello World",
        fontFamily: "Inter",
        fontSize: 64,
        color: "#ffffff",
        x: 960,
        y: 540,
        animation: {
          type: "fade",
          startFrame: 0,
          durationFrames: 30,
        },
      },
    ],
    ...overrides,
  }
}

describe("validateMotionGraphicsPlan", () => {
  it("accepts a valid plan", () => {
    const result = validateMotionGraphicsPlan(makeValidPlan(), 30, 150)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.plan).not.toBeNull()
  })

  it("injects planType automatically", () => {
    const result = validateMotionGraphicsPlan(makeValidPlan(), 30, 150)
    expect(result.plan!.planType).toBe("motion-graphics")
  })

  it("auto-fixes fps and duration", () => {
    const result = validateMotionGraphicsPlan(
      makeValidPlan({ fps: 24, durationInFrames: 100 }),
      30,
      150,
    )
    expect(result.valid).toBe(true)
    expect(result.plan!.fps).toBe(30)
    expect(result.plan!.durationInFrames).toBe(150)
  })

  it("rounds frame numbers to integers", () => {
    const plan = makeValidPlan()
    ;(plan.elements[0] as any).animation.startFrame = 5.7
    ;(plan.elements[0] as any).animation.durationFrames = 29.3
    const result = validateMotionGraphicsPlan(plan, 30, 150)
    expect(result.valid).toBe(true)
    const el = result.plan!.elements[0] as any
    expect(el.animation.startFrame).toBe(6)
    expect(el.animation.durationFrames).toBe(29)
  })

  it("clamps text fontSize at Zod max boundary", () => {
    const plan = makeValidPlan()
    ;(plan.elements[0] as any).fontSize = 500
    const result = validateMotionGraphicsPlan(plan, 30, 150)
    expect(result.valid).toBe(true)
    const el = result.plan!.elements[0] as any
    expect(el.fontSize).toBe(500)
  })

  it("rejects text fontSize above Zod max (500)", () => {
    const plan = makeValidPlan()
    ;(plan.elements[0] as any).fontSize = 1000
    const result = validateMotionGraphicsPlan(plan, 30, 150)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("rounds element positions to integers", () => {
    const plan = makeValidPlan()
    ;(plan.elements[0] as any).x = 100.7
    ;(plan.elements[0] as any).y = 200.3
    const result = validateMotionGraphicsPlan(plan, 30, 150)
    expect(result.valid).toBe(true)
    const el = result.plan!.elements[0] as any
    expect(el.x).toBe(101)
    expect(el.y).toBe(200)
  })

  it("handles shape elements", () => {
    const plan = makeValidPlan({
      elements: [
        {
          id: "sh-1",
          type: "shape",
          shape: "rectangle",
          fill: "#ff0073",
          x: 100,
          y: 100,
          width: 400,
          height: 200,
          animation: { type: "wipe-in", startFrame: 0, durationFrames: 30 },
        },
      ],
    })
    const result = validateMotionGraphicsPlan(plan, 30, 150)
    expect(result.valid).toBe(true)
  })

  it("handles svg-path elements", () => {
    const plan = makeValidPlan({
      elements: [
        {
          id: "svg-1",
          type: "svg-path",
          path: "M 0 0 L 100 100",
          stroke: "#ffffff",
          strokeWidth: 2,
          x: 50,
          y: 50,
          animation: { type: "draw-path", startFrame: 0, durationFrames: 60 },
        },
      ],
    })
    const result = validateMotionGraphicsPlan(plan, 30, 150)
    expect(result.valid).toBe(true)
  })

  it("rounds exit animation frames", () => {
    const plan = makeValidPlan({
      exitAnimation: {
        type: "fade",
        startFrame: 120.7,
        durationFrames: 29.3,
      },
    })
    const result = validateMotionGraphicsPlan(plan, 30, 150)
    expect(result.valid).toBe(true)
    expect(result.plan!.exitAnimation!.startFrame).toBe(121)
    expect(result.plan!.exitAnimation!.durationFrames).toBe(29)
  })

  it("returns Zod errors for invalid data", () => {
    const result = validateMotionGraphicsPlan({ elements: [] }, 30, 150)
    expect(result.valid).toBe(false)
    expect(result.plan).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
