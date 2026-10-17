/**
 * The unit's video-queue handler: strip → upload → thumbnail → complete →
 * commit, in that order; a cancelled job or a lost completion race commits nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"

const m = vi.hoisted(() => ({
  calls: [] as string[],
  removeAudio: vi.fn(),
  upload: vi.fn(),
  cleanup: vi.fn(),
  thumbnail: vi.fn(),
  progress: vi.fn(),
  shouldSave: vi.fn(),
  markCompleted: vi.fn(),
  commit: vi.fn(),
}))

vi.mock("@/providers/video/remove-audio.js", () => ({ removeAudio: m.removeAudio }))
vi.mock("@/lib/storage.js", () => ({ uploadFileToR2: m.upload }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ cleanupWorkDir: m.cleanup }))
vi.mock("@/workers/shared.js", () => ({
  generateAndUploadThumbnail: m.thumbnail,
  setJobProgress: m.progress,
  shouldSaveJobResult: m.shouldSave,
  markJobCompleted: m.markCompleted,
  commitJobCredits: m.commit,
}))

import { worker } from "../worker.js"

const job = { data: { jobId: "job-1", videoUrl: "https://media.test/clip.mp4" } } as unknown as Job
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "ul-1" } as Parameters<typeof worker>[1]
const track = (name: string, value?: unknown) => async () => { m.calls.push(name); return value }

beforeEach(() => {
  m.calls = []
  vi.spyOn(console, "log").mockImplementation(() => {})
  m.removeAudio.mockReset().mockImplementation(track("removeAudio", { videoPath: "/tmp/remove-audio-x/silent.mp4" }))
  m.upload.mockReset().mockImplementation(track("upload", "https://r2.test/job-1.mp4"))
  m.cleanup.mockReset().mockImplementation(track("cleanup"))
  m.thumbnail.mockReset().mockImplementation(track("thumbnail", "https://r2.test/job-1.png"))
  m.progress.mockReset().mockImplementation(async (_j: unknown, _id: string, p: number) => { m.calls.push(`progress ${p}`) })
  m.shouldSave.mockReset().mockImplementation(track("shouldSave", true))
  m.markCompleted.mockReset().mockImplementation(track("markCompleted", true))
  m.commit.mockReset().mockImplementation(track("commit"))
})

describe("remove-audio worker", () => {
  it("strips, uploads, completes with the silent video and its thumbnail, then commits", async () => {
    await worker(job, ctx)
    // The work-dir prefix is the unit's own type, passed into the provider.
    expect(m.removeAudio).toHaveBeenCalledWith({ videoUrl: "https://media.test/clip.mp4", workDirPrefix: "remove-audio" })
    expect(m.upload).toHaveBeenCalledWith("/tmp/remove-audio-x/silent.mp4", "job-1", "video", "user-1")
    expect(m.cleanup).toHaveBeenCalledWith("/tmp/remove-audio-x")
    expect(m.markCompleted).toHaveBeenCalledWith("job-1", { output_data: { videoUrl: "https://r2.test/job-1.mp4", thumbnailUrl: "https://r2.test/job-1.png" } })
    expect(m.commit).toHaveBeenCalledWith("ul-1", "job-1")
    expect(m.calls).toEqual(["removeAudio", "progress 80", "upload", "cleanup", "thumbnail", "progress 100", "shouldSave", "markCompleted", "commit"])
  })

  it("a cancelled job saves and commits nothing", async () => {
    m.shouldSave.mockResolvedValue(false)
    await worker(job, ctx)
    expect(m.markCompleted).not.toHaveBeenCalled()
    expect(m.commit).not.toHaveBeenCalled()
  })

  it("a lost completion race commits nothing", async () => {
    m.markCompleted.mockResolvedValue(false)
    await worker(job, ctx)
    expect(m.commit).not.toHaveBeenCalled()
  })
})
