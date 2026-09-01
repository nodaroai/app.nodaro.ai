import { describe, it, expect } from "vitest"
import {
  NATIVE_NEGATIVE_VIDEO_PROVIDERS,
  getMaxVideoPromptChars,
  applyVideoNegativePrompt,
  videoNegativeSuffix,
} from "@nodaro/shared"
import { effectiveVideoPromptCeiling } from "../video-prompt-ceiling.js"

/**
 * The helper exists to keep the direction-fold truncation warning honest. Its
 * only contract is "agree with `applyVideoNegativePrompt`", so the tests assert
 * against that function's real behaviour rather than against a re-derived
 * number.
 *
 * The clamp's separator depends on the prompt (a blank line closes an open
 * `[style]` section), and this ceiling is computed before that prompt exists —
 * so it budgets the WIDEST suffix and is exact for a sectioned prompt, one byte
 * conservative for a plain one.
 */
/** A composed prompt that ends with the `[style]` section — the common shape
 *  once a `direction` folds, and the one the wide separator is for. */
const SECTION_TAIL = "\n\n[style]:\nanime style"
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

  it("reserves the WIDEST 'Avoid: …' suffix for a non-native provider", () => {
    expect(NATIVE_NEGATIVE_VIDEO_PROVIDERS.has(NON_NATIVE)).toBe(false)
    const neg = "blurry, low quality"
    expect(effectiveVideoPromptCeiling(NON_NATIVE, neg)).toBe(
      getMaxVideoPromptChars(NON_NATIVE) - `\n\nAvoid: ${neg}`.length,
    )
    // …which is the clamp's own suffix helper, measured with no base prompt.
    expect(effectiveVideoPromptCeiling(NON_NATIVE, neg)).toBe(
      getMaxVideoPromptChars(NON_NATIVE) - videoNegativeSuffix(neg).length,
    )
  })

  it("is exactly the length at which the clamp starts cutting a sectioned prompt", () => {
    const neg = "blurry"
    const ceiling = effectiveVideoPromptCeiling(NON_NATIVE, neg)
    const atCeiling = "a".repeat(ceiling - SECTION_TAIL.length) + SECTION_TAIL
    const overCeiling = "a".repeat(ceiling - SECTION_TAIL.length + 1) + SECTION_TAIL

    // At the ceiling the base survives whole; one char over and it is cut.
    expect(applyVideoNegativePrompt(atCeiling, neg, NON_NATIVE).prompt)
      .toContain(atCeiling)
    expect(applyVideoNegativePrompt(overCeiling, neg, NON_NATIVE).prompt)
      .not.toContain(overCeiling)
  })

  it("is one byte conservative for a prompt with no section", () => {
    // A plain prompt takes the narrow `"\nAvoid: "`, so the budget leaves one
    // byte on the table rather than handing a byte back to the order-blind cut.
    const neg = "blurry"
    const ceiling = effectiveVideoPromptCeiling(NON_NATIVE, neg)
    const oneOver = "a".repeat(ceiling + 1)
    expect(applyVideoNegativePrompt(oneOver, neg, NON_NATIVE).prompt).toContain(oneOver)
    expect(applyVideoNegativePrompt("a".repeat(ceiling + 2), neg, NON_NATIVE).prompt)
      .not.toContain("a".repeat(ceiling + 2))
  })

  it("never returns a negative ceiling for an absurdly long negative", () => {
    expect(effectiveVideoPromptCeiling(NON_NATIVE, "x".repeat(100_000))).toBe(0)
  })
})
