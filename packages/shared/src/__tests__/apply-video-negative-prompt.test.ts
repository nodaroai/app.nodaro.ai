import { describe, it, expect } from "vitest"
import { applyVideoNegativePrompt, NATIVE_NEGATIVE_VIDEO_PROVIDERS } from "../model-constants.js"

describe("applyVideoNegativePrompt", () => {
  it("returns prompt unchanged + nativeNegativePrompt when provider is native", () => {
    const result = applyVideoNegativePrompt("a cat dancing", "blurry, distorted", "kling")
    expect(result.prompt).toBe("a cat dancing")
    expect(result.nativeNegativePrompt).toBe("blurry, distorted")
  })

  it("injects 'Avoid: …' into prompt for non-native providers", () => {
    const result = applyVideoNegativePrompt("a cat dancing", "blurry, distorted", "wan-animate-move")
    expect(result.prompt).toBe("a cat dancing\nAvoid: blurry, distorted")
    expect(result.nativeNegativePrompt).toBeUndefined()
  })

  it("returns 'Avoid: …' alone when prompt is empty and provider is non-native", () => {
    const result = applyVideoNegativePrompt("", "blurry", "veo3")
    expect(result.prompt).toBe("Avoid: blurry")
    expect(result.nativeNegativePrompt).toBeUndefined()
  })

  it("returns 'Avoid: …' alone when prompt is undefined", () => {
    const result = applyVideoNegativePrompt(undefined, "blurry", "veo3")
    expect(result.prompt).toBe("Avoid: blurry")
  })

  it("is a no-op when negativePrompt is empty", () => {
    const result = applyVideoNegativePrompt("a cat", "", "kling")
    expect(result.prompt).toBe("a cat")
    expect(result.nativeNegativePrompt).toBeUndefined()
  })

  it("is a no-op when negativePrompt is whitespace only", () => {
    const result = applyVideoNegativePrompt("a cat", "   ", "wan-animate-move")
    expect(result.prompt).toBe("a cat")
    expect(result.nativeNegativePrompt).toBeUndefined()
  })

  it("is a no-op when negativePrompt is undefined", () => {
    const result = applyVideoNegativePrompt("a cat", undefined, "wan-animate-move")
    expect(result.prompt).toBe("a cat")
    expect(result.nativeNegativePrompt).toBeUndefined()
  })

  it("trims surrounding whitespace before sending native", () => {
    const result = applyVideoNegativePrompt("a cat", "  blurry  ", "kling-3.0")
    expect(result.nativeNegativePrompt).toBe("blurry")
  })

  it("includes the Kling family in the native set", () => {
    for (const p of ["kling", "kling-turbo", "kling-master", "kling-3.0", "kling-3-omni"]) {
      expect(NATIVE_NEGATIVE_VIDEO_PROVIDERS.has(p)).toBe(true)
    }
  })

  it("includes regular Wan in the native set but excludes Wan Animate", () => {
    expect(NATIVE_NEGATIVE_VIDEO_PROVIDERS.has("wan")).toBe(true)
    expect(NATIVE_NEGATIVE_VIDEO_PROVIDERS.has("wan-i2v")).toBe(true)
    expect(NATIVE_NEGATIVE_VIDEO_PROVIDERS.has("wan-animate-move")).toBe(false)
    expect(NATIVE_NEGATIVE_VIDEO_PROVIDERS.has("wan-animate-replace")).toBe(false)
  })

  it("excludes VEO / Hailuo / Sora / Bytedance / Grok families", () => {
    for (const p of [
      "veo3", "veo3.1", "veo3_lite",
      "minimax", "hailuo-2.3-pro", "hailuo-2.3", "hailuo-standard",
      "sora2", "sora2-pro",
      "bytedance-lite", "bytedance-pro",
      "grok", "grok-i2v",
      "seedance", "seedance-2",
    ]) {
      expect(NATIVE_NEGATIVE_VIDEO_PROVIDERS.has(p)).toBe(false)
    }
  })
})
