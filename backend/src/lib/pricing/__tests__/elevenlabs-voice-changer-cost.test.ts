import { describe, expect, it } from "vitest"
import { ELEVENLABS_VOICE_CHANGER_USD_PER_MINUTE, elevenlabsVoiceChangerCostUsd } from "../elevenlabs-voice-changer-cost.js"

describe("what a Voice Changer run costs the platform", () => {
  it("the length sent at the per-minute rate", () => {
    expect(elevenlabsVoiceChangerCostUsd(60)).toBe(ELEVENLABS_VOICE_CHANGER_USD_PER_MINUTE)
    expect(elevenlabsVoiceChangerCostUsd(30)).toBeCloseTo(ELEVENLABS_VOICE_CHANGER_USD_PER_MINUTE / 2, 10)
    expect(elevenlabsVoiceChangerCostUsd(300)).toBeCloseTo(5 * ELEVENLABS_VOICE_CHANGER_USD_PER_MINUTE, 10)
  })

  it("no length, no cost", () => {
    expect(elevenlabsVoiceChangerCostUsd(0)).toBe(0)
    expect(elevenlabsVoiceChangerCostUsd(Number.NaN)).toBe(0)
  })
})
