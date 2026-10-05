import { describe, it, expect } from "vitest"
import {
  TEXT_TO_AUDIO_PRICING,
  TEXT_TO_AUDIO_SFX_CREDIT_IDS,
  textToAudioBilledSeconds,
  textToAudioCreditId,
} from "../credit-estimators/index.js"

describe("textToAudioBilledSeconds — whole seconds, rounded up", () => {
  it.each([
    [0.5, 1],
    [1, 1],
    [1.2, 2],
    [10, 10],
    [22, 22],
    [22.3, 23],
    [30, 30],
  ])("%s s bills %i s", (duration, billed) => {
    expect(textToAudioBilledSeconds(duration)).toBe(billed)
  })

  it.each([[undefined], [null], [0], [-3], [Number.NaN], [Number.POSITIVE_INFINITY], ["abc"], [""]])(
    "no usable duration (%s) bills the default %i s",
    (duration) => {
      expect(textToAudioBilledSeconds(duration)).toBe(TEXT_TO_AUDIO_PRICING.DEFAULT_BILLED_SEC)
      expect(TEXT_TO_AUDIO_PRICING.DEFAULT_BILLED_SEC).toBe(5)
    },
  )

  it("reads a numeric string (a field mapping can deliver one)", () => {
    expect(textToAudioBilledSeconds("7.5")).toBe(8)
  })

  it("never bills past the longest clip the model makes", () => {
    expect(textToAudioBilledSeconds(45)).toBe(30)
  })
})

describe("textToAudioCreditId — the price row a Text to Audio run is charged from", () => {
  it.each([
    [0.5, "elevenlabs-sfx:1s"],
    [6, "elevenlabs-sfx:6s"],
    [10, "elevenlabs-sfx:10s"],
    [22, "elevenlabs-sfx:22s"],
    [30, "elevenlabs-sfx:30s"],
  ])("%s s → %s", (duration, id) => {
    expect(textToAudioCreditId("elevenlabs-sfx", duration)).toBe(id)
  })

  it("no duration → the 5 s row", () => {
    expect(textToAudioCreditId("elevenlabs-sfx", undefined)).toBe("elevenlabs-sfx:5s")
  })

  it("no provider → the default engine's row", () => {
    expect(textToAudioCreditId(undefined, 8)).toBe("elevenlabs-sfx:8s")
    expect(textToAudioCreditId("", undefined)).toBe("elevenlabs-sfx:5s")
  })

  it("an engine not priced per second keeps its own row", () => {
    expect(textToAudioCreditId("tangoflux", 8)).toBe("tangoflux")
  })

  it("every id it can return is in the published per-second id list (1 s … 30 s)", () => {
    expect(TEXT_TO_AUDIO_SFX_CREDIT_IDS).toHaveLength(30)
    expect(TEXT_TO_AUDIO_SFX_CREDIT_IDS[0]).toBe("elevenlabs-sfx:1s")
    expect(TEXT_TO_AUDIO_SFX_CREDIT_IDS[29]).toBe("elevenlabs-sfx:30s")
    for (const d of [undefined, 0.5, 1, 4.2, 22, 30, 99]) {
      expect(TEXT_TO_AUDIO_SFX_CREDIT_IDS).toContain(textToAudioCreditId("elevenlabs-sfx", d))
    }
  })
})
