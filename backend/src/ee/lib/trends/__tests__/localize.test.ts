import { describe, it, expect } from "vitest"
import { acceptedLocale, pickText } from "../localize.js"

describe("pickText", () => {
  const name = { en: "Dance off", he: "קרב ריקודים" }

  it("returns the asked locale when the text has it", () => {
    expect(pickText(name, "he")).toBe("קרב ריקודים")
  })

  it("falls back to en when the locale is missing", () => {
    expect(pickText(name, "fr")).toBe("Dance off")
  })

  it("falls back to en for an unknown or empty locale", () => {
    expect(pickText(name, "xx-XX")).toBe("Dance off")
    expect(pickText(name, "")).toBe("Dance off")
  })

  it("falls back to en when the locale's text is empty", () => {
    expect(pickText({ en: "Dance off", he: "" }, "he")).toBe("Dance off")
  })

  it("is undefined for no text", () => {
    expect(pickText(undefined, "he")).toBeUndefined()
  })
})

describe("acceptedLocale", () => {
  const LOCALES = ["en", "es", "pt-BR", "zh-CN", "he"]

  it("takes the exact tag, in any case", () => {
    expect(acceptedLocale("pt-br", LOCALES)).toBe("pt-BR")
    expect(acceptedLocale("ZH-cn", LOCALES)).toBe("zh-CN")
    expect(acceptedLocale("he", LOCALES)).toBe("he")
  })

  it("else the tag's primary language", () => {
    expect(acceptedLocale("he-IL", LOCALES)).toBe("he")
    expect(acceptedLocale("pt", LOCALES)).toBe("pt-BR")
    expect(acceptedLocale("pt-PT", LOCALES)).toBe("pt-BR")
    expect(acceptedLocale("en-US,en;q=0.9", LOCALES)).toBe("en")
  })

  it("by weight, highest first, ties in the order sent", () => {
    expect(acceptedLocale("en;q=0.5, he;q=0.9", LOCALES)).toBe("he")
    expect(acceptedLocale("fr-CA, fr;q=0.9, es;q=0.8, en;q=0.8", LOCALES)).toBe("es")
    expect(acceptedLocale("he;q=0.8, es;q=0.8", LOCALES)).toBe("he")
  })

  it("skips a refused language (q=0), the wildcard and a malformed weight", () => {
    expect(acceptedLocale("he;q=0, en", LOCALES)).toBe("en")
    expect(acceptedLocale("*, he;q=0.1", LOCALES)).toBe("he")
    expect(acceptedLocale("he;q=abc, es;q=0.2", LOCALES)).toBe("es")
    // The parameter's name is case-insensitive.
    expect(acceptedLocale("en;Q=0, he", LOCALES)).toBe("he")
  })

  it("is undefined when it asks for none of them, or is absent", () => {
    expect(acceptedLocale("fr-FR, de;q=0.9", LOCALES)).toBeUndefined()
    expect(acceptedLocale("", LOCALES)).toBeUndefined()
    expect(acceptedLocale(undefined, LOCALES)).toBeUndefined()
    expect(acceptedLocale("*", LOCALES)).toBeUndefined()
  })

  it("reads a header sent twice as one list", () => {
    expect(acceptedLocale(["fr", "he;q=0.5"], LOCALES)).toBe("he")
  })

  it("reads no further than its first 32 languages", () => {
    const many = Array.from({ length: 32 }, (_, i) => `x${i}`).join(", ")
    expect(acceptedLocale(`${many}, he`, LOCALES)).toBeUndefined()
    expect(acceptedLocale(`he, ${many}`, LOCALES)).toBe("he")
  })
})
