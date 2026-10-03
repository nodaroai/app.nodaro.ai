import { describe, it, expect } from "vitest"
import { TTS_VOICES, getVoiceName, ttsVoiceLabel } from "../tts-voices"
import { useLocaleStore } from "@/lib/locale-store"

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

  it("every label names the voice's gender and accent", () => {
    for (const voice of TTS_VOICES) {
      expect(ttsVoiceLabel(voice)).toMatch(/^[^(]+ \((Female|Male|Non-binary), [A-Z][A-Za-z-]+\)$/)
    }
  })

  it("labels the voice in the interface language, keeping its name", () => {
    const rachel = TTS_VOICES.find((v) => v.id === "Rachel")!
    useLocaleStore.setState({ locale: "he" })
    try {
      expect(ttsVoiceLabel(rachel)).toMatch(/^Rachel \([\u0590-\u05FF]/)
    } finally {
      useLocaleStore.setState({ locale: "en" })
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
    expect(getVoiceName("Roger")).toBe("Roger (Male, American)")
  })

  it("returns voice name for non-binary voice", () => {
    expect(getVoiceName("River")).toBe("River (Non-binary, American)")
  })

  it("returns the voiceId itself for unknown ID", () => {
    expect(getVoiceName("custom-voice-123")).toBe("custom-voice-123")
  })

  it("returns 'Rachel' for empty string", () => {
    expect(getVoiceName("")).toBe("Rachel")
  })

  it("finds voice from dynamic list by voice_id", () => {
    const dynamicVoices = [
      { voice_id: "abc-123", name: "CustomVoice" },
      { voice_id: "def-456", name: "Rachel" },
    ]
    expect(getVoiceName("abc-123", dynamicVoices)).toBe("CustomVoice")
  })

  it("finds voice from dynamic list by name (backward compat)", () => {
    const dynamicVoices = [
      { voice_id: "abc-123", name: "CustomVoice" },
      { voice_id: "def-456", name: "Rachel" },
    ]
    expect(getVoiceName("CustomVoice", dynamicVoices)).toBe("CustomVoice")
  })

  it("falls back to static list when dynamic list does not contain voice", () => {
    const dynamicVoices = [{ voice_id: "abc-123", name: "CustomVoice" }]
    expect(getVoiceName("Rachel", dynamicVoices)).toBe("Rachel (Female, American)")
  })
})
