import { describe, it, expect } from "vitest"
import { textToSpeechBody } from "../text-to-speech.js"
import { TTS_VOICE_SETTING_RANGES } from "../../providers/elevenlabs/voice-settings.js"

/**
 * The REST route validates the four voice settings with the SAME ranges the provider funnel clamps into
 * (`TTS_VOICE_SETTING_RANGES`), so the two cannot disagree. The route still rejects what the funnel would clamp
 * or ignore: a REST caller gets a 400, not a silently changed request (unchanged behaviour).
 */
const accepts = (key: string, value: unknown) => textToSpeechBody.safeParse({ text: "hi", [key]: value }).success

describe("POST /v1/text-to-speech — the voice-setting ranges are the funnel's", () => {
  it("covers the four settings", () => {
    expect(Object.keys(TTS_VOICE_SETTING_RANGES).sort()).toEqual(["similarityBoost", "speed", "stability", "style"])
  })

  for (const [key, { min, max }] of Object.entries(TTS_VOICE_SETTING_RANGES)) {
    it(`${key}: accepts ${min} to ${max}, rejects just outside`, () => {
      expect(accepts(key, min)).toBe(true)
      expect(accepts(key, max)).toBe(true)
      expect(accepts(key, (min + max) / 2)).toBe(true)
      expect(accepts(key, min - 0.01)).toBe(false)
      expect(accepts(key, max + 0.01)).toBe(false)
    })

    it(`${key}: a numeric string is still rejected on REST`, () => {
      expect(accepts(key, String(max))).toBe(false)
    })
  }
})
