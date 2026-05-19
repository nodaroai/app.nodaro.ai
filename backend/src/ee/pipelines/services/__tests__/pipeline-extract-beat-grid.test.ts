import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../../../providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
  createWorkDir: vi.fn().mockResolvedValue("/tmp/work-1"),
  downloadFile: vi.fn().mockResolvedValue(undefined),
  getVideoDuration: vi.fn().mockResolvedValue(60),
  runFfmpeg: vi.fn().mockResolvedValue(""),
  runFfmpegCapture: vi.fn(),
}))
vi.mock("../../../../lib/storage.js", () => ({
  uploadBufferToR2: vi.fn().mockResolvedValue("https://r2/trimmed.mp3"),
}))
vi.mock("node:fs", () => ({
  promises: { readFile: vi.fn().mockResolvedValue(Buffer.from("fake audio")) },
}))

import { runFfmpegCapture } from "../../../../providers/video/ffmpeg-utils.js"
import {
  estimateBPM,
  parseSilenceDetectMarkers,
  pipelineExtractBeatGrid,
} from "../pipeline-extract-beat-grid.js"

beforeEach(() => vi.clearAllMocks())

describe("parseSilenceDetectMarkers", () => {
  it("parses silence_start markers from stderr", () => {
    const stderr = `
      [silencedetect @ 0x55b6e8] silence_start: 0.5
      [silencedetect @ 0x55b6e8] silence_end: 0.6
      [silencedetect @ 0x55b6e8] silence_start: 2.1
      [silencedetect @ 0x55b6e8] silence_end: 2.2
      [silencedetect @ 0x55b6e8] silence_start: 4.0
    `
    expect(parseSilenceDetectMarkers(stderr)).toEqual([0.5, 2.1, 4.0])
  })

  it("returns empty when stderr has no markers", () => {
    expect(parseSilenceDetectMarkers("frame=10 fps=24")).toEqual([])
  })
})

describe("estimateBPM", () => {
  it("returns 0 for fewer than 2 onsets", () => {
    expect(estimateBPM([])).toBe(0)
    expect(estimateBPM([1.0])).toBe(0)
  })

  it("computes BPM from median inter-onset interval", () => {
    // intervals of 0.5s → 60/0.5 = 120 BPM
    expect(estimateBPM([0.5, 1.0, 1.5, 2.0])).toBe(120)
    // intervals of 1.0s → 60/1.0 = 60 BPM
    expect(estimateBPM([0.0, 1.0, 2.0, 3.0])).toBe(60)
  })

  it("uses median to ignore outliers", () => {
    // intervals: 0.5, 0.5, 0.5, 5.0 → median 0.5 → 120 BPM
    expect(estimateBPM([0, 0.5, 1.0, 1.5, 6.5])).toBe(120)
  })
})

describe("pipelineExtractBeatGrid", () => {
  it("returns trimmed URL + beat grid on happy path", async () => {
    ;(runFfmpegCapture as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: "",
      stderr:
        "[silencedetect @ 0x1] silence_start: 0.5\n" +
        "[silencedetect @ 0x1] silence_start: 1.0\n" +
        "[silencedetect @ 0x1] silence_start: 1.5\n",
    })

    const result = await pipelineExtractBeatGrid({
      musicUrl: "https://r2/music.mp3",
      targetDurationSec: 60,
    })

    expect(result.trimmedAssetUrl).toBe("https://r2/trimmed.mp3")
    expect(result.beatGridSeconds).toEqual([0.5, 1.0, 1.5])
    // intervals: 0.5, 0.5 → median 0.5 → 120 BPM
    expect(result.detectedBPM).toBe(120)
  })

  it("returns empty grid when silencedetect throws WITHOUT stderr payload", async () => {
    // Plain Error — no `.stderr` attached. Caller falls through to console.warn
    // and surfaces an empty grid.
    ;(runFfmpegCapture as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("silencedetect crashed"),
    )

    const result = await pipelineExtractBeatGrid({
      musicUrl: "https://r2/music.mp3",
      targetDurationSec: 60,
    })

    expect(result.beatGridSeconds).toEqual([])
    expect(result.detectedBPM).toBe(0)
    expect(result.trimmedAssetUrl).toBe("https://r2/trimmed.mp3")
  })

  it("recovers markers from stderr-bearing errors (FFmpeg non-zero exit but valid output)", async () => {
    // Some FFmpeg builds exit non-zero on `-f null -` but still emit valid
    // silencedetect lines on stderr. The wrapper parses them anyway.
    const err = Object.assign(new Error("exit 1"), {
      stdout: "",
      stderr:
        "[silencedetect @ 0x1] silence_start: 1.0\n" +
        "[silencedetect @ 0x1] silence_start: 2.0\n",
    })
    ;(runFfmpegCapture as ReturnType<typeof vi.fn>).mockRejectedValue(err)

    const result = await pipelineExtractBeatGrid({
      musicUrl: "https://r2/music.mp3",
      targetDurationSec: 60,
    })

    expect(result.beatGridSeconds).toEqual([1.0, 2.0])
    expect(result.detectedBPM).toBe(60)
  })
})
