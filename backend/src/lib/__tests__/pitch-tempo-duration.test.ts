import { beforeEach, describe, expect, it, vi } from "vitest"

const probe = vi.hoisted(() => ({ fn: (async () => 61) as (url: string) => Promise<number>, urls: [] as string[] }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  probeMediaDuration: async (url: string) => {
    probe.urls.push(url)
    return probe.fn(url)
  },
}))

import { pitchTempoReserveId, stampPitchTempoDuration } from "../pitch-tempo-duration.js"

beforeEach(() => {
  probe.fn = async () => 61
  probe.urls = []
})

describe("stampPitchTempoDuration (the workflow run's twin of the route's preHandler)", () => {
  it("stamps the length and the per-minute id the run reserves", async () => {
    const payload: Record<string, unknown> = { audioUrl: "https://cdn.example.com/a.mp3" }
    expect(await stampPitchTempoDuration("pitch-tempo", payload)).toBeUndefined()
    expect(payload).toMatchObject({ duration_seconds: 61, bucketKey: "pitch-tempo:2m" })
    expect(pitchTempoReserveId("pitch-tempo", payload)).toBe("pitch-tempo:2m")
  })

  it("measures the video when both are present", async () => {
    await stampPitchTempoDuration("pitch-tempo", { audioUrl: "https://x/a.mp3", videoUrl: "https://x/v.mp4" })
    expect(probe.urls).toEqual(["https://x/v.mp4"])
  })

  it("returns the route's refusals instead of a fallback length", async () => {
    probe.fn = async () => {
      throw new Error("unreachable")
    }
    expect(await stampPitchTempoDuration("pitch-tempo", { audioUrl: "https://x/a.mp3" })).toMatchObject({ code: "invalid_media_duration" })
    probe.fn = async () => 1801
    expect(await stampPitchTempoDuration("pitch-tempo", { audioUrl: "https://x/a.mp3" })).toMatchObject({ code: "media_duration_exceeds_limit" })
    // More than the 0.05 s its charge forgives past the cap: refused.
    probe.fn = async () => 1800.06
    expect(await stampPitchTempoDuration("pitch-tempo", { audioUrl: "https://x/a.mp3" })).toMatchObject({ code: "media_duration_exceeds_limit" })
  })

  it("a file a hair past the 30-minute cap is accepted at 30 minutes, the top of its quote (the render cuts it to the cap)", async () => {
    probe.fn = async () => 1800.03
    const payload: Record<string, unknown> = { audioUrl: "https://x/a.mp3" }
    expect(await stampPitchTempoDuration("pitch-tempo", payload)).toBeUndefined()
    expect(payload).toMatchObject({ duration_seconds: 1800.03, bucketKey: "pitch-tempo:30m" })
  })

  it("leaves every other job alone", async () => {
    const payload: Record<string, unknown> = { audioUrl: "https://x/a.mp3" }
    expect(await stampPitchTempoDuration("audio-fx", payload)).toBeUndefined()
    expect(payload).toEqual({ audioUrl: "https://x/a.mp3" })
    expect(pitchTempoReserveId("audio-fx", { bucketKey: "pitch-tempo:2m" })).toBeUndefined()
  })
})
