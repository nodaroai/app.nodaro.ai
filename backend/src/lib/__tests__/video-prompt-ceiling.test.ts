import { describe, it, expect } from "vitest"
import { NATIVE_NEGATIVE_VIDEO_PROVIDERS, getMaxVideoPromptChars, applyVideoNegativePrompt } from "@nodaro/shared"
import { effectiveVideoPromptCeiling } from "../video-prompt-ceiling.js"

/**
 * The helper exists to keep the direction-fold truncation warning honest. Its
 * only contract is "agree with `applyVideoNegativePrompt`", so the tests assert
 * against that function's real behaviour rather than against a re-derived
 * number.
 */
describe("effectiveVideoPromptCeiling", () => {
  const NATIVE = "kling"
  const NON_NATIVE = "minimax"

  it("is the raw model cap when there is no negative prompt", () => {
    expect(effectiveVideoPromptCeiling(NON_NATIVE, undefined)).toBe(getMaxVideoPromptChars(NON_NATIVE))
    expect(effectiveVideoPromptCeiling(NON_NATIVE, "   ")).toBe(getMaxVideoPromptChars(NON_NATIVE))
  })

  it("is the raw model cap for a native-negative provider (the negative rides its own param)", () => {
    expect(NATIVE_NEGATIVE_VIDEO_PROVIDERS.has(NATIVE)).toBe(true)
    expect(effectiveVideoPromptCeiling(NATIVE, "blurry, low quality")).toBe(getMaxVideoPromptChars(NATIVE))
  })

  it("reserves the '\\nAvoid: …' suffix for a non-native provider", () => {
    expect(NATIVE_NEGATIVE_VIDEO_PROVIDERS.has(NON_NATIVE)).toBe(false)
    const neg = "blurry, low quality"
    expect(effectiveVideoPromptCeiling(NON_NATIVE, neg)).toBe(
      getMaxVideoPromptChars(NON_NATIVE) - `\nAvoid: ${neg}`.length,
    )
  })

  it("is exactly the length at which the clamp starts cutting the base prompt", () => {
    const neg = "blurry"
    const ceiling = effectiveVideoPromptCeiling(NON_NATIVE, neg)
    const atCeiling = "a".repeat(ceiling)
    const overCeiling = "a".repeat(ceiling + 1)

    // At the ceiling the base survives whole; one char over and it is cut.
    expect(applyVideoNegativePrompt(atCeiling, neg, NON_NATIVE).prompt)
      .toContain(atCeiling)
    expect(applyVideoNegativePrompt(overCeiling, neg, NON_NATIVE).prompt)
      .not.toContain(overCeiling)
  })

  it("never returns a negative ceiling for an absurdly long negative", () => {
    expect(effectiveVideoPromptCeiling(NON_NATIVE, "x".repeat(100_000))).toBe(0)
  })
})
