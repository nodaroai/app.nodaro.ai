import { describe, it, expect } from "vitest"
import { PROMPT_PREFIX_KEY, PROMPT_SUFFIX_KEY, readPromptAffixes } from "../prompt-affixes.js"

describe("prompt-affixes keys", () => {
  it("names the node-data keys", () => {
    expect(PROMPT_PREFIX_KEY).toBe("promptPrefix")
    expect(PROMPT_SUFFIX_KEY).toBe("promptSuffix")
  })
})

describe("readPromptAffixes", () => {
  it("returns both affixes when set", () =>
    expect(readPromptAffixes({ promptPrefix: "PRE", promptSuffix: "POST" })).toEqual({ prefix: "PRE", suffix: "POST" }))
  it("omits blank / non-string values", () =>
    expect(readPromptAffixes({ promptPrefix: "   ", promptSuffix: 42 })).toEqual({}))
  it("omits absent keys", () => expect(readPromptAffixes({ prompt: "x" })).toEqual({}))
  it("keeps internal/trailing whitespace of a non-blank affix verbatim", () =>
    expect(readPromptAffixes({ promptPrefix: "RULES:\n\n" })).toEqual({ prefix: "RULES:\n\n" }))
})

/**
 * Presets capture the affixes for free: `extractPresetData` strips only
 * PRESET_EXCLUDED_KEYS + EXECUTION_DATA_KEYS, and the affix keys are in
 * neither. This test pins that contract so a future addition to either
 * exclusion set can't silently drop pre/post text from saved presets.
 */
import { extractPresetData } from "../node-preset-extract.js"
describe("presets capture prompt affixes", () => {
  it("extractPresetData keeps promptPrefix/promptSuffix", () =>
    expect(extractPresetData({ prompt: "p", promptPrefix: "PRE", promptSuffix: "POST", label: "x", executionStatus: "running" }))
      .toEqual({ prompt: "p", promptPrefix: "PRE", promptSuffix: "POST" }))
})
