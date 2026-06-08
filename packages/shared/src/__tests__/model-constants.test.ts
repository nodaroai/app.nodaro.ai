import { describe, it, expect } from "vitest"
import {
  VIDEO_MODEL_CAPS,
  modelsForInputMode,
  preferredInputModeForModel,
  seedance2AudioLimitSec,
  findSeedance2AudioOverLimit,
} from "../model-constants.js"

describe("seedance2AudioLimitSec", () => {
  it("returns the verified 15.2s cap for seedance-2-fast (KIE r2v)", () => {
    expect(seedance2AudioLimitSec("seedance-2-fast")).toBe(15.2)
  })

  it("returns null for providers without a verified cap (no false rejects)", () => {
    expect(seedance2AudioLimitSec("seedance-2")).toBeNull() // non-fast limit unverified
    expect(seedance2AudioLimitSec("minimax")).toBeNull()
    expect(seedance2AudioLimitSec(undefined)).toBeNull()
  })
})

describe("findSeedance2AudioOverLimit", () => {
  it("flags the first reference audio over the cap", () => {
    expect(findSeedance2AudioOverLimit("seedance-2-fast", [10, 16, 12])).toBe(16)
  })

  it("allows audio at or under the cap", () => {
    expect(findSeedance2AudioOverLimit("seedance-2-fast", [10, 15.2])).toBeNull()
    expect(findSeedance2AudioOverLimit("seedance-2-fast", [15.2])).toBeNull()
  })

  it("never rejects for providers without an enforced cap", () => {
    expect(findSeedance2AudioOverLimit("seedance-2", [99])).toBeNull()
    expect(findSeedance2AudioOverLimit("minimax", [99])).toBeNull()
  })

  it("ignores non-finite durations (probe failures) but still catches a real overage", () => {
    expect(findSeedance2AudioOverLimit("seedance-2-fast", [NaN, 20])).toBe(20)
    expect(findSeedance2AudioOverLimit("seedance-2-fast", [NaN])).toBeNull()
  })
})

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

  it("returns the interpolation models (rife, topaz-apollo) for frame_interpolation", () => {
    // Phase 1C registered RIFE + Topaz Apollo for Method 8 frame interpolation.
    const models = modelsForInputMode("frame_interpolation")
    expect(models).toContain("rife")
    expect(models).toContain("topaz-apollo")
  })
})

describe("preferredInputModeForModel", () => {
  it("prefers ref_images for a multi-ref model (seedance-2)", () => {
    expect(preferredInputModeForModel("seedance-2")).toBe("ref_images")
  })

  it("prefers ref_images for kling-3-omni", () => {
    expect(preferredInputModeForModel("kling-3-omni")).toBe("ref_images")
  })

  it("falls back to first_frame for a keyframe-only model (kling-turbo)", () => {
    expect(preferredInputModeForModel("kling-turbo")).toBe("first_frame")
  })

  it("never auto-selects first_last_frame even when the model supports it (minimax)", () => {
    // minimax declares first_frame + first_last_frame; the animate stage does
    // not implement paired keyframes yet, so first_frame must win.
    expect(VIDEO_MODEL_CAPS["minimax"]!.inputModes).toContain("first_last_frame")
    expect(preferredInputModeForModel("minimax")).toBe("first_frame")
  })

  it("returns undefined for an unregistered model so the caller keeps its default", () => {
    expect(preferredInputModeForModel("seedance-2-fast")).toBeUndefined()
    expect(preferredInputModeForModel("veo3")).toBeUndefined()
  })

  it("returns undefined for undefined input", () => {
    expect(preferredInputModeForModel(undefined)).toBeUndefined()
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
