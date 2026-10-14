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
    expect(parseVoiceChangerProQuoteCreditId(id)).toEqual({
      stsSlotSeconds: [2 + 1 / 3, null],
      respeakChars: [87, null],
      respeakEngines: [null, null],
      respeakTranslated: [false, false],
    })
  })

  it("names a v4 slot's engine, and a translated v4 slot as such; v3 keeps the id it always had", () => {
    expect(
      voiceChangerProQuoteCreditId([
        { kind: "respeak", chars: 1200, engine: "v4" },
        { kind: "respeak", chars: 1200, engine: "v4", translated: true },
        { kind: "respeak", chars: 1200, engine: "v3" },
        { kind: "respeak", chars: null, engine: "v4", translated: true },
        { kind: "respeak", chars: null, engine: "v4" },
      ]),
    ).toBe("voice-changer-pro:respeak-v4-1200,respeak-v4t-1200,respeak-1200,respeak-v4t,respeak-v4")
  })

  it("never writes a translated v3 slot: only v4 speaks a translation, as the convert route reads it", () => {
    expect(voiceChangerProQuoteCreditId([{ kind: "respeak", chars: 500, engine: "v3", translated: true }])).toBe(
      "voice-changer-pro:respeak-500",
    )
    expect(voiceChangerProQuoteCreditId([{ kind: "respeak", chars: 500, translated: true }])).toBe("voice-changer-pro:respeak-500")
  })

  it("reads each Re-speak slot's engine and translation back, index-aligned with its characters", () => {
    expect(parseVoiceChangerProQuoteCreditId("voice-changer-pro:respeak-v4t-900,sts-12,respeak-v3-40,respeak,respeak-v4")).toEqual({
      stsSlotSeconds: [12],
      respeakChars: [900, 40, null, null],
      respeakEngines: ["v4", "v3", null, "v4"],
      respeakTranslated: [true, false, false, false],
    })
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
    "voice-changer-pro:respeak-v3t-100",
    "voice-changer-pro:respeak-v5-100",
    "voice-changer-pro:respeak-v4-",
    "voice-changer-pro:respeak-v4-0",
    "voice-changer-pro:respeak:v4-100",
    "voice-changer-pro:sts-v4-10",
    "voice-changer-pro:respeak-100-v4",
  ])("is not %s", (id) => {
    expect(parseVoiceChangerProQuoteCreditId(id)).toBeUndefined()
  })
})
