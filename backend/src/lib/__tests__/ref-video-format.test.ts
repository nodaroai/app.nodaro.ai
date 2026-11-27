import { describe, it, expect, vi, beforeEach } from "vitest"

// Decided 2026-11-26: MAGI-2 takes reference videos as MP4 or MOV only, each
// 2-30 s and 30 s together. The one gate every lane runs before a hold
// (`probeAndCheckRefVideoDurations`: the video routes' pre-check and the
// workflow run) refuses another container and an out-of-bounds length.

const probe = vi.hoisted(() => ({
  durations: new Map<string, number>(),
  formats: new Map<string, string[]>(),
}))

vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  probeMediaDuration: vi.fn(async (url: string) => probe.durations.get(url) ?? 8),
  probeVideoSource: vi.fn(async () => ({ width: 1920, height: 1080, durationSeconds: 8 })),
  probeMediaFormatAndDuration: vi.fn(async (url: string) => {
    const formatNames = probe.formats.get(url)
    if (!formatNames) throw new Error("unreadable")
    return { formatNames, durationSec: probe.durations.get(url) ?? 8 }
  }),
}))

import { probeAndCheckRefVideoDurations, refVideoContainerProblem } from "../ref-video-probe.js"
import { probeMediaFormatAndDuration } from "../../providers/video/ffmpeg-utils.js"

const MP4 = "https://cdn.example.com/a.mp4"
const MOV = "https://cdn.example.com/b.mov"
const WEBM = "https://cdn.example.com/c.webm"
const UNREADABLE = "https://cdn.example.com/d.mp4"

beforeEach(() => {
  vi.mocked(probeMediaFormatAndDuration).mockClear()
  probe.durations.clear()
  probe.formats.clear()
  probe.formats.set(MP4, ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"])
  probe.formats.set(MOV, ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"])
  probe.formats.set(WEBM, ["matroska", "webm"])
})

describe("the reference-video container gate", () => {
  it("passes MP4 and MOV on MAGI-2, and a clip whose format cannot be read", async () => {
    expect(await probeAndCheckRefVideoDurations({ provider: "magi-2", referenceVideoUrls: [MP4, MOV, UNREADABLE] })).toMatchObject({ ok: true })
  })

  it("refuses a WebM on MAGI-2, with its own code, before anything is held", async () => {
    const check = await probeAndCheckRefVideoDurations({ provider: "magi-2", referenceVideoUrls: [MP4, WEBM] })
    expect(check.ok).toBe(false)
    if (!check.ok) {
      expect(check.code).toBe("video_format_unsupported")
      expect(check.message).toMatch(/MP4 or MOV/)
    }
  })

  it("refuses a clip outside 2-30 s, or 30 s together, on MAGI-2", async () => {
    probe.durations.set(MP4, 1)
    expect((await probeAndCheckRefVideoDurations({ provider: "magi-2", referenceVideoUrls: [MP4] })).ok).toBe(false)
    probe.durations.set(MP4, 20)
    probe.durations.set(MOV, 20)
    expect((await probeAndCheckRefVideoDurations({ provider: "magi-2", referenceVideoUrls: [MP4, MOV] })).ok).toBe(false)
  })

  it("does not probe the container on a model with no format rule", async () => {
    expect(await refVideoContainerProblem("seedance-2-5", [WEBM])).toBeUndefined()
    expect(probeMediaFormatAndDuration).not.toHaveBeenCalled()
  })
})
