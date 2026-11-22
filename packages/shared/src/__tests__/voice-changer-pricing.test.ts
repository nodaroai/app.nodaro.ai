import { describe, expect, it } from "vitest"
import {
  VOICE_CHANGER_MAX_SEC,
  VOICE_CHANGER_MAX_UNITS,
  VOICE_CHANGER_RATE_ID,
  VOICE_CHANGER_RATE_SECONDS,
  checkVoiceChangerLength,
  voiceChangerEstimateUnits,
  voiceChangerTooLongMessage,
  voiceChangerUnits,
} from "../voice-changer-pricing.js"

describe("Voice Changer pricing", () => {
  it("one unit per started 10 seconds, at least one, at most the 5-minute cap's 30", () => {
    expect(VOICE_CHANGER_RATE_ID).toBe("elevenlabs-voice-changer:per-10s")
    expect(VOICE_CHANGER_RATE_SECONDS).toBe(10)
    expect(VOICE_CHANGER_MAX_SEC).toBe(300)
    expect(VOICE_CHANGER_MAX_UNITS).toBe(30)
    expect(voiceChangerUnits(0.4)).toBe(1)
    expect(voiceChangerUnits(8)).toBe(1)
    expect(voiceChangerUnits(10)).toBe(1)
    expect(voiceChangerUnits(10.2)).toBe(2)
    expect(voiceChangerUnits(30)).toBe(3)
    expect(voiceChangerUnits(60)).toBe(6)
    expect(voiceChangerUnits(299)).toBe(30)
    expect(voiceChangerUnits(300)).toBe(30)
    expect(voiceChangerUnits(900)).toBe(30)
  })

  it("a length that is not a real length is one unit", () => {
    expect(voiceChangerUnits(0)).toBe(1)
    expect(voiceChangerUnits(-3)).toBe(1)
    expect(voiceChangerUnits(Number.NaN)).toBe(1)
  })

  it("forgives 0.05 s past a mark", () => {
    expect(voiceChangerUnits(30.05)).toBe(3)
    expect(voiceChangerUnits(30.06)).toBe(4)
  })

  it("refuses audio past 5 minutes (a hair past forgiven), naming the limit", () => {
    expect(checkVoiceChangerLength(VOICE_CHANGER_MAX_SEC)).toEqual({ ok: true, units: 30 })
    expect(checkVoiceChangerLength(VOICE_CHANGER_MAX_SEC + 0.05)).toEqual({ ok: true, units: 30 })
    const refused = checkVoiceChangerLength(6 * 60)
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.code).toBe("audio_too_long")
      expect(refused.message).toMatch(/6 min/)
      expect(refused.message).toMatch(/5 minutes/)
      expect(refused.message).toMatch(/split or trim/)
    }
  })

  it("a refused length never reads as the limit itself", () => {
    const hair = checkVoiceChangerLength(VOICE_CHANGER_MAX_SEC + 0.06)
    expect(hair.ok).toBe(false)
    expect(voiceChangerTooLongMessage(300.06)).toMatch(/^The audio is 5 min 1 s long\./)
    expect(voiceChangerTooLongMessage(359.6)).toMatch(/^The audio is 6 min long\./)
    expect(voiceChangerTooLongMessage(431)).toMatch(/^The audio is 7 min 11 s long\./)
  })

  it("an estimate quotes the known length, else the 5-minute cap", () => {
    expect(voiceChangerEstimateUnits(8)).toBe(1)
    expect(voiceChangerEstimateUnits(25)).toBe(3)
    expect(voiceChangerEstimateUnits(300)).toBe(30)
    expect(voiceChangerEstimateUnits(undefined)).toBe(VOICE_CHANGER_MAX_UNITS)
    expect(voiceChangerEstimateUnits(null)).toBe(VOICE_CHANGER_MAX_UNITS)
    expect(voiceChangerEstimateUnits(0)).toBe(VOICE_CHANGER_MAX_UNITS)
    expect(voiceChangerEstimateUnits(5000)).toBe(VOICE_CHANGER_MAX_UNITS)
  })
})
