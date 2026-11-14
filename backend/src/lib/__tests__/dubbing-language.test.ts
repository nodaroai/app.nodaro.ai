import { describe, expect, it } from "vitest"
import { asksForSource, canonicalLanguage, sameLanguage } from "../dubbing-language.js"

describe("sameLanguage", () => {
  it("reads a code whatever its case and the spaces around it", () => {
    expect(sameLanguage("pt-BR", " pt-br ")).toBe(true)
    expect(sameLanguage("en", "es")).toBe(false)
  })

  it("reads both codes of the project engine's language as one", () => {
    expect(sameLanguage("he", "heb")).toBe(true)
    expect(sameLanguage(" HEB ", "he")).toBe(true)
    expect(sameLanguage("he", "hi")).toBe(false)
  })
})

describe("canonicalLanguage", () => {
  it("gives a language one spelling", () => {
    expect(canonicalLanguage(" PT-br ")).toBe("pt-br")
    expect(canonicalLanguage("HEB")).toBe("he")
    expect(canonicalLanguage("he")).toBe("he")
  })
})

describe("asksForSource", () => {
  it("reads the original speech's name whatever its case and the spaces around it", () => {
    expect(asksForSource("source")).toBe(true)
    expect(asksForSource(" Source ")).toBe(true)
    expect(asksForSource("SOURCE")).toBe(true)
  })

  it("reads a language code as a language", () => {
    expect(asksForSource("en")).toBe(false)
    expect(asksForSource("sources")).toBe(false)
    expect(asksForSource("")).toBe(false)
  })
})
