import { beforeEach, describe, expect, it, vi } from "vitest"

// One gate for both places a Video Depth run starts: the route's preHandler and
// the workflow run. The clip's length both decides whether the provider can
// take it at all and which price row is reserved, so an unmeasurable clip is
// refused rather than guessed (a guess could under-reserve).

const { mockProbe } = vi.hoisted(() => ({ mockProbe: vi.fn() }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({ probeVideoSource: mockProbe }))

import { measureVideoDepthInput, stampVideoDepthInput, videoDepthReserveId } from "../video-depth-input.js"

// Braces matter: vitest runs a function returned from beforeEach as the test's
// teardown, and mockReset() returns the mock itself — so the arrow-expression form
// would CALL the probe after each test (a rejected promise after the failure case).
beforeEach(() => {
  mockProbe.mockReset()
})

describe("measureVideoDepthInput", () => {
  it("prices a measurable fal clip by its ceil'd length", async () => {
    mockProbe.mockResolvedValue({ width: 640, height: 360, durationSeconds: 14.2, fps: 24 })
    expect(await measureVideoDepthInput("video-depth-anything", "https://x/v.mp4"))
      .toEqual({ ok: true, durationSec: 15, creditId: "video-depth-anything:15s" })
  })
  it("rejects over 2,400 frames as video_too_long", async () => {
    mockProbe.mockResolvedValue({ width: 640, height: 360, durationSeconds: 101, fps: 24 })
    const r = await measureVideoDepthInput("video-depth-anything", "https://x/v.mp4")
    expect(r).toMatchObject({ ok: false, code: "video_too_long" })
  })
  it("a low-fps fal clip under 2,400 frames but over 300 s is video_too_long (no price row above 300 s)", async () => {
    mockProbe.mockResolvedValue({ width: 640, height: 360, durationSeconds: 480, fps: 5 })
    const r = await measureVideoDepthInput("video-depth-anything", "https://x/v.mp4")
    expect(r).toMatchObject({ ok: false, code: "video_too_long" })
    if (!r.ok) expect(r.message).toMatch(/at most 300 s/)
  })
  it("VFR clip (no fps) is checked at 30 fps", async () => {
    mockProbe.mockResolvedValue({ width: 640, height: 360, durationSeconds: 81 })
    expect(await measureVideoDepthInput("video-depth-anything", "https://x/v.mp4")).toMatchObject({ ok: false, code: "video_too_long" })
  })
  it("a probe failure (incl. the SSRF guard) is video_unreadable, never a guess", async () => {
    mockProbe.mockRejectedValue(new Error("Refusing to probe a private address"))
    const onFail = vi.fn()
    const r = await measureVideoDepthInput("video-depth-anything", "http://10.0.0.1/v.mp4", onFail)
    expect(r).toMatchObject({ ok: false, code: "video_unreadable" })
    expect(onFail).toHaveBeenCalled()
  })
  it("replicate cap is seconds", async () => {
    mockProbe.mockResolvedValue({ width: 640, height: 360, durationSeconds: 90, fps: 10 })
    expect(await measureVideoDepthInput("depth-anything-frames", "https://x/v.mp4")).toMatchObject({ ok: false, code: "video_too_long" })
  })
})

describe("stampVideoDepthInput / videoDepthReserveId", () => {
  it("ignores other jobs", async () => {
    const p = { videoUrl: "https://x/v.mp4" }
    expect(await stampVideoDepthInput("video-sfx", p)).toBeUndefined()
    expect(p).toEqual({ videoUrl: "https://x/v.mp4" })
    expect(videoDepthReserveId("video-sfx", { bucketKey: "x" })).toBeUndefined()
  })
  it("stamps duration + bucket and defaults the provider", async () => {
    mockProbe.mockResolvedValue({ width: 1, height: 1, durationSeconds: 40, fps: 30 })
    const p: Record<string, unknown> = { videoUrl: "https://x/v.mp4" }
    expect(await stampVideoDepthInput("video-depth", p)).toBeUndefined()
    expect(p).toMatchObject({ duration_seconds: 40, bucketKey: "video-depth-anything:60s", provider: "video-depth-anything" })
    expect(videoDepthReserveId("video-depth", p)).toBe("video-depth-anything:60s")
  })
  it("coerces an unknown provider (raw workflow JSON) to the default, so no unknown id reaches the credit row", async () => {
    mockProbe.mockResolvedValue({ width: 1, height: 1, durationSeconds: 10, fps: 30 })
    const p: Record<string, unknown> = { videoUrl: "https://x/v.mp4", provider: "nope" }
    expect(await stampVideoDepthInput("video-depth", p)).toBeUndefined()
    expect(p.provider).toBe("video-depth-anything")
    expect(p.bucketKey).toBe("video-depth-anything:15s")
  })
  it("returns the refusal for a long clip, and stamps no price row", async () => {
    mockProbe.mockResolvedValue({ width: 1, height: 1, durationSeconds: 200, fps: 30 })
    const p: Record<string, unknown> = { videoUrl: "https://x/v.mp4" }
    expect(await stampVideoDepthInput("video-depth", p)).toMatchObject({ code: "video_too_long" })
    expect(p.bucketKey).toBeUndefined()
    expect(p.duration_seconds).toBeUndefined()
    expect(videoDepthReserveId("video-depth", p)).toBeUndefined()
  })
  // Raw workflow JSON reaches the stamp without the route's safeUrlSchema, and
  // probeVideoSource's SSRF guard only inspects strings with a scheme — a bare
  // path or a file: URL must be refused before anything is probed.
  it.each(["/etc/passwd", "file:///etc/passwd", "ftp://x/v.mp4", "http://127.0.0.1/v.mp4", "", "not a url"])(
    "refuses %j as video_unreadable without probing",
    async (videoUrl) => {
      const p: Record<string, unknown> = { videoUrl }
      const r = await stampVideoDepthInput("video-depth", p)
      expect(r).toEqual({
        code: "video_unreadable",
        message: "Could not read the video. Check that the link is a reachable video file.",
      })
      expect(mockProbe).not.toHaveBeenCalled()
      expect(p.provider).toBe("video-depth-anything")
      expect(p.bucketKey).toBeUndefined()
      expect(p.duration_seconds).toBeUndefined()
    },
  )
  it("refuses a missing videoUrl without probing", async () => {
    const p: Record<string, unknown> = {}
    expect(await stampVideoDepthInput("video-depth", p)).toMatchObject({ code: "video_unreadable" })
    expect(mockProbe).not.toHaveBeenCalled()
  })
})
