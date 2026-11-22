/**
 * The workflow run's Voice Changer stamp (`stampVoiceChangerInput`) prices an
 * audio exactly as the route's step does (`readVoiceChangerInput`, the one rule
 * both call), on the length the server reads — never a length or a unit count
 * the node carries (decided 2026-11-22). The video is read when the run is
 * given one (a video wins, as the worker does), else the audio. The probe and
 * the price row are stood in for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  audio: 8 as number | "unreadable" | "no-audio-stream",
  read: [] as string[],
}))

vi.mock("../video-utility-probe.js", () => ({
  probeSoundLengthSec: vi.fn(async (src: string) => {
    state.read.push(src)
    if (state.audio === "unreadable") throw new Error("ffprobe: Invalid data found when processing input")
    if (state.audio === "no-audio-stream") throw Object.assign(new Error("clip unreadable: no audio stream"), { name: "ClipUnreadableError" })
    return state.audio
  }),
}))
vi.mock("../credit-base-cost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../credit-base-cost.js")>()),
  unitRateBaseCredits: async (rateId: string, units: number) => (rateId === "elevenlabs-voice-changer:per-10s" ? Math.ceil(10 * units) : 0),
}))
vi.mock("../url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import {
  readVoiceChangerInput,
  stampVoiceChangerInput,
  voiceChangerReserveId,
  voiceChangerSourceUrl,
  voiceChangerStampedBaseCredits,
} from "../voice-changer-input.js"

const AUDIO = "https://cdn.test/interview.mp3"
const VIDEO = "https://cdn.test/talking.mp4"

beforeEach(() => {
  state.audio = 8
  state.read = []
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("the source a Voice Changer is priced on", () => {
  it("the video when one is given (it wins), else the audio", () => {
    expect(voiceChangerSourceUrl({ audioUrl: AUDIO, videoUrl: VIDEO })).toBe(VIDEO)
    expect(voiceChangerSourceUrl({ videoUrl: VIDEO })).toBe(VIDEO)
    expect(voiceChangerSourceUrl({ audioUrl: AUDIO })).toBe(AUDIO)
    expect(voiceChangerSourceUrl({ audioUrl: AUDIO, videoUrl: "" })).toBe(AUDIO)
    expect(voiceChangerSourceUrl({})).toBeUndefined()
  })
})

describe("readVoiceChangerInput — the route's and the workflow run's one rule", () => {
  it("prices the length read: one unit per started 10 seconds", async () => {
    for (const [sec, units] of [[0.5, 1], [8, 1], [10.04, 1], [10.06, 2], [30, 3], [59.99, 6], [300, 30], [300.05, 30]] as const) {
      state.audio = sec
      expect(await readVoiceChangerInput(AUDIO)).toEqual({ ok: true, audioSec: sec, units })
    }
  })

  it("refuses audio past 5 minutes, naming the limit", async () => {
    state.audio = 6 * 60
    const read = await readVoiceChangerInput(AUDIO)
    expect(read).toMatchObject({ ok: false, code: "audio_too_long" })
    expect(read.ok === false && read.message).toMatch(/5 minutes/)
  })

  it("refuses audio that cannot be read, never priced on a guess", async () => {
    state.audio = "unreadable"
    const failures: unknown[] = []
    expect(await readVoiceChangerInput(AUDIO, (err) => failures.push(err))).toMatchObject({ ok: false, code: "audio_unreadable" })
    expect(failures).toHaveLength(1)
    state.audio = 0
    expect(await readVoiceChangerInput(AUDIO)).toMatchObject({ ok: false, code: "audio_unreadable" })
  })

  it("a file with no sound track is refused with the no-audio message", async () => {
    state.audio = "no-audio-stream"
    const read = await readVoiceChangerInput(VIDEO)
    expect(read).toMatchObject({ ok: false, code: "audio_unreadable" })
    expect(read.ok === false && read.message).toMatch(/no audio track to revoice/)
  })
})

describe("stampVoiceChangerInput — the workflow run's twin of the route's step", () => {
  it("a node carrying a false length or unit count is priced on the length read", async () => {
    state.audio = 61
    const payload: Record<string, unknown> = { audioUrl: AUDIO, voiceChangerSec: 1, voiceChangerUnits: 1 }
    expect(await stampVoiceChangerInput("voice-changer", payload)).toBeUndefined()
    expect(payload).toMatchObject({ voiceChangerSec: 61, voiceChangerUnits: 7 })
    expect(voiceChangerReserveId("voice-changer", payload)).toBe("elevenlabs-voice-changer:per-10s")
    expect(await voiceChangerStampedBaseCredits("voice-changer", payload)).toBe(70)
  })

  it("reads the video when the payload carries one", async () => {
    state.audio = 25
    const payload: Record<string, unknown> = { audioUrl: AUDIO, videoUrl: VIDEO }
    expect(await stampVoiceChangerInput("voice-changer", payload)).toBeUndefined()
    expect(state.read).toEqual([VIDEO])
    expect(payload.voiceChangerUnits).toBe(3)
  })

  it("prices the same audio as the route does, at every length", async () => {
    for (const sec of [0.5, 8, 10.04, 10.06, 30, 59.99, 299.9, 300.05]) {
      state.audio = sec
      const read = await readVoiceChangerInput(AUDIO)
      const payload: Record<string, unknown> = { audioUrl: AUDIO }
      expect(await stampVoiceChangerInput("voice-changer", payload)).toBeUndefined()
      expect(read.ok && read.units).toBe(payload.voiceChangerUnits)
    }
  })

  it("refuses what the route refuses: past 5 minutes, unreadable, a link the route's schema refuses, no link", async () => {
    state.audio = 6 * 60
    expect(await stampVoiceChangerInput("voice-changer", { audioUrl: AUDIO })).toMatchObject({ code: "audio_too_long" })
    state.audio = "unreadable"
    expect(await stampVoiceChangerInput("voice-changer", { audioUrl: AUDIO })).toMatchObject({ code: "audio_unreadable" })
    state.audio = 8
    expect(await stampVoiceChangerInput("voice-changer", { audioUrl: "not a link" })).toMatchObject({ code: "audio_unreadable" })
    expect(await stampVoiceChangerInput("voice-changer", {})).toMatchObject({ code: "audio_unreadable" })
  })

  it("a run that reached its reservation without the audio's length is refused, never priced at a guess", async () => {
    await expect(voiceChangerStampedBaseCredits("voice-changer", {})).rejects.toThrow(/without the length/)
  })

  it("leaves any other job untouched", async () => {
    const payload = { audioUrl: AUDIO }
    expect(await stampVoiceChangerInput("audio-isolation", payload)).toBeUndefined()
    expect(payload).toEqual({ audioUrl: AUDIO })
    expect(voiceChangerReserveId("audio-isolation", { voiceChangerUnits: 3 })).toBeUndefined()
    expect(await voiceChangerStampedBaseCredits("audio-isolation", {})).toBeUndefined()
    expect(state.read).toEqual([])
  })
})
