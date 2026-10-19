/**
 * The unit's video-queue handler: download → (cache hit, or convert → upload)
 * → thumbnail → complete → commit; a cancelled job or a lost completion race
 * commits nothing, and a failure still cleans the work dir.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"

const m = vi.hoisted(() => ({
  calls: [] as string[],
  gifToVideo: vi.fn(),
  upload: vi.fn(),
  size: vi.fn(),
  r2Url: vi.fn(),
  createWorkDir: vi.fn(),
  download: vi.fn(),
  cleanup: vi.fn(),
  readFile: vi.fn(),
  thumbnail: vi.fn(),
  progress: vi.fn(),
  shouldSave: vi.fn(),
  markCompleted: vi.fn(),
  commit: vi.fn(),
}))

vi.mock("node:fs", () => ({ promises: { readFile: m.readFile } }))
vi.mock("@/providers/video/gif-to-video.js", () => ({ gifToVideo: m.gifToVideo }))
vi.mock("@/lib/storage.js", () => ({ uploadFileWithKeyToR2: m.upload, getR2ObjectSize: m.size, r2Url: m.r2Url }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ cleanupWorkDir: m.cleanup, createWorkDir: m.createWorkDir, downloadFile: m.download }))
vi.mock("@/workers/shared.js", () => ({
  generateAndUploadThumbnail: m.thumbnail,
  setJobProgress: m.progress,
  shouldSaveJobResult: m.shouldSave,
  markJobCompleted: m.markCompleted,
  commitJobCredits: m.commit,
}))

import { worker } from "../worker.js"

const job = { data: { jobId: "job-1", gifUrl: "https://media.test/a.gif", loopToMinimum: true, targetDuration: 3, interpolate: true, alphaBackground: "white" } } as unknown as Job
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "ul-1" } as Parameters<typeof worker>[1]
const track = (name: string, value?: unknown) => async () => { m.calls.push(name); return value }
const RESULT = { outputPath: "/tmp/gif-to-video-x/out.mp4", sourceFrames: 12, sourceDurationSeconds: 1.2, outputDurationSeconds: 3, loopStrategy: "repeat", loops: 3, seamless: true, interpolated: true }

beforeEach(() => {
  m.calls = []
  vi.spyOn(console, "log").mockImplementation(() => {})
  m.createWorkDir.mockReset().mockImplementation(track("createWorkDir", "/tmp/gif-to-video-x"))
  m.download.mockReset().mockImplementation(track("download"))
  m.readFile.mockReset().mockResolvedValue(Buffer.from("GIF89a"))
  m.size.mockReset().mockResolvedValue(0)
  m.r2Url.mockReset().mockImplementation((key: string) => `https://r2.test/${key}`)
  m.gifToVideo.mockReset().mockImplementation(track("gifToVideo", RESULT))
  m.upload.mockReset().mockImplementation(track("upload", "https://r2.test/videos/gif2mp4/h.mp4"))
  m.cleanup.mockReset().mockImplementation(track("cleanup"))
  m.thumbnail.mockReset().mockImplementation(track("thumbnail", "https://r2.test/job-1.png"))
  m.progress.mockReset().mockImplementation(async (_j: unknown, _id: string, p: number) => { m.calls.push(`progress ${p}`) })
  m.shouldSave.mockReset().mockImplementation(track("shouldSave", true))
  m.markCompleted.mockReset().mockImplementation(track("markCompleted", true))
  m.commit.mockReset().mockImplementation(track("commit"))
})

describe("gif-to-video worker", () => {
  it("converts, uploads under the content-addressed key, completes with the video, its thumbnail and the conversion facts, then commits", async () => {
    await worker(job, ctx)
    // The work-dir prefix is the unit's own type.
    expect(m.createWorkDir).toHaveBeenCalledWith("gif-to-video")
    expect(m.download).toHaveBeenCalledWith("https://media.test/a.gif", "/tmp/gif-to-video-x/input.gif")
    expect(m.gifToVideo).toHaveBeenCalledWith({ gifPath: "/tmp/gif-to-video-x/input.gif", workDir: "/tmp/gif-to-video-x", loopToMinimum: true, targetDuration: 3, interpolate: true, alphaBackground: "white" })
    const key = m.upload.mock.calls[0]![1] as string
    expect(key).toMatch(/^videos\/gif2mp4\/[0-9a-f]{64}\.mp4$/)
    expect(m.upload).toHaveBeenCalledWith(RESULT.outputPath, key, "video/mp4", "user-1")
    expect(m.markCompleted).toHaveBeenCalledWith("job-1", { output_data: {
      videoUrl: "https://r2.test/videos/gif2mp4/h.mp4", thumbnailUrl: "https://r2.test/job-1.png", cached: false,
      gifSourceFrames: 12, gifSourceDuration: 1.2, outputDuration: 3, loopStrategy: "repeat", loops: 3, seamless: true, interpolated: true,
    } })
    expect(m.commit).toHaveBeenCalledWith("ul-1", "job-1")
    expect(m.calls).toEqual(["progress 3", "createWorkDir", "download", "progress 20", "gifToVideo", "progress 80", "upload", "cleanup", "progress 90", "thumbnail", "progress 100", "shouldSave", "markCompleted", "commit"])
  })

  it("a cache hit reuses the encoded MP4 without converting", async () => {
    m.size.mockResolvedValue(1234)
    await worker(job, ctx)
    expect(m.gifToVideo).not.toHaveBeenCalled()
    expect(m.upload).not.toHaveBeenCalled()
    const url = (m.markCompleted.mock.calls[0]![1] as { output_data: { videoUrl: string; cached: boolean } }).output_data
    expect(url.cached).toBe(true)
    expect(url.videoUrl).toMatch(/^https:\/\/r2\.test\/videos\/gif2mp4\/[0-9a-f]{64}\.mp4$/)
  })

  it("a settings change misses the cache: the key covers the GIF bytes and the conversion settings", async () => {
    await worker(job, ctx)
    await worker({ data: { ...(job.data as object), interpolate: false } } as unknown as Job, ctx)
    const [a, b] = m.size.mock.calls.map((c) => c[0])
    expect(a).not.toBe(b)
  })

  it("a cancelled job saves and commits nothing; a lost completion race commits nothing", async () => {
    m.shouldSave.mockResolvedValue(false)
    await worker(job, ctx)
    expect(m.markCompleted).not.toHaveBeenCalled()
    m.shouldSave.mockResolvedValue(true)
    m.markCompleted.mockResolvedValue(false)
    await worker(job, ctx)
    expect(m.commit).not.toHaveBeenCalled()
  })

  it("a failed conversion cleans the work dir and rethrows", async () => {
    m.gifToVideo.mockRejectedValue(new Error("boom"))
    await expect(worker(job, ctx)).rejects.toThrow("boom")
    expect(m.cleanup).toHaveBeenCalledWith("/tmp/gif-to-video-x")
  })
})
