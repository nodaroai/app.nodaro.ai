import { describe, expect, it } from "vitest"
import { VOICE_LIBRARY_DESCRIPTIVES, VOICE_LIBRARY_USE_CASES } from "../voices.js"

// The two value lists a picker builds its groups from. Both are documented
// as "the library's values when last read" — so they must at least be clean:
// the library's own spellings (lowercase tokens), unique, in a stable order.

describe("VOICE_LIBRARY_DESCRIPTIVES", () => {
  it("is the library's tone vocabulary: lowercase words, unique, alphabetical", () => {
    expect(VOICE_LIBRARY_DESCRIPTIVES.length).toBe(34)
    expect(new Set(VOICE_LIBRARY_DESCRIPTIVES).size).toBe(VOICE_LIBRARY_DESCRIPTIVES.length)
    expect([...VOICE_LIBRARY_DESCRIPTIVES].sort()).toEqual([...VOICE_LIBRARY_DESCRIPTIVES])
    for (const word of VOICE_LIBRARY_DESCRIPTIVES) expect(word).toMatch(/^[a-z]+$/)
  })
})

describe("VOICE_LIBRARY_USE_CASES", () => {
  it("is the library's category vocabulary: lowercase tokens, unique, alphabetical", () => {
    expect(VOICE_LIBRARY_USE_CASES.length).toBe(7)
    expect(new Set(VOICE_LIBRARY_USE_CASES).size).toBe(VOICE_LIBRARY_USE_CASES.length)
    expect([...VOICE_LIBRARY_USE_CASES].sort()).toEqual([...VOICE_LIBRARY_USE_CASES])
    for (const token of VOICE_LIBRARY_USE_CASES) expect(token).toMatch(/^[a-z_]+$/)
  })
})
