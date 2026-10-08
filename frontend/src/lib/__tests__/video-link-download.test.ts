import { describe, it, expect, vi, beforeEach } from "vitest"

const startVideoDownload = vi.fn()
const fetchVideoMetadata = vi.fn()
vi.mock("@/lib/api", () => ({
  startVideoDownload: (...a: unknown[]) => startVideoDownload(...a),
  fetchVideoMetadata: (...a: unknown[]) => fetchVideoMetadata(...a),
}))
const followVideoDownload = vi.fn()
vi.mock("@/lib/video-download-stream", () => ({
  followVideoDownload: (...a: unknown[]) => followVideoDownload(...a),
}))

import { downloadVideoLink, type LinkDownloadEvent } from "../video-link-download"

const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const TIKTOK = "https://www.tiktok.com/@someone/video/7676964064458738952"
const FILE = "https://cdn.nodaro.ai/videos/yt-1.mp4"
const THUMB = "https://cdn.nodaro.ai/thumbnails/yt-1.jpg"

const run = (url: string, request: Parameters<typeof downloadVideoLink>[1] = {}, signal = new AbortController().signal) => {
  const events: LinkDownloadEvent[] = []
  const outcome = downloadVideoLink(url, request, { onEvent: (e) => events.push(e), signal })
  return { events, outcome }
}

beforeEach(() => {
  vi.clearAllMocks()
  startVideoDownload.mockResolvedValue({ downloadId: "dl-1" })
  followVideoDownload.mockResolvedValue({ status: "completed", videoUrl: FILE, thumbnailUrl: THUMB })
  fetchVideoMetadata.mockResolvedValue({ durationSec: 95, title: "A short clip", isLive: false })
})

describe("downloadVideoLink — the runner's copy of the Video URL node's download rules", () => {
  it("downloads a TikTok link whole with no probe and no quality cap", async () => {
    const { outcome } = run(TIKTOK)
    expect(await outcome).toEqual({ status: "completed", videoUrl: FILE, thumbnailUrl: THUMB })
    expect(fetchVideoMetadata).not.toHaveBeenCalled()
    expect(startVideoDownload).toHaveBeenCalledWith(TIKTOK, {})
  })

  it("probes a YouTube link and downloads a SHORT one whole, capped at 1080 rows", async () => {
    const { outcome, events } = run(YT)
    expect((await outcome).status).toBe("completed")
    expect(fetchVideoMetadata).toHaveBeenCalledWith(YT)
    expect(startVideoDownload).toHaveBeenCalledWith(YT, { maxHeight: 1080 })
    expect(events[0]).toEqual({ kind: "checking" })
  })

  it("asks before a long YouTube video — an episode is never fetched whole on its own", async () => {
    fetchVideoMetadata.mockResolvedValue({ durationSec: 5530, title: null, isLive: false })
    expect(await run(YT).outcome).toEqual({ status: "needs-choice", durationSec: 5530 })
    expect(startVideoDownload).not.toHaveBeenCalled()
  })

  it("draws the line AT four minutes, and asks when the length cannot be read", async () => {
    fetchVideoMetadata.mockResolvedValue({ durationSec: 239.9, title: null, isLive: false })
    expect((await run(YT).outcome).status).toBe("completed")
    fetchVideoMetadata.mockResolvedValue({ durationSec: 240, title: null, isLive: false })
    expect((await run(YT).outcome).status).toBe("needs-choice")
    fetchVideoMetadata.mockResolvedValue({ durationSec: null, title: null, isLive: false })
    expect(await run(YT).outcome).toEqual({ status: "needs-choice", durationSec: null })
  })

  it("a live stream fails as `live`", async () => {
    fetchVideoMetadata.mockResolvedValue({ durationSec: null, title: null, isLive: true })
    expect(await run(YT).outcome).toMatchObject({ status: "failed", code: "live" })
  })

  it("the person's answer to the question skips the probe: a chosen part is cut exactly", async () => {
    const section = { startSec: 60, endSec: 180 }
    await run(YT, { mode: "section", section }).outcome
    expect(fetchVideoMetadata).not.toHaveBeenCalled()
    expect(startVideoDownload).toHaveBeenCalledWith(YT, { maxHeight: 1080, section, exactSection: true })
    startVideoDownload.mockClear()
    await run(YT, { mode: "whole" }).outcome
    expect(startVideoDownload).toHaveBeenCalledWith(YT, { maxHeight: 1080 })
  })

  it("a section mode with no section fails rather than downloading the whole video", async () => {
    expect(await run(YT, { mode: "section" }).outcome).toMatchObject({ status: "failed", code: "generic" })
    expect(startVideoDownload).not.toHaveBeenCalled()
  })

  it("accepts a file with no sound only when asked", async () => {
    await run(TIKTOK, { allowSilent: true }).outcome
    expect(startVideoDownload).toHaveBeenCalledWith(TIKTOK, { requireAudio: false })
  })

  it("classifies a refused start by the server's own words", async () => {
    startVideoDownload.mockRejectedValue(new Error("This video is private"))
    expect(await run(TIKTOK).outcome).toMatchObject({ status: "failed", code: "private", raw: "This video is private" })
  })

  it("reports progress, and classifies a failed or lost download", async () => {
    followVideoDownload.mockImplementation(async (_id: string, opts: { onProgress(p: { percent: number; phase: string }): void }) => {
      opts.onProgress({ percent: 42, phase: "downloading" })
      return { status: "failed", error: "Sign in to confirm your age" }
    })
    const failed = run(TIKTOK)
    expect(await failed.outcome).toMatchObject({ status: "failed", code: "age_restricted" })
    expect(failed.events).toContainEqual({ kind: "progress", percent: 42, phase: "downloading" })

    followVideoDownload.mockResolvedValue({ status: "lost" })
    expect(await run(TIKTOK).outcome).toMatchObject({ status: "failed", code: "connection" })
  })

  it("starts once more when the server forgot the download, then gives up", async () => {
    followVideoDownload.mockResolvedValueOnce({ status: "expired" }).mockResolvedValueOnce({ status: "completed", videoUrl: FILE })
    expect((await run(TIKTOK).outcome).status).toBe("completed")
    expect(startVideoDownload).toHaveBeenCalledTimes(2)

    startVideoDownload.mockClear()
    followVideoDownload.mockResolvedValue({ status: "expired" })
    expect(await run(TIKTOK).outcome).toMatchObject({ status: "failed", code: "connection" })
    expect(startVideoDownload).toHaveBeenCalledTimes(2)
  })

  it("an abort ends it as `aborted`, writing nothing after", async () => {
    const controller = new AbortController()
    fetchVideoMetadata.mockImplementation(async () => {
      controller.abort()
      return { durationSec: 10, title: null, isLive: false }
    })
    const { outcome } = run(YT, {}, controller.signal)
    expect(await outcome).toEqual({ status: "aborted" })
    expect(startVideoDownload).not.toHaveBeenCalled()

    followVideoDownload.mockResolvedValue({ status: "aborted" })
    expect(await run(TIKTOK).outcome).toEqual({ status: "aborted" })
  })
})
