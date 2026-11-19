import { describe, expect, it } from "vitest"
import {
  AUDIO_ISOLATION_MAX_SEC,
  AUDIO_ISOLATION_MAX_UNITS,
  AUDIO_ISOLATION_RATE_ID,
  audioIsolationEstimateUnits,
  audioIsolationUnits,
  checkAudioIsolationLength,
} from "../audio-isolation-pricing.js"

describe("Audio Isolation pricing", () => {
  it("one unit per started 10 seconds, at least one", () => {
    expect(AUDIO_ISOLATION_RATE_ID).toBe("elevenlabs-isolation:per-10s")
    expect(audioIsolationUnits(0.4)).toBe(1)
    expect(audioIsolationUnits(8)).toBe(1)
    expect(audioIsolationUnits(10)).toBe(1)
    expect(audioIsolationUnits(10.2)).toBe(2)
    expect(audioIsolationUnits(30)).toBe(3)
    expect(audioIsolationUnits(60)).toBe(6)
    expect(audioIsolationUnits(300)).toBe(30)
    expect(audioIsolationUnits(1800)).toBe(180)
  })

  it("forgives 0.05 s past a mark", () => {
    expect(audioIsolationUnits(30.05)).toBe(3)
    expect(audioIsolationUnits(30.06)).toBe(4)
  })

  it("refuses audio past 30 minutes (a hair past forgiven), naming the limit", () => {
    expect(checkAudioIsolationLength(AUDIO_ISOLATION_MAX_SEC)).toEqual({ ok: true, units: 180 })
    expect(checkAudioIsolationLength(AUDIO_ISOLATION_MAX_SEC + 0.05)).toEqual({ ok: true, units: 180 })
    const refused = checkAudioIsolationLength(31 * 60)
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.code).toBe("audio_too_long")
      expect(refused.message).toMatch(/31 min/)
      expect(refused.message).toMatch(/30 minutes/)
      expect(refused.message).toMatch(/split or trim/)
    }
  })

  it("an estimate quotes the known length, else the 30-minute cap", () => {
    expect(audioIsolationEstimateUnits(8)).toBe(1)
    expect(audioIsolationEstimateUnits(300)).toBe(30)
    expect(audioIsolationEstimateUnits(undefined)).toBe(AUDIO_ISOLATION_MAX_UNITS)
    expect(audioIsolationEstimateUnits(0)).toBe(AUDIO_ISOLATION_MAX_UNITS)
    expect(audioIsolationEstimateUnits(5000)).toBe(AUDIO_ISOLATION_MAX_UNITS)
  })
})
