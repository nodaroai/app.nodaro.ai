import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({ probeClipLengthSec: vi.fn() }))
vi.mock("../video-utility-probe.js", () => ({ probeClipLengthSec: m.probeClipLengthSec }))

import {
  ADD_CAPTIONS_UNREADABLE_MESSAGE,
  captionsRenderLengthFits,
  captionsRenderLimited,
  captionsTooLongMessage,
  checkAddCaptionsLength,
  readCaptionsVideoLength,
} from "../add-captions-length.js"

beforeEach(() => {
  vi.clearAllMocks()
  m.probeClipLengthSec.mockResolvedValue(120)
})

describe("Add Captions' 5-minute limit for a rendered caption", () => {
  it("up to 5 minutes runs, a hair past it forgiven", () => {
    expect(captionsRenderLengthFits(300)).toBe(true)
    expect(captionsRenderLengthFits(300.04)).toBe(true)
    expect(captionsRenderLengthFits(301)).toBe(false)
  })

  it("names the length, the limit and what to do", () => {
    expect(captionsTooLongMessage(3600)).toBe(
      "The video is 60 min long. Add Captions takes videos up to 5 minutes for animated, styled or transcribed captions: trim it first, or burn a plain text subtitle.",
    )
    expect(captionsTooLongMessage(372)).toMatch(/^The video is 6 min 12 s long\./)
  })

  it("limits exactly the captions the Remotion render draws (the predicate its price id follows)", () => {
    // Transcribed (no text), a kinetic style, a styled subtitle: rendered.
    expect(captionsRenderLimited({ style: "subtitle" })).toBe(true)
    expect(captionsRenderLimited({ style: "word-highlight", text: "hi" })).toBe(true)
    expect(captionsRenderLimited({ style: "subtitle", text: "hi", fontFamily: "Inter" })).toBe(true)
    // A plain text subtitle is burned by FFmpeg: not limited here.
    expect(captionsRenderLimited({ style: "subtitle", text: "hi" })).toBe(false)
  })

  it("reads the video before anything is held, and refuses past the limit", async () => {
    await expect(readCaptionsVideoLength("https://cdn.example/clip.mp4")).resolves.toEqual({ ok: true, videoSec: 120 })
    m.probeClipLengthSec.mockResolvedValueOnce(1800)
    await expect(readCaptionsVideoLength("https://cdn.example/clip.mp4")).resolves.toMatchObject({ ok: false, code: "video_too_long" })
  })

  it("a video whose length cannot be read is refused", async () => {
    m.probeClipLengthSec.mockRejectedValueOnce(new Error("Invalid data found when processing input"))
    await expect(readCaptionsVideoLength("https://cdn.example/clip.mp4")).resolves.toEqual({
      ok: false,
      code: "video_unreadable",
      message: ADD_CAPTIONS_UNREADABLE_MESSAGE,
    })
  })

  it("the workflow run refuses what the route refuses, and reads nothing for a plain text subtitle or another job", async () => {
    m.probeClipLengthSec.mockResolvedValueOnce(900)
    await expect(checkAddCaptionsLength("add-captions", { videoUrl: "https://cdn.example/clip.mp4", style: "karaoke" }))
      .resolves.toMatchObject({ code: "video_too_long" })
    await expect(checkAddCaptionsLength("add-captions", { videoUrl: "https://cdn.example/clip.mp4", style: "karaoke" })).resolves.toBeUndefined()
    await expect(checkAddCaptionsLength("add-captions", { videoUrl: "https://cdn.example/clip.mp4", style: "subtitle", text: "hi" })).resolves.toBeUndefined()
    await expect(checkAddCaptionsLength("trim-video", { videoUrl: "https://cdn.example/clip.mp4" })).resolves.toBeUndefined()
    expect(m.probeClipLengthSec).toHaveBeenCalledTimes(2)
    // A link the route's own schema refuses is never read.
    await expect(checkAddCaptionsLength("add-captions", { videoUrl: "file:///etc/passwd", style: "karaoke" })).resolves.toMatchObject({ code: "video_unreadable" })
    expect(m.probeClipLengthSec).toHaveBeenCalledTimes(2)
  })
})
