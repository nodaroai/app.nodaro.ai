/**
 * Progress-callback coverage for `assembleNarratedVideo` /
 * `assembleNarratedVideoFromLocalFiles` (per-block progress reporting,
 * feature: narrated-video-assembler follow-up).
 *
 * Regression target: `handleAssembleNarratedVideo` previously jumped 0% ->
 * 80% only after the ENTIRE assembly, so a many-block job (e.g. 60 blocks)
 * sat at 0% for minutes. `onProgress` now fires once per completed block
 * (`(i + 1) / blocks.length`) plus one small tick after downloads finish, so
 * the worker can walk progress incrementally (5 -> 75) during assembly.
 *
 * ffmpeg-utils.js, combine-videos.js and node:fs are fully mocked — no real
 * ffmpeg or filesystem I/O runs; only the fit/normalize/concat control flow
 * and the `onProgress` call sequence are exercised (mirrors the mocked-utils
 * style used in combine-videos.test.ts / merge-video-audio.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn().mockResolvedValue(undefined),
  runFfmpeg: vi.fn().mockResolvedValue(""),
  createWorkDir: vi.fn().mockResolvedValue("/tmp/anv-progress-test"),
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
  getVideoDuration: vi.fn().mockResolvedValue(5),
  probeMediaDuration: vi.fn().mockResolvedValue(5),
  hasAudioStream: vi.fn().mockResolvedValue(false),
  normalizeVideoForCombine: vi.fn(async (_i: string, out: string) => out),
  trimEdgeFrames: vi.fn(async (input: string) => input),
  pickTargetResolution: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
  fsWriteFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../ffmpeg-utils.js", () => ({
  downloadFile: mocks.downloadFile,
  runFfmpeg: mocks.runFfmpeg,
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
  getVideoDuration: mocks.getVideoDuration,
  probeMediaDuration: mocks.probeMediaDuration,
  hasAudioStream: mocks.hasAudioStream,
  normalizeVideoForCombine: mocks.normalizeVideoForCombine,
  trimEdgeFrames: mocks.trimEdgeFrames,
}))

vi.mock("../combine-videos.js", () => ({
  pickTargetResolution: mocks.pickTargetResolution,
}))

vi.mock("node:fs", () => ({
  promises: { writeFile: mocks.fsWriteFile },
}))

import { assembleNarratedVideo, assembleNarratedVideoFromLocalFiles } from "../assemble-narrated-video.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.downloadFile.mockResolvedValue(undefined)
  mocks.runFfmpeg.mockResolvedValue("")
  mocks.createWorkDir.mockResolvedValue("/tmp/anv-progress-test")
  mocks.cleanupWorkDir.mockResolvedValue(undefined)
  mocks.getVideoDuration.mockResolvedValue(5)
  mocks.probeMediaDuration.mockResolvedValue(5)
  mocks.hasAudioStream.mockResolvedValue(false)
  mocks.normalizeVideoForCombine.mockImplementation(async (_i: string, out: string) => out)
  mocks.trimEdgeFrames.mockImplementation(async (input: string) => input)
  mocks.pickTargetResolution.mockResolvedValue({ width: 1920, height: 1080 })
  mocks.fsWriteFile.mockResolvedValue(undefined)
})

function localBlocks(n: number) {
  return Array.from({ length: n }, (_, i) => ({ videoPath: `/tmp/clip-${i}.mp4`, voicePath: null }))
}

function urlBlocks(n: number) {
  return Array.from({ length: n }, (_, i) => ({ videoUrl: `https://r2/clip-${i}.mp4` }))
}

describe("assembleNarratedVideoFromLocalFiles — per-block onProgress", () => {
  it("fires (i+1)/3 exactly once per completed block, in order, for 3 blocks", async () => {
    const calls: number[] = []
    await assembleNarratedVideoFromLocalFiles({
      blocks: localBlocks(3),
      onProgress: (f) => calls.push(f),
    })

    expect(calls).toEqual([1 / 3, 2 / 3, 1])
  })

  it("is monotonically non-decreasing", async () => {
    const calls: number[] = []
    await assembleNarratedVideoFromLocalFiles({
      blocks: localBlocks(5),
      onProgress: (f) => calls.push(f),
    })

    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1])
    }
    expect(calls[calls.length - 1]).toBe(1)
  })

  it("a throwing onProgress callback does not fail the run", async () => {
    const outputPath = await assembleNarratedVideoFromLocalFiles({
      blocks: localBlocks(3),
      onProgress: () => {
        throw new Error("callback boom")
      },
    })

    expect(outputPath).toBe("/tmp/anv-progress-test/assembled.mp4")
  })

  it("never invokes onProgress when omitted (no-op, no throw)", async () => {
    await expect(assembleNarratedVideoFromLocalFiles({ blocks: localBlocks(2) })).resolves.toBeTruthy()
  })
})

describe("assembleNarratedVideo — download tick + per-block onProgress", () => {
  it("fires a download tick before the block ticks, then (i+1)/3 per block, all monotonic non-decreasing", async () => {
    const calls: number[] = []
    await assembleNarratedVideo({
      blocks: urlBlocks(3),
      onProgress: (f) => calls.push(f),
    })

    // Download tick + 3 block ticks.
    expect(calls).toHaveLength(4)
    const [downloadTick, ...blockTicks] = calls
    expect(blockTicks).toEqual([1 / 3, 2 / 3, 1])
    expect(downloadTick).toBeLessThan(blockTicks[0])
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1])
    }
  })

  it("stays monotonic non-decreasing on a many-block job (60 blocks) — the reported UX regression", async () => {
    const calls: number[] = []
    await assembleNarratedVideo({
      blocks: urlBlocks(60),
      onProgress: (f) => calls.push(f),
    })

    expect(calls).toHaveLength(61)
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1])
    }
    expect(calls[0]).toBeLessThan(1 / 60)
    expect(calls[calls.length - 1]).toBe(1)
  })

  it("a throwing onProgress callback does not fail the run", async () => {
    const outputPath = await assembleNarratedVideo({
      blocks: urlBlocks(3),
      onProgress: () => {
        throw new Error("callback boom")
      },
    })

    expect(outputPath).toBe("/tmp/anv-progress-test/assembled.mp4")
  })
})
