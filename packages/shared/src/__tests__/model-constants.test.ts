import { describe, it, expect } from "vitest"
import { VIDEO_MODEL_CAPS, modelsForInputMode } from "../model-constants.js"

describe("modelsForInputMode", () => {
  it("returns kling for first_frame", () => {
    expect(modelsForInputMode("first_frame")).toContain("kling")
  })

  it("returns only kling-3-omni for multi_shot", () => {
    const models = modelsForInputMode("multi_shot")
    expect(models).toContain("kling-3-omni")
    expect(models).not.toContain("veo3.1")
    expect(models).not.toContain("hailuo-2.3-pro")
  })

  it("returns veo3.1 and seedance-2 for video_continuation", () => {
    const models = modelsForInputMode("video_continuation")
    expect(models).toContain("veo3.1")
    expect(models).toContain("seedance-2")
    expect(models).not.toContain("hailuo-2.3-pro")
  })

  it("returns empty array for an unsupported mode (frame_interpolation has no registered models yet)", () => {
    // No models registered for frame_interpolation in Phase 1B.2 — those land in
    // Phase 1C with RIFE/Topaz Apollo.
    expect(modelsForInputMode("frame_interpolation")).toEqual([])
  })
})

describe("VIDEO_MODEL_CAPS shape", () => {
  it("every model has a non-empty inputModes array", () => {
    for (const [model, caps] of Object.entries(VIDEO_MODEL_CAPS)) {
      expect(caps.inputModes.length, `${model} has empty inputModes`).toBeGreaterThan(0)
    }
  })

  it("multi_shot models declare maxShotsPerCall", () => {
    for (const [model, caps] of Object.entries(VIDEO_MODEL_CAPS)) {
      if (caps.inputModes.includes("multi_shot")) {
        expect(caps.maxShotsPerCall, `${model} multi_shot must declare maxShotsPerCall`).toBeDefined()
      }
    }
  })

  it("video_continuation models declare supportsVideoExtension: true", () => {
    for (const [model, caps] of Object.entries(VIDEO_MODEL_CAPS)) {
      if (caps.inputModes.includes("video_continuation")) {
        expect(caps.supportsVideoExtension, `${model} video_continuation requires supportsVideoExtension`).toBe(true)
      }
    }
  })
})
