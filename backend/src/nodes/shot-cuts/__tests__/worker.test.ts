/**
 * The unit's video-queue handler: measure → upload each saved frame once →
 * complete with the result on `json` (and the frames in shot order on their own
 * keys) → commit; the work dir is removed either way; a cancelled job or a lost
 * completion race commits nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"

const m = vi.hoisted(() => ({
  measure: vi.fn(),
  upload: vi.fn(),
  cleanup: vi.fn(),
  progress: vi.fn(),
  shouldSave: vi.fn(),
  markCompleted: vi.fn(),
  commit: vi.fn(),
}))

vi.mock("@/providers/video/shot-cuts.js", () => ({ measureShotCuts: m.measure, SHOT_CUTS_UPLOAD_CONCURRENCY: 6 }))
vi.mock("@/lib/storage.js", () => ({ uploadFileToR2: m.upload }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ cleanupWorkDir: m.cleanup }))
vi.mock("@/workers/shared.js", () => ({
  setJobProgress: m.progress,
  shouldSaveJobResult: m.shouldSave,
  markJobCompleted: m.markCompleted,
  commitJobCredits: m.commit,
}))

import { worker } from "../worker.js"

const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "ul-1" } as Parameters<typeof worker>[1]
const jobOf = (data: Record<string, unknown>) => ({ data: { jobId: "job-1", videoUrl: "https://media.test/clip.mp4", ...data } }) as unknown as Job

// Three shots: 0–1 s (frames 0–23), 1–2.5 s (24–59), and a one-frame shot 2.5–2.542 s (frame 60).
const SHOTS = [
  { index: 0, startSec: 0, endSec: 1, durationSec: 1, firstFrame: 0, lastFrame: 23 },
  { index: 1, startSec: 1, endSec: 2.5, durationSec: 1.5, firstFrame: 24, lastFrame: 59 },
  { index: 2, startSec: 2.5, endSec: 2.542, durationSec: 0.042, firstFrame: 60, lastFrame: 60 },
]
const measured = (framePaths?: Map<number, string>) => ({ workDir: "/tmp/shot-scan-x", durationSec: 2.542, cutsSec: [1, 2.5], shots: SHOTS, ...(framePaths ? { framePaths } : {}) })

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  m.measure.mockReset().mockResolvedValue(measured())
  m.upload.mockReset().mockImplementation(async (_path: string, id: string) => `https://r2.test/${id}.png`)
  m.cleanup.mockReset().mockResolvedValue(undefined)
  m.progress.mockReset().mockResolvedValue(undefined)
  m.shouldSave.mockReset().mockResolvedValue(true)
  m.markCompleted.mockReset().mockResolvedValue(true)
  m.commit.mockReset().mockResolvedValue(undefined)
})

describe("shot-cuts worker", () => {
  it("frames off: completes with the shots on json (no frame URLs, no frame keys), then commits", async () => {
    await worker(jobOf({ frames: false }), ctx)
    expect(m.measure).toHaveBeenCalledWith({ videoUrl: "https://media.test/clip.mp4", frames: false })
    expect(m.upload).not.toHaveBeenCalled()
    expect(m.cleanup).toHaveBeenCalledWith("/tmp/shot-scan-x")
    expect(m.markCompleted).toHaveBeenCalledWith("job-1", {
      output_data: {
        json: {
          shotCount: 3,
          cutsSec: [1, 2.5],
          durationSec: 2.542,
          shots: [
            { index: 0, startSec: 0, endSec: 1, durationSec: 1 },
            { index: 1, startSec: 1, endSec: 2.5, durationSec: 1.5 },
            { index: 2, startSec: 2.5, endSec: 2.542, durationSec: 0.042 },
          ],
        },
      },
    })
    expect(m.commit).toHaveBeenCalledWith("ul-1", "job-1")
  })

  it("frames on: uploads each frame once (a one-frame shot's first is its last) and lists them in shot order", async () => {
    const paths = new Map([0, 23, 24, 59, 60].map((n) => [n, `/tmp/shot-scan-x/frames/frame-${n}.png`] as const))
    m.measure.mockResolvedValue(measured(paths))
    await worker(jobOf({ frames: true }), ctx)
    expect(m.measure).toHaveBeenCalledWith({ videoUrl: "https://media.test/clip.mp4", frames: true })
    expect(m.upload).toHaveBeenCalledTimes(5)
    expect(m.upload).toHaveBeenCalledWith("/tmp/shot-scan-x/frames/frame-60.png", "job-1-frame-60", "image", "user-1")
    const out = m.markCompleted.mock.calls[0]![1].output_data
    expect(out.json.shots[2]).toEqual({ index: 2, startSec: 2.5, endSec: 2.542, durationSec: 0.042, firstFrameUrl: "https://r2.test/job-1-frame-60.png", lastFrameUrl: "https://r2.test/job-1-frame-60.png" })
    expect(out.firstFrames).toEqual(["https://r2.test/job-1-frame-0.png", "https://r2.test/job-1-frame-24.png", "https://r2.test/job-1-frame-60.png"])
    expect(out.lastFrames).toEqual(["https://r2.test/job-1-frame-23.png", "https://r2.test/job-1-frame-59.png", "https://r2.test/job-1-frame-60.png"])
    expect(m.cleanup).toHaveBeenCalledWith("/tmp/shot-scan-x")
  })

  it("a one-shot clip: one shot covering the clip, no cuts", async () => {
    m.measure.mockResolvedValue({ workDir: "/tmp/shot-scan-y", durationSec: 2, cutsSec: [], shots: [{ index: 0, startSec: 0, endSec: 2, durationSec: 2, firstFrame: 0, lastFrame: 47 }] })
    await worker(jobOf({}), ctx)
    expect(m.markCompleted.mock.calls[0]![1].output_data).toEqual({ json: { shotCount: 1, cutsSec: [], durationSec: 2, shots: [{ index: 0, startSec: 0, endSec: 2, durationSec: 2 }] } })
  })

  it("a failed upload still removes the work dir, and completes nothing", async () => {
    m.measure.mockResolvedValue(measured(new Map([[0, "/tmp/f0.png"]])))
    m.upload.mockRejectedValue(new Error("R2 down"))
    await expect(worker(jobOf({ frames: true }), ctx)).rejects.toThrow("R2 down")
    expect(m.cleanup).toHaveBeenCalledWith("/tmp/shot-scan-x")
    expect(m.markCompleted).not.toHaveBeenCalled()
  })

  it("a cancelled job saves and commits nothing", async () => {
    m.shouldSave.mockResolvedValue(false)
    await worker(jobOf({}), ctx)
    expect(m.markCompleted).not.toHaveBeenCalled()
    expect(m.commit).not.toHaveBeenCalled()
  })

  it("a lost completion race commits nothing", async () => {
    m.markCompleted.mockResolvedValue(false)
    await worker(jobOf({}), ctx)
    expect(m.commit).not.toHaveBeenCalled()
  })
})
