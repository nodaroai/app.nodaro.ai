import { describe, it, expect, vi, beforeEach } from "vitest"

// One rule for both places a Video SFX run starts: the route's preHandler and
// the workflow run. The workflow side stamps the length and its price row on
// the payload (the fields the route writes into input_data), so the model
// scores the real clip and the reservation keys off the right row.

const { probe } = vi.hoisted(() => ({ probe: vi.fn() }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({ probeVideoSource: probe }))

import { measureVideoSfxDuration, stampVideoSfxDuration, videoSfxReserveId } from "../video-sfx-duration.js"

const clip = (seconds: number) => ({ width: 1920, height: 1080, durationSeconds: seconds })

beforeEach(() => {
  probe.mockReset()
})

describe("measureVideoSfxDuration", () => {
  it.each([
    [12.3, 13, "replicate-mmaudio:15s"],
    [30, 30, "replicate-mmaudio:30s"],
    [180, 180, "replicate-mmaudio:300s"],
  ])("a %s s clip → %i s, row %s", async (seconds, durationSec, creditId) => {
    probe.mockResolvedValue(clip(seconds))
    expect(await measureVideoSfxDuration("https://cdn.example.com/a.mp4")).toEqual({ ok: true, durationSec, creditId })
  })

  it("an unreadable clip falls back to 8 seconds and reports the failure", async () => {
    probe.mockRejectedValue(new Error("ffprobe failed"))
    const onFailure = vi.fn()
    expect(await measureVideoSfxDuration("https://cdn.example.com/a.mp4", onFailure)).toEqual({
      ok: true,
      durationSec: 8,
      creditId: "replicate-mmaudio:8s",
    })
    expect(onFailure).toHaveBeenCalledOnce()
  })

  it("refuses a clip with no length or one over 300 seconds, with the route's codes", async () => {
    probe.mockResolvedValue(clip(0))
    expect(await measureVideoSfxDuration("u")).toMatchObject({ ok: false, code: "invalid_video_duration" })
    probe.mockResolvedValue(clip(301))
    expect(await measureVideoSfxDuration("u")).toMatchObject({ ok: false, code: "video_duration_exceeds_limit" })
  })
})

describe("stampVideoSfxDuration + videoSfxReserveId (the workflow run)", () => {
  it("stamps the length the model scores and the row the run reserves", async () => {
    probe.mockResolvedValue(clip(42))
    const payload: Record<string, unknown> = { videoUrl: "https://cdn.example.com/a.mp4" }
    expect(await stampVideoSfxDuration("video-sfx", payload)).toBeUndefined()
    expect(payload).toMatchObject({ duration_seconds: 42, bucketKey: "replicate-mmaudio:60s" })
    expect(videoSfxReserveId("video-sfx", payload)).toBe("replicate-mmaudio:60s")
  })

  it("returns the route's refusal and stamps nothing", async () => {
    probe.mockResolvedValue(clip(400))
    const payload: Record<string, unknown> = { videoUrl: "https://cdn.example.com/a.mp4" }
    expect(await stampVideoSfxDuration("video-sfx", payload)).toMatchObject({ code: "video_duration_exceeds_limit" })
    expect(payload.duration_seconds).toBeUndefined()
    expect(videoSfxReserveId("video-sfx", payload)).toBeUndefined()
  })

  it("leaves every other job untouched, without probing", async () => {
    const payload: Record<string, unknown> = { videoUrl: "https://cdn.example.com/a.mp4", bucketKey: "x" }
    expect(await stampVideoSfxDuration("trim-video", payload)).toBeUndefined()
    expect(probe).not.toHaveBeenCalled()
    expect(payload).toEqual({ videoUrl: "https://cdn.example.com/a.mp4", bucketKey: "x" })
    expect(videoSfxReserveId("trim-video", payload)).toBeUndefined()
  })
})
