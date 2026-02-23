import { describe, it, expect } from "vitest"
import { TTS_VOICES, getVoiceName } from "../tts-voices"

describe("TTS_VOICES", () => {
  it("has at least 10 voices", () => {
    expect(TTS_VOICES.length).toBeGreaterThanOrEqual(10)
  })

  it("every voice has an id and name", () => {
    for (const voice of TTS_VOICES) {
      expect(voice.id).toBeTruthy()
      expect(voice.name).toBeTruthy()
    }
  })

  it("has no duplicate IDs", () => {
    const ids = TTS_VOICES.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("every name includes a gender indicator", () => {
    for (const voice of TTS_VOICES) {
      expect(voice.name).toMatch(/\(Female|Male|Non-binary/)
    }
  })

  it("includes Rachel", () => {
    expect(TTS_VOICES.some((v) => v.id === "Rachel")).toBe(true)
  })
})

describe("getVoiceName", () => {
  it("returns voice name for a known ID", () => {
    expect(getVoiceName("Rachel")).toBe("Rachel (Female, American)")
  })

  it("returns voice name for another known ID", () => {
    expect(getVoiceName("Roger")).toBe("Roger (Male)")
  })

  it("returns voice name for non-binary voice", () => {
    expect(getVoiceName("River")).toBe("River (Non-binary)")
  })

  it("returns the voiceId itself for unknown ID", () => {
    expect(getVoiceName("custom-voice-123")).toBe("custom-voice-123")
  })

  it("returns 'Rachel' for empty string", () => {
    expect(getVoiceName("")).toBe("Rachel")
  })
})
