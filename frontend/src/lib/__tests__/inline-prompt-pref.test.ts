import { describe, it, expect, beforeEach } from "vitest"
import { getInlinePromptMode, setInlinePromptMode, INLINE_PROMPT_MODE_KEY } from "../inline-prompt-pref"

describe("inline-prompt-pref", () => {
  beforeEach(() => localStorage.removeItem(INLINE_PROMPT_MODE_KEY))

  it("defaults ON for a fresh device (the newcomer experience)", () => {
    expect(getInlinePromptMode()).toBe(true)
  })

  it("an explicit opt-out survives the ON default", () => {
    setInlinePromptMode(false)
    expect(localStorage.getItem(INLINE_PROMPT_MODE_KEY)).toBe("0")
    expect(getInlinePromptMode()).toBe(false)
  })

  it("an explicit opt-in round-trips", () => {
    setInlinePromptMode(true)
    expect(getInlinePromptMode()).toBe(true)
  })
})
