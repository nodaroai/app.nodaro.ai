/**
 * Plain text as the content rights records keep it (lib/plain-text.ts): a
 * line break only where a field allows one, as a line feed; no control
 * character and no invisible mark; a field trimmed and bounded.
 */
import { describe, it, expect } from "vitest"
import { hasRefusedCharacters, normalizeLineBreaks, plainText } from "../plain-text.js"

const ch = (code: number) => String.fromCodePoint(code)

describe("hasRefusedCharacters", () => {
  it("lets ordinary text in any script through", () => {
    expect(hasRefusedCharacters("שלום, Ünïcödé — 日本語 ✓", { lineBreaks: false })).toBe(false)
  })

  it("refuses a line break where none is allowed, and lets a line feed through where one is", () => {
    expect(hasRefusedCharacters("a\nb", { lineBreaks: false })).toBe(true)
    expect(hasRefusedCharacters("a\nb", { lineBreaks: true })).toBe(false)
    expect(hasRefusedCharacters("a\rb", { lineBreaks: true })).toBe(true)
  })

  it("refuses control characters and the invisible marks", () => {
    for (const code of [0x00, 0x07, 0x1b, 0x7f, 0x061c, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202e, 0x2066, 0x2069]) {
      expect(hasRefusedCharacters(`a${ch(code)}b`, { lineBreaks: true }), code.toString(16)).toBe(true)
    }
  })

  it("refuses the C1 controls, every invisible format character, and a lone surrogate", () => {
    for (const code of [0x80, 0x85, 0x9f, 0x00ad, 0x200b, 0x2060, 0xfeff, 0xe0001, 0xe0041, 0xe007f]) {
      expect(hasRefusedCharacters(`a${ch(code)}b`, { lineBreaks: true }), code.toString(16)).toBe(true)
    }
    expect(hasRefusedCharacters(`a${String.fromCharCode(0xd800)}b`, { lineBreaks: true })).toBe(true)
    expect(hasRefusedCharacters(`a${String.fromCharCode(0xdc00)}b`, { lineBreaks: true })).toBe(true)
  })

  it("keeps the joiners some scripts and emoji need, and a whole astral character", () => {
    expect(hasRefusedCharacters(`می${ch(0x200c)}خواهم`, { lineBreaks: false })).toBe(false)
    expect(hasRefusedCharacters(String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467), { lineBreaks: false })).toBe(false)
    expect(hasRefusedCharacters(String.fromCodePoint(0x1f600, 0x20000), { lineBreaks: false })).toBe(false)
  })
})

describe("normalizeLineBreaks", () => {
  it("makes every line break a line feed", () => {
    expect(normalizeLineBreaks("a\r\nb\rc\nd")).toBe("a\nb\nc\nd")
  })
})

describe("plainText", () => {
  it("trims, keeps line breaks as line feeds, and bounds the length", () => {
    expect(plainText(20).parse("  one\r\ntwo  ")).toBe("one\ntwo")
    expect(plainText(20).parse("")).toBe("")
    expect(plainText(3).safeParse("four").success).toBe(false)
    expect(plainText(3).safeParse("   abc   ").success).toBe(true)
  })

  it("refuses what plain text may not hold, and anything that is not text", () => {
    expect(plainText(20).safeParse(`a${ch(0x202e)}b`).success).toBe(false)
    expect(plainText(20).safeParse(`a${ch(0x00)}b`).success).toBe(false)
    expect(plainText(20).safeParse(3).success).toBe(false)
  })
})
