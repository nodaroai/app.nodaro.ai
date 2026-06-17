// frontend/src/lib/__tests__/inline-prompt-pref.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import {
  INLINE_PROMPT_MODE_KEY,
  getInlinePromptMode,
  setInlinePromptMode,
} from "../inline-prompt-pref"

describe("inline-prompt-pref", () => {
  beforeEach(() => localStorage.clear())

  it("defaults to OFF when unset (ships dark; opt-in via the canvas toggle)", () => {
    expect(getInlinePromptMode()).toBe(false)
  })

  it("round-trips through localStorage under the documented key", () => {
    setInlinePromptMode(false)
    expect(localStorage.getItem(INLINE_PROMPT_MODE_KEY)).toBe("0")
    expect(getInlinePromptMode()).toBe(false)
    setInlinePromptMode(true)
    expect(localStorage.getItem(INLINE_PROMPT_MODE_KEY)).toBe("1")
    expect(getInlinePromptMode()).toBe(true)
  })
})
