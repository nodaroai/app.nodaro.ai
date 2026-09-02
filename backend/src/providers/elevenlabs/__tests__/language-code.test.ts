import { describe, it, expect } from "vitest"
import { languageCodeForModel, ISO_639_3_TO_1 } from "../language-code.js"

describe("languageCodeForModel", () => {
  it("normalizes ISO 639-3 to ISO 639-1 (the 2026-08-31 incident: 'heb')", () => {
    expect(languageCodeForModel("elevenlabs-v3", "heb")).toBe("he")
    expect(languageCodeForModel("elevenlabs-v3", "eng")).toBe("en")
    expect(languageCodeForModel("elevenlabs-turbo", "spa")).toBe("es")
  })

  it("accepts a bibliographic 639-2/B alias", () => {
    expect(languageCodeForModel("elevenlabs-v3", "ger")).toBe("de")
    expect(languageCodeForModel("elevenlabs-v3", "fre")).toBe("fr")
  })

  it("passes a valid ISO 639-1 code through unchanged", () => {
    expect(languageCodeForModel("elevenlabs-v3", "he")).toBe("he")
    expect(languageCodeForModel("elevenlabs-turbo", "en")).toBe("en")
  })

  it("lowercases and strips a region/script subtag", () => {
    expect(languageCodeForModel("elevenlabs-v3", "HE")).toBe("he")
    expect(languageCodeForModel("elevenlabs-v3", "he-IL")).toBe("he")
    expect(languageCodeForModel("elevenlabs-v3", "pt_BR")).toBe("pt")
    expect(languageCodeForModel("elevenlabs-v3", "  en  ")).toBe("en")
  })

  it("leaves 'fil' alone — it is ElevenLabs' own code, not a 639-3 to map", () => {
    expect(languageCodeForModel("elevenlabs-v3", "fil")).toBe("fil")
  })

  it("omits the field entirely for empty / auto values", () => {
    expect(languageCodeForModel("elevenlabs-v3", undefined)).toBeUndefined()
    expect(languageCodeForModel("elevenlabs-v3", "")).toBeUndefined()
    expect(languageCodeForModel("elevenlabs-v3", "   ")).toBeUndefined()
    expect(languageCodeForModel("elevenlabs-v3", "auto")).toBeUndefined()
  })

  it("omits the field on elevenlabs-multilingual (eleven_multilingual_v2 rejects it)", () => {
    expect(languageCodeForModel("elevenlabs-multilingual", "he")).toBeUndefined()
    expect(languageCodeForModel("elevenlabs-multilingual", "heb")).toBeUndefined()
  })

  it("passes an unrecognized code through unchanged rather than guessing", () => {
    // Not our call to make: a code we have no mapping for is forwarded as-is,
    // preserving today's behaviour for anything outside the map.
    expect(languageCodeForModel("elevenlabs-v3", "xyz")).toBe("xyz")
  })

  it("maps every 639-3 alias to a 2-letter code", () => {
    for (const [three, two] of Object.entries(ISO_639_3_TO_1)) {
      expect(three.length, `${three} should be a 3-letter code`).toBe(3)
      expect(two.length, `${three} -> ${two} should be a 2-letter code`).toBe(2)
    }
  })
})
