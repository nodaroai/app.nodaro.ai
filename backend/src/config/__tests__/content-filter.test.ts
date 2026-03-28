import { describe, it, expect } from "vitest"
import { GALLERY_BLOCKED_WORDS, isPromptBlocked } from "../content-filter"

describe("isPromptBlocked", () => {
  it("returns false for null", () => {
    expect(isPromptBlocked(null)).toBe(false)
  })

  it("returns false for undefined", () => {
    expect(isPromptBlocked(undefined)).toBe(false)
  })

  it("returns false for empty string", () => {
    expect(isPromptBlocked("")).toBe(false)
  })

  it("returns false for normal prompts", () => {
    expect(isPromptBlocked("A beautiful landscape")).toBe(false)
  })

  it("blocks partial match on 'nude'", () => {
    expect(isPromptBlocked("nude photo")).toBe(true)
  })

  it("is case insensitive", () => {
    expect(isPromptBlocked("NSFW content")).toBe(true)
  })

  it("blocks 'erotic'", () => {
    expect(isPromptBlocked("This is erotic")).toBe(true)
  })

  it("blocks substring match for 'sex'", () => {
    expect(isPromptBlocked("sexy")).toBe(true)
  })

  it("blocks words containing 'sex' as substring", () => {
    expect(isPromptBlocked("Essex")).toBe(true)
  })

  it("blocks 'masturbat' prefix match", () => {
    expect(isPromptBlocked("masturbation")).toBe(true)
  })

  it("blocks every word in GALLERY_BLOCKED_WORDS", () => {
    for (const word of GALLERY_BLOCKED_WORDS) {
      expect(isPromptBlocked(word)).toBe(true)
    }
  })

  it("passes normal creative prompts", () => {
    const safe = [
      "A sunset over the ocean",
      "Cyberpunk city at night",
      "Portrait of a woman in a garden",
      "Abstract geometric pattern",
    ]
    for (const prompt of safe) {
      expect(isPromptBlocked(prompt)).toBe(false)
    }
  })
})
