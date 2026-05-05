import { describe, it, expect } from "vitest"
import { validatePlanByType } from "../plan-schemas.js"

const validPlan = {
  sourceVideo: "https://example.com/v.mp4",
  captions: [{ text: "hi", startMs: 0, endMs: 500, timestampMs: 0, confidence: null }],
  style: "tiktok-words" as const,
  position: "bottom" as const,
  fontSize: 32,
  color: "#fff",
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 90,
}

describe("burn-captions plan validation", () => {
  it("accepts a well-formed plan", () => {
    expect(() => validatePlanByType("burn-captions", validPlan)).not.toThrow()
  })

  it("rejects empty captions array", () => {
    expect(() => validatePlanByType("burn-captions", { ...validPlan, captions: [] })).toThrow()
  })

  it("rejects unknown style", () => {
    expect(() => validatePlanByType("burn-captions", { ...validPlan, style: "fancy" })).toThrow()
  })

  it("rejects missing sourceVideo", () => {
    const { sourceVideo: _, ...rest } = validPlan
    expect(() => validatePlanByType("burn-captions", rest)).toThrow()
  })

  it("accepts captions with timestampMs: null (per @remotion/captions Caption type)", () => {
    const planWithNull = {
      ...validPlan,
      captions: [{ text: "hi", startMs: 0, endMs: 500, timestampMs: null, confidence: null }],
    }
    expect(() => validatePlanByType("burn-captions", planWithNull)).not.toThrow()
  })
})
