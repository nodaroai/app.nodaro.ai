/**
 * The workflow run's Audio Isolation stamp (`stampAudioIsolationInput`) prices
 * an audio exactly as the route's step does (`readAudioIsolationInput`, the
 * one rule both call), on the length the server reads — never a length or a
 * unit count the node carries (decided 2026-11-18). The probe and the price
 * row are stood in for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({ audio: 8 as number | "unreadable" }))

vi.mock("../video-utility-probe.js", () => ({
  probeSoundLengthSec: vi.fn(async () => {
    if (state.audio === "unreadable") throw new Error("ffprobe: Invalid data found when processing input")
    return state.audio
  }),
}))
vi.mock("../credit-base-cost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../credit-base-cost.js")>()),
  unitRateBaseCredits: async (rateId: string, units: number) => (rateId === "elevenlabs-isolation:per-10s" ? Math.ceil(10 * units) : 0),
}))
vi.mock("../url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import {
  audioIsolationReserveId,
  audioIsolationStampedBaseCredits,
  readAudioIsolationInput,
  stampAudioIsolationInput,
} from "../audio-isolation-input.js"

const AUDIO = "https://cdn.test/interview.mp3"

beforeEach(() => {
  state.audio = 8
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("stampAudioIsolationInput — the workflow run's twin of the route's step", () => {
  it("a node carrying a false length or unit count is priced on the length read", async () => {
    state.audio = 61
    const payload: Record<string, unknown> = { audioUrl: AUDIO, audioIsolationSec: 1, audioIsolationUnits: 1 }
    expect(await stampAudioIsolationInput("audio-isolation", payload)).toBeUndefined()
    expect(payload).toMatchObject({ audioIsolationSec: 61, audioIsolationUnits: 7 })
    expect(audioIsolationReserveId("audio-isolation", payload)).toBe("elevenlabs-isolation:per-10s")
    expect(await audioIsolationStampedBaseCredits("audio-isolation", payload)).toBe(70)
  })

  it("prices the same audio as the route does, at every length", async () => {
    for (const sec of [0.5, 8, 10.04, 10.06, 30, 59.99, 300, 1799.9, 1800.05]) {
      state.audio = sec
      const read = await readAudioIsolationInput(AUDIO)
      const payload: Record<string, unknown> = { audioUrl: AUDIO }
      expect(await stampAudioIsolationInput("audio-isolation", payload)).toBeUndefined()
      expect(read.ok && read.units).toBe(payload.audioIsolationUnits)
    }
  })

  it("refuses what the route refuses: past 30 minutes, unreadable, a link the route's schema refuses", async () => {
    state.audio = 31 * 60
    expect(await stampAudioIsolationInput("audio-isolation", { audioUrl: AUDIO })).toMatchObject({ code: "audio_too_long" })
    state.audio = "unreadable"
    expect(await stampAudioIsolationInput("audio-isolation", { audioUrl: AUDIO })).toMatchObject({ code: "audio_unreadable" })
    state.audio = 8
    expect(await stampAudioIsolationInput("audio-isolation", { audioUrl: "not a link" })).toMatchObject({ code: "audio_unreadable" })
  })

  it("leaves any other job untouched", async () => {
    const payload = { audioUrl: AUDIO }
    expect(await stampAudioIsolationInput("voice-changer", payload)).toBeUndefined()
    expect(payload).toEqual({ audioUrl: AUDIO })
    expect(audioIsolationReserveId("voice-changer", { audioIsolationUnits: 3 })).toBeUndefined()
    expect(await audioIsolationStampedBaseCredits("voice-changer", {})).toBeUndefined()
  })
})
