import { describe, it, expect } from "vitest"
import { parseVoiceChangerProQuoteCreditId, voiceChangerProQuoteCreditId } from "../credit-estimators/voice-changer-pro-quote.js"

describe("the whole-convert quote id", () => {
  it("writes one slot per changed speaker, a missing measure as the bare kind", () => {
    expect(
      voiceChangerProQuoteCreditId([
        { kind: "sts", seconds: 26.76 },
        { kind: "respeak", chars: 1200 },
        { kind: "sts", seconds: null },
        { kind: "respeak", chars: 0 },
      ]),
    ).toBe("voice-changer-pro:sts-26.76,respeak-1200,sts,respeak")
  })

  it("reads back exactly what it wrote, per kind and in order", () => {
    const id = voiceChangerProQuoteCreditId([
      { kind: "respeak", chars: 87 },
      { kind: "sts", seconds: 2 + 1 / 3 },
      { kind: "sts", seconds: null },
      { kind: "respeak", chars: null },
    ])
    expect(parseVoiceChangerProQuoteCreditId(id)).toEqual({ stsSlotSeconds: [2 + 1 / 3, null], respeakChars: [87, null] })
  })

  it.each([
    "voice-changer-pro",
    "voice-changer-pro:",
    "voice-changer-pro-respeak:sts-10",
    "voice-changer-pro:sts-0",
    "voice-changer-pro:sts--3",
    "voice-changer-pro:sts-1e3",
    "voice-changer-pro:sts-10,",
    "voice-changer-pro:lipsync-3",
    "voice-changer-pro:3u",
  ])("is not %s", (id) => {
    expect(parseVoiceChangerProQuoteCreditId(id)).toBeUndefined()
  })
})
