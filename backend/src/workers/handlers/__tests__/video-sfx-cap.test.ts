/**
 * Video SFX cuts the FILE it sends to the 300-second cap, not only the length
 * it asks the model to score: a clip a hair past the cap (accepted at the top
 * row) is cut to its first 300 seconds, its streams copied, and re-hosted in
 * the job's scratch folder. Any other run sends its link as it is.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  probeClipLengthSec: vi.fn(async (_src: string, _opts?: unknown) => 300.03),
  downloadFile: vi.fn(async (_url: string, _dest: string, _opts?: unknown) => {}),
  runFfmpeg: vi.fn(async (_args: string[]) => ""),
  createWorkDir: vi.fn(async (_prefix: string) => "/tmp/video-sfx-cap-test"),
  cleanupWorkDir: vi.fn(async (_dir: string) => {}),
  uploadJobScratchFile: vi.fn(async (_path: string, _name: string, ext: string) => `https://cdn.example.com/jobs/scratch/cut.${ext}`),
}))
vi.mock("../../../lib/video-utility-probe.js", () => ({ probeClipLengthSec: m.probeClipLengthSec }))
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({
  BIG_MEDIA_DOWNLOAD_LIMITS: { big: true },
  downloadFile: m.downloadFile,
  runFfmpeg: m.runFfmpeg,
  createWorkDir: m.createWorkDir,
  cleanupWorkDir: m.cleanupWorkDir,
}))
vi.mock("../../../lib/job-scratch.js", () => ({ uploadJobScratchFile: m.uploadJobScratchFile }))

import { capVideoSfxSource } from "../video-sfx-cap.js"

const URL = "https://cdn.example.com/u/clip.webm"

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("capVideoSfxSource", () => {
  it("a run asked for less than the cap sends its link as it is, unmeasured", async () => {
    expect(await capVideoSfxSource(URL, 299, "job-1")).toBe(URL)
    expect(await capVideoSfxSource(URL, Number.NaN, "job-1")).toBe(URL)
    expect(m.probeClipLengthSec).not.toHaveBeenCalled()
  })

  it("a run at the cap whose file is within it sends its link as it is", async () => {
    m.probeClipLengthSec.mockResolvedValueOnce(300)
    expect(await capVideoSfxSource(URL, 300, "job-1")).toBe(URL)
    expect(m.downloadFile).not.toHaveBeenCalled()
  })

  it("a file a hair past the cap is cut to its first 300 seconds, streams copied, in its own container, and that cut is sent", async () => {
    const sent = await capVideoSfxSource(URL, 300, "job-1")
    expect(sent).toBe("https://cdn.example.com/jobs/scratch/cut.webm")
    // Measured as the charge measured it: the container.
    expect(m.probeClipLengthSec).toHaveBeenCalledWith(URL, expect.objectContaining({ reading: "container" }))
    // Downloaded under the big-media limits (a 5-minute clip can be gigabytes).
    expect(m.downloadFile).toHaveBeenCalledWith(URL, expect.stringMatching(/in\.webm$/), { limits: { big: true } })
    const args = m.runFfmpeg.mock.calls[0]![0]
    expect(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2)).toEqual(["-t", "300"])
    expect(args).toContain("copy")
    expect(args.at(-1)).toMatch(/out\.webm$/)
    expect(m.uploadJobScratchFile).toHaveBeenCalledWith(expect.stringMatching(/out\.webm$/), "video-sfx-cap", "webm", "video/webm", "job-1")
    expect(m.cleanupWorkDir).toHaveBeenCalledTimes(1)
  })

  it("a cut that fails sends the original link (best-effort), its work folder cleaned", async () => {
    m.runFfmpeg.mockRejectedValueOnce(new Error("ffmpeg failed"))
    expect(await capVideoSfxSource(URL, 300, "job-1")).toBe(URL)
    expect(m.cleanupWorkDir).toHaveBeenCalledTimes(1)
    m.probeClipLengthSec.mockRejectedValueOnce(new Error("probe failed"))
    expect(await capVideoSfxSource(URL, 300, "job-1")).toBe(URL)
  })
})
