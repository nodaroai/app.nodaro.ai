import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A reference video too large for the provider is shrunk, its shape kept
 * (`../reference-video-size.ts`). Kling 4 accepts the task and fails it later
 * with a bare "Generation failed" on a 2568×1080 clip; 2048×862 and 1920×1080
 * render, so a clip is kept inside both.
 */

const mocks = vi.hoisted(() => ({
  probeVideoSource: vi.fn(),
  downloadFile: vi.fn(),
  runFfmpeg: vi.fn(),
  cleanupWorkDir: vi.fn(),
  uploadJobScratchFile: vi.fn(),
}))

vi.mock("../../video/ffmpeg-utils.js", () => ({
  probeVideoSource: mocks.probeVideoSource,
  downloadFile: mocks.downloadFile,
  runFfmpeg: mocks.runFfmpeg,
  createWorkDir: vi.fn(async () => "/tmp/work"),
  cleanupWorkDir: mocks.cleanupWorkDir,
}))
vi.mock("../../../lib/job-scratch.js", () => ({ uploadJobScratchFile: mocks.uploadJobScratchFile }))
vi.mock("../client.js", () => ({
  createSanitizedError: (msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`),
}))

import { ensureVideoFitsSize, fitVideoSize, shrinkVideoArgs, KLING_4_REF_VIDEO_LIMIT } from "../reference-video-size.js"

const URL_IN = "https://cdn.nodaro.ai/tmp/provider-input/x/preview.mp4"
const LIMIT = KLING_4_REF_VIDEO_LIMIT

beforeEach(() => {
  vi.clearAllMocks()
  mocks.uploadJobScratchFile.mockResolvedValue("https://cdn.nodaro.ai/tmp/provider-input/job/provider-shrunk-1.mp4")
})

describe("Kling 4's limit", () => {
  it("is the two sizes measured to render: a 2048 px long side and 1920×1080's pixels", () => {
    expect(LIMIT).toEqual({ maxDimension: 2048, maxPixels: 1920 * 1080 })
  })
})

describe("fitVideoSize", () => {
  it("leaves the sizes that rendered alone", () => {
    expect(fitVideoSize(1920, 1080, LIMIT)).toBeNull()
    expect(fitVideoSize(2048, 862, LIMIT)).toBeNull()
    expect(fitVideoSize(1080, 1920, LIMIT)).toBeNull()
    expect(fitVideoSize(1280, 720, LIMIT)).toBeNull()
  })

  it("brings the failing 2568×1080 clip to a 2048 px long side, shape kept", () => {
    expect(fitVideoSize(2568, 1080, LIMIT)).toEqual({ long: 2048, short: 860 })
    expect(fitVideoSize(1080, 2568, LIMIT)).toEqual({ long: 2048, short: 860 })
  })

  it("brings 4K and 1440p 16:9 clips to 1920×1080 (the pixel bound), never an untested 2048×1152", () => {
    expect(fitVideoSize(3840, 2160, LIMIT)).toEqual({ long: 1920, short: 1080 })
    expect(fitVideoSize(2560, 1440, LIMIT)).toEqual({ long: 1920, short: 1080 })
    expect(fitVideoSize(2048, 1152, LIMIT)).toEqual({ long: 1920, short: 1080 })
  })

  it("every result fits both bounds and has even sides", () => {
    for (const [w, h] of [[2568, 1080], [3840, 2160], [4096, 2160], [2161, 1215], [7680, 4320], [2049, 2049], [3001, 999]]) {
      const size = fitVideoSize(w, h, LIMIT)!
      expect(size.long).toBeLessThanOrEqual(LIMIT.maxDimension)
      expect(size.long * size.short).toBeLessThanOrEqual(LIMIT.maxPixels)
      expect(size.long % 2).toBe(0)
      expect(size.short % 2).toBe(0)
    }
  })
})

describe("shrinkVideoArgs", () => {
  it("puts the long side on the displayed frame's longer way, keeps only picture + first sound, drops chapters and metadata", () => {
    const args = shrinkVideoArgs("/in", "/out.mp4", { long: 2048, short: 860 })
    expect(args[args.indexOf("-vf") + 1]).toBe("scale='if(gte(iw,ih),2048,860)':'if(gte(iw,ih),860,2048)':flags=lanczos,setsar=1")
    expect(args).toEqual(expect.arrayContaining(["-map", "0:v:0", "-map", "0:a:0?", "-map_chapters", "-1", "-map_metadata", "-1"]))
    expect(args.at(-1)).toBe("/out.mp4")
  })
})

describe("ensureVideoFitsSize", () => {
  it("passes a clip within the limit on untouched, without downloading it", async () => {
    mocks.probeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 4 })
    await expect(ensureVideoFitsSize(URL_IN, LIMIT, "Video generation", "t")).resolves.toBe(URL_IN)
    expect(mocks.downloadFile).not.toHaveBeenCalled()
    expect(mocks.runFfmpeg).not.toHaveBeenCalled()
  })

  it("shrinks an over-size clip into the job's scratch folder and returns that copy", async () => {
    mocks.probeVideoSource.mockResolvedValue({ width: 2568, height: 1080, durationSeconds: 4 })
    const out = await ensureVideoFitsSize(URL_IN, LIMIT, "Video generation", "t")
    expect(out).toBe("https://cdn.nodaro.ai/tmp/provider-input/job/provider-shrunk-1.mp4")
    expect(mocks.downloadFile).toHaveBeenCalledWith(URL_IN, "/tmp/work/input")
    expect(mocks.runFfmpeg).toHaveBeenCalledWith(shrinkVideoArgs("/tmp/work/input", "/tmp/work/shrunk.mp4", { long: 2048, short: 860 }))
    expect(mocks.uploadJobScratchFile).toHaveBeenCalledWith("/tmp/work/shrunk.mp4", "provider-shrunk", "mp4", "video/mp4")
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/work")
  })

  it("sends a clip it cannot probe as is (the provider answers, as before)", async () => {
    mocks.probeVideoSource.mockRejectedValue(new Error("probeVideoSource failed to parse"))
    await expect(ensureVideoFitsSize(URL_IN, LIMIT, "Video generation", "t")).resolves.toBe(URL_IN)
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })

  it("fails the run with a sanitized error when the shrink itself fails, and still cleans up", async () => {
    mocks.probeVideoSource.mockResolvedValue({ width: 4096, height: 2160, durationSeconds: 4 })
    mocks.runFfmpeg.mockRejectedValue(new Error("ffmpeg exited 1"))
    await expect(ensureVideoFitsSize(URL_IN, LIMIT, "Video generation", "t"))
      .rejects.toThrow("[Video generation] Could not prepare the reference video (4096×2160) for this model")
    expect(mocks.uploadJobScratchFile).not.toHaveBeenCalled()
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/work")
  })
})
