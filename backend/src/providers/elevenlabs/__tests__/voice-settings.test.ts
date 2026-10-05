import { describe, it, expect } from "vitest"
import { TTS_VOICE_SETTING_RANGES, normalizeTtsVoiceSetting, normalizeTtsVoiceSettings } from "../voice-settings.js"

describe("TTS_VOICE_SETTING_RANGES", () => {
  it("are the documented ranges of ElevenLabs' four voice settings", () => {
    expect(TTS_VOICE_SETTING_RANGES).toEqual({
      stability: { min: 0, max: 1 },
      similarityBoost: { min: 0, max: 1 },
      style: { min: 0, max: 1 },
      speed: { min: 0.7, max: 1.2 },
    })
  })
})

describe("normalizeTtsVoiceSetting", () => {
  it.each([0, 0.4, 0.75, 1])("a finite number in range stays as it is: %s", (value) => {
    expect(normalizeTtsVoiceSetting("stability", value)).toBe(value)
  })

  it.each([
    ["0.4", 0.4],
    [" 0.4 ", 0.4],
    ["\t1\n", 1],
    ["0", 0],
    [".5", 0.5],
    ["5e-1", 0.5],
    ["+0.3", 0.3],
  ])("a numeric string becomes that number: %j", (value, expected) => {
    expect(normalizeTtsVoiceSetting("similarityBoost", value)).toBe(expected)
  })

  it.each(["", "   ", "abc", "0.4abc", "0,4", "0.4 0.5", "0x1", "1_000", "Infinity", "-Infinity", "NaN"])(
    "a string that is not a decimal number is absent: %j",
    (value) => {
      expect(normalizeTtsVoiceSetting("style", value)).toBeUndefined()
    },
  )

  it.each([NaN, Infinity, -Infinity, null, undefined, true, false, {}, [], [0.4], { value: 0.4 }])(
    "anything else is absent: %j",
    (value) => {
      expect(normalizeTtsVoiceSetting("stability", value)).toBeUndefined()
    },
  )

  it("clamps a number outside the lever's range into it", () => {
    expect(normalizeTtsVoiceSetting("stability", 7)).toBe(1)
    expect(normalizeTtsVoiceSetting("similarityBoost", -0.2)).toBe(0)
    expect(normalizeTtsVoiceSetting("style", "1.5")).toBe(1)
    expect(normalizeTtsVoiceSetting("speed", 2)).toBe(1.2)
    expect(normalizeTtsVoiceSetting("speed", "0.5")).toBe(0.7)
    expect(normalizeTtsVoiceSetting("speed", 0)).toBe(0.7)
    expect(normalizeTtsVoiceSetting("speed", 1.05)).toBe(1.05)
  })
})

describe("normalizeTtsVoiceSettings", () => {
  it("normalises the four settings and leaves an unusable one out", () => {
    expect(normalizeTtsVoiceSettings({ stability: " 0.4 ", similarityBoost: 7, style: "", speed: "fast" })).toEqual({
      stability: 0.4,
      similarityBoost: 1,
    })
  })

  it("a valid request comes out exactly as it went in", () => {
    const valid = { stability: 0.4, similarityBoost: 0.8, style: 0.5, speed: 1.1 }
    expect(normalizeTtsVoiceSettings(valid)).toEqual(valid)
  })

  it("nothing usable gives an empty object: the voice's own stored settings apply", () => {
    expect(normalizeTtsVoiceSettings({ stability: "", similarityBoost: null, style: {}, speed: NaN })).toEqual({})
    expect(normalizeTtsVoiceSettings(undefined)).toEqual({})
  })

  it("an absent setting is not a key on the result (never `key: undefined`)", () => {
    expect(Object.keys(normalizeTtsVoiceSettings({ speed: 1.1, style: "loud" }))).toEqual(["speed"])
  })

  it("carries only the four settings and never mutates its input", () => {
    const input = { stability: "0.4", languageCode: "en", allowDefaultVoiceFallback: true }
    expect(normalizeTtsVoiceSettings(input)).toEqual({ stability: 0.4 })
    expect(input).toEqual({ stability: "0.4", languageCode: "en", allowDefaultVoiceFallback: true })
  })
})
