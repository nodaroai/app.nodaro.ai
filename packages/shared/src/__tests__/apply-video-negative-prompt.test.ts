import { describe, it, expect } from "vitest"
import {
  applyVideoNegativePrompt,
  videoNegativeSuffix,
  NATIVE_NEGATIVE_VIDEO_PROVIDERS,
} from "../model-constants.js"

/**
 * A composed prompt that ends with the `[style]` section — what
 * `@nodaro/prompts` emits for any run that picks a look dimension. The section
 * has no terminator, so a `"\n"`-joined `Avoid:` reads as one more look clause
 * under its header.
 */
const SECTIONED = "a knight rides\n\n[style]:\nanime style\nwide shot"

describe("videoNegativeSuffix", () => {
  it("joins on one newline for an ordinary prompt", () => {
    expect(videoNegativeSuffix("blurry", "a knight rides")).toBe("\nAvoid: blurry")
  })

  it("closes an open `[style]` section with a blank line", () => {
    expect(videoNegativeSuffix("blurry", SECTIONED)).toBe("\n\nAvoid: blurry")
  })

  it("joins on one newline once something else closed the section", () => {
    expect(videoNegativeSuffix("blurry", `${SECTIONED}\n\nthe person from @image_1`))
      .toBe("\nAvoid: blurry")
  })

  it("is the WIDEST form with no base — what a caller reserving room must budget", () => {
    // `effectiveVideoPromptCeiling` reserves before the prompt exists.
    expect(videoNegativeSuffix("blurry")).toBe("\n\nAvoid: blurry")
  })
})

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

  it("separates 'Avoid: …' from an unterminated `[style]` section", () => {
    const result = applyVideoNegativePrompt(SECTIONED, "blurry", "wan-animate-move")
    expect(result.prompt).toBe(`${SECTIONED}\n\nAvoid: blurry`)
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
