/**
 * Trim, Loop and Combine Videos re-measure the clips they downloaded and,
 * BEFORE anything is probed for the cut or encoded, refuse clips that need
 * more units than the run was charged — and refuse a job that carries none
 * before anything is downloaded. Both refusals are DeterministicJobError: the
 * worker fails the row and refunds it on this attempt, with no retry. The
 * check reads the container length, the reading the charge was measured on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const m = vi.hoisted(() => ({
  downloadFile: vi.fn(async (_url: string, _path: string) => undefined),
  probeVideoSource: vi.fn(async (_path: string) => ({ width: 640, height: 360, durationSeconds: 10 })),
  runFfmpeg: vi.fn(async (_argv: string[]) => undefined),
  runFfprobe: vi.fn(async (_argv: string[]) => "24/1\n10\n"),
  createWorkDir: vi.fn(async (name: string) => `/tmp/${name}`),
  cleanupWorkDir: vi.fn(async (_dir: string) => undefined),
}))

vi.mock("../ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-utils.js")>()),
  downloadFile: m.downloadFile,
  probeVideoSource: m.probeVideoSource,
  runFfmpeg: m.runFfmpeg,
  runFfprobe: m.runFfprobe,
  createWorkDir: m.createWorkDir,
  cleanupWorkDir: m.cleanupWorkDir,
}))

// The one clip reading both sides measure by (lib/video-utility-probe.ts), driven by the probe above.
vi.mock("../../../lib/video-utility-probe.js", () => ({
  probeClipLengthSec: async (src: string) => (await m.probeVideoSource(src)).durationSeconds,
  ClipUnreadableError: class ClipUnreadableError extends Error {},
}))

import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { videoUtilityChargeCheck } from "../../../lib/video-utility-charge-check.js"
import { trimVideo } from "../trim-video.js"
import { loopVideo } from "../loop-video.js"
import { combineVideos } from "../combine-videos.js"

const URL = "https://cdn.example/v.mp4"
const TRIM = { videoUrl: URL, trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 }

async function refusal(run: Promise<unknown>): Promise<Error> {
  const err = await run.then(() => undefined, (e: unknown) => e)
  if (!(err instanceof Error)) throw new Error("the render was not refused")
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
  m.probeVideoSource.mockResolvedValue({ width: 640, height: 360, durationSeconds: 10 })
})

describe("a job with no priced units", () => {
  it.each(["trim-video", "loop-video", "combine-videos"])("%s is refused before anything is downloaded", (jobName) => {
    let thrown: unknown
    try {
      videoUtilityChargeCheck(jobName, { videoUrl: URL, videoUrls: [URL, URL] })
    } catch (err) {
      thrown = err
    }
    expect(isDeterministicJobError(thrown)).toBe(true)
    expect((thrown as Error).message).toMatch(/^This run was not priced for its (video|clips) — run it again$/)
    expect(m.downloadFile).not.toHaveBeenCalled()
  })
})

describe("Trim Video re-measures the video it downloaded", () => {
  it("a video within the units charged (and the half-second slack) is cut", async () => {
    for (const sec of [10, 10.4, 10.6]) {
      m.probeVideoSource.mockResolvedValue({ width: 640, height: 360, durationSeconds: sec })
      const chargeCheck = videoUtilityChargeCheck("trim-video", { ...TRIM, billedUnits: 2, upstreamDuration: 10 })
      await expect(trimVideo({ videoUrl: URL, startTime: 0, trimStartSeconds: 0, trimEndSeconds: 0, chargeCheck })).resolves.toMatchObject({ videoPath: "/tmp/trim-video/output.mp4" })
    }
    expect(m.probeVideoSource).toHaveBeenCalledWith("/tmp/trim-video/input.mp4")
    expect(m.runFfmpeg).toHaveBeenCalledTimes(3)
  })

  it("a video that needs more units is refused before anything is cut — deterministic, so refunded with no retry", async () => {
    m.probeVideoSource.mockResolvedValue({ width: 640, height: 360, durationSeconds: 10.7 })
    const chargeCheck = videoUtilityChargeCheck("trim-video", { ...TRIM, billedUnits: 2, upstreamDuration: 10 })
    const err = await refusal(trimVideo({ videoUrl: URL, startTime: 0, trimStartSeconds: 0, trimEndSeconds: 0, chargeCheck }))
    expect(err.message).toBe("The video is 11 seconds, longer than the 10 seconds this run was priced for — run it again")
    expect(isDeterministicJobError(err)).toBe(true)
    expect(m.runFfprobe).not.toHaveBeenCalled()
    expect(m.runFfmpeg).not.toHaveBeenCalled()
    expect(m.cleanupWorkDir).toHaveBeenCalledWith("/tmp/trim-video")
  })

  it("a downloaded file that cannot be read is refused (deterministic); a probe that timed out stays retryable", async () => {
    m.probeVideoSource.mockRejectedValueOnce(new Error("probeVideoSource failed to parse"))
    const check = videoUtilityChargeCheck("trim-video", { ...TRIM, billedUnits: 2, upstreamDuration: 10 })
    const unreadable = await refusal(trimVideo({ videoUrl: URL, startTime: 0, chargeCheck: check }))
    expect(unreadable.message).toBe("Could not read the video. The file may be corrupted or an unsupported format.")
    expect(isDeterministicJobError(unreadable)).toBe(true)
    m.probeVideoSource.mockRejectedValueOnce(Object.assign(new Error("ffprobe timed out"), { timedOut: true }))
    const timedOut = await refusal(trimVideo({ videoUrl: URL, startTime: 0, chargeCheck: check }))
    expect(isDeterministicJobError(timedOut)).toBe(false)
  })

  it("a caller that passes no check (the Extend stitch, Edit Video Pro, the plugins) is never measured", async () => {
    await trimVideo({ videoUrl: URL, startTime: 0, endTime: 4 })
    expect(m.probeVideoSource).not.toHaveBeenCalled()
    expect(m.runFfmpeg).toHaveBeenCalledTimes(1)
  })
})

describe("Loop Video re-measures the video it downloaded", () => {
  it("a video that needs more units is refused before the repeat", async () => {
    m.probeVideoSource.mockResolvedValue({ width: 640, height: 360, durationSeconds: 12 })
    const chargeCheck = videoUtilityChargeCheck("loop-video", { videoUrl: URL, mode: "repeat", repeatCount: 2, billedUnits: 4, upstreamDuration: 10 })
    const err = await refusal(loopVideo({ videoUrl: URL, mode: "repeat", repeatCount: 2, chargeCheck }))
    expect(err.message).toBe("The video is 12 seconds, longer than the 10 seconds this run was priced for — run it again")
    expect(isDeterministicJobError(err)).toBe(true)
    expect(m.runFfmpeg).not.toHaveBeenCalled()
  })

  it("a video within its units is repeated", async () => {
    // The repeat writes its file list to disk: a real work dir.
    const dir = mkdtempSync(join(tmpdir(), "loop-video-"))
    m.createWorkDir.mockResolvedValueOnce(dir)
    const chargeCheck = videoUtilityChargeCheck("loop-video", { videoUrl: URL, mode: "repeat", repeatCount: 2, billedUnits: 4, upstreamDuration: 10 })
    await expect(loopVideo({ videoUrl: URL, mode: "repeat", repeatCount: 2, chargeCheck })).resolves.toMatchObject({ outputPath: join(dir, "output.mp4") })
    expect(m.probeVideoSource).toHaveBeenCalledWith(join(dir, "input.mp4"))
    expect(m.runFfmpeg).toHaveBeenCalledTimes(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it("a smart loop cut before the repeat downloads the video again, and that copy is checked too", async () => {
    // The loop's own download is within its price; the smart cut's (the one the loop repeats) has grown.
    m.probeVideoSource
      .mockResolvedValueOnce({ width: 640, height: 360, durationSeconds: 10 })
      .mockResolvedValueOnce({ width: 640, height: 360, durationSeconds: 20 })
    const job = { videoUrl: URL, mode: "repeat", repeatCount: 2, smartLoopCutBeforeRepeat: true, billedUnits: 5, upstreamDuration: 10 }
    const err = await refusal(loopVideo({ videoUrl: URL, mode: "repeat", repeatCount: 2, smartLoopCutBeforeRepeat: true, chargeCheck: videoUtilityChargeCheck("loop-video", job) }))
    expect(err.message).toBe("The video is 20 seconds, longer than the 10 seconds this run was priced for — run it again")
    expect(m.probeVideoSource).toHaveBeenNthCalledWith(1, "/tmp/loop-video/input.mp4")
    expect(m.probeVideoSource).toHaveBeenNthCalledWith(2, "/tmp/smart-loop-cut/input.mp4")
    expect(m.runFfmpeg).not.toHaveBeenCalled()
  })
})

describe("Combine Videos re-measures every clip it downloaded", () => {
  it("clips that need more units are refused before any is normalized, named by the clip that grew", async () => {
    m.probeVideoSource.mockImplementation(async (path: string) => ({ width: 640, height: 360, durationSeconds: path.endsWith("input_1.mp4") ? 16 : 10 }))
    const job = { videoUrls: [URL, URL], transition: "cut", transitionDuration: 0.5, trimStartFrames: 1, trimEndFrames: 2, billedUnits: 4, upstreamDurations: [10, 10] }
    const err = await refusal(combineVideos({
      videoUrls: [URL, URL], transition: "cut", transitionDuration: 0.5, audioMode: "crossfade", trimStartFrames: 1, trimEndFrames: 2,
      chargeCheck: videoUtilityChargeCheck("combine-videos", job),
    }))
    expect(err.message).toBe("Clip 2 of 2 is 16 seconds, longer than the 10 seconds this run was priced for — run it again")
    expect(isDeterministicJobError(err)).toBe(true)
    expect(m.downloadFile).toHaveBeenCalledTimes(2)
    expect(m.runFfprobe).not.toHaveBeenCalled()
    expect(m.runFfmpeg).not.toHaveBeenCalled()
  })
})
