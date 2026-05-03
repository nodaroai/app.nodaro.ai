import { describe, it, expect } from "vitest"
import { resolveDirectVoiceId, stripAudioTags } from "../direct-tts.js"

describe("resolveDirectVoiceId", () => {
  it("maps known premade voice names to ElevenLabs UUIDs", () => {
    expect(resolveDirectVoiceId("Rachel")).toBe("21m00Tcm4TlvDq8ikWAM")
    expect(resolveDirectVoiceId("George")).toBe("JBFqnCBsd6RMkjVDRZzb")
    expect(resolveDirectVoiceId("Bill")).toBe("pqHfZKP75CvOlQylNhV4")
  })

  it("passes through anything that isn't a known name (UUIDs, custom voices)", () => {
    expect(resolveDirectVoiceId("21m00Tcm4TlvDq8ikWAM")).toBe("21m00Tcm4TlvDq8ikWAM")
    expect(resolveDirectVoiceId("custom-uuid-here")).toBe("custom-uuid-here")
  })

  it("defaults to Rachel's UUID when voice is undefined", () => {
    expect(resolveDirectVoiceId(undefined)).toBe("21m00Tcm4TlvDq8ikWAM")
  })
})

describe("stripAudioTags", () => {
  it("removes bracketed audio tags and collapses whitespace", () => {
    expect(stripAudioTags("Hello [laughs] world")).toBe("Hello world")
    expect(stripAudioTags("[whispers] secret [pause] ok")).toBe("secret ok")
  })

  it("leaves text without tags unchanged", () => {
    expect(stripAudioTags("Plain sentence.")).toBe("Plain sentence.")
  })
})
