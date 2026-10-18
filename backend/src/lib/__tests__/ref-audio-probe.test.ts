import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({ probe: vi.fn() }))

vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  probeMediaFormatAndDuration: mocks.probe,
}))

import { probeAndCheckRefAudio } from "../ref-audio-probe.js"

beforeEach(() => {
  mocks.probe.mockReset()
})

describe("probeAndCheckRefAudio", () => {
  it("never probes a provider without a declared rule", async () => {
    const r = await probeAndCheckRefAudio({ provider: "wan-3", referenceAudioUrls: ["https://x/a.wav"] })
    expect(r).toEqual({ ok: true })
    expect(mocks.probe).not.toHaveBeenCalled()
  })

  it("is a no-op without reference audio", async () => {
    expect(await probeAndCheckRefAudio({ provider: "vidu-q4", referenceAudioUrls: undefined })).toEqual({ ok: true })
    expect(await probeAndCheckRefAudio({ provider: "vidu-q4", referenceAudioUrls: [] })).toEqual({ ok: true })
    expect(mocks.probe).not.toHaveBeenCalled()
  })

  it("accepts MP3 clips of 3-12 seconds on vidu-q4", async () => {
    mocks.probe.mockResolvedValue({ formatNames: ["mp3"], durationSec: 6 })
    const r = await probeAndCheckRefAudio({ provider: "vidu-q4", referenceAudioUrls: ["https://x/a.mp3", "https://x/b.mp3"] })
    expect(r).toEqual({ ok: true })
    expect(mocks.probe).toHaveBeenCalledTimes(2)
  })

  it("refuses a WAV clip (MP3 only) with the format code", async () => {
    mocks.probe
      .mockResolvedValueOnce({ formatNames: ["mp3"], durationSec: 6 })
      .mockResolvedValueOnce({ formatNames: ["wav"], durationSec: 6 })
    const r = await probeAndCheckRefAudio({ provider: "vidu-q4", referenceAudioUrls: ["https://x/a.mp3", "https://x/b.wav"] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe("audio_format_unsupported")
      expect(r.message).toContain("Reference audio 2")
    }
  })

  it("refuses a clip outside the 3-12s window", async () => {
    mocks.probe.mockResolvedValue({ formatNames: ["mp3"], durationSec: 14 })
    const long = await probeAndCheckRefAudio({ provider: "vidu-q4", referenceAudioUrls: ["https://x/a.mp3"] })
    expect(long.ok === false && long.code).toBe("audio_too_long")
    mocks.probe.mockResolvedValue({ formatNames: ["mp3"], durationSec: 1.5 })
    const short = await probeAndCheckRefAudio({ provider: "vidu-q4", referenceAudioUrls: ["https://x/a.mp3"] })
    expect(short.ok === false && short.code).toBe("audio_too_short")
  })

  it("falls back to the URL extension for the format when the probe fails, and never rejects on length", async () => {
    mocks.probe.mockRejectedValue(new Error("ffprobe failed"))
    const wav = await probeAndCheckRefAudio({ provider: "vidu-q4", referenceAudioUrls: ["https://x/a.wav?sig=1"] })
    expect(wav.ok === false && wav.code).toBe("audio_format_unsupported")
    const mp3 = await probeAndCheckRefAudio({ provider: "vidu-q4", referenceAudioUrls: ["https://x/a.mp3"] })
    expect(mp3).toEqual({ ok: true })
    const unknown = await probeAndCheckRefAudio({ provider: "vidu-q4", referenceAudioUrls: ["https://x/blob"] })
    expect(unknown).toEqual({ ok: true })
  })

  it("probes at most the provider's audio cap (3 on vidu-q4)", async () => {
    mocks.probe.mockResolvedValue({ formatNames: ["mp3"], durationSec: 5 })
    await probeAndCheckRefAudio({ provider: "vidu-q4", referenceAudioUrls: ["a", "b", "c", "d", "e"].map((x) => `https://x/${x}.mp3`) })
    expect(mocks.probe).toHaveBeenCalledTimes(3)
  })
})
