import { describe, it, expect, vi, beforeEach } from "vitest"

// `execFile` is bound on the module-level `execFileAsync = promisify(execFile)`,
// so the mock must replace the binding BEFORE the module under test is imported.
// `vi.hoisted` lifts the mock vi.fn() to the same top-level slot as the
// `vi.mock` factory so the factory can reference it without "cannot access
// before initialization" hoisting errors.
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))
vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}))
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
  _resetAubioDetectionForTests,
  estimateBPM,
  parseSilenceDetectMarkers,
  pipelineExtractBeatGrid,
} from "../pipeline-extract-beat-grid.js"

beforeEach(() => {
  vi.clearAllMocks()
  _resetAubioDetectionForTests()
})

// `promisify(execFile)` calls the original with a node-style callback as the
// trailing arg. We translate that into the mock-returned shape (or reject)
// so tests can express `execFileMock.mockImplementation(...)` in promise-style.
function asNodeCallback(
  result: { stdout?: string; stderr?: string } | Error,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    const cb = args[args.length - 1] as
      | ((err: Error | null, value?: { stdout: string; stderr: string }) => void)
      | undefined
    if (typeof cb !== "function") return
    if (result instanceof Error) cb(result)
    else cb(null, { stdout: result.stdout ?? "", stderr: result.stderr ?? "" })
  }
}

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

describe("pipelineExtractBeatGrid (silencedetect fallback path)", () => {
  // These tests pin the behaviour when aubio is NOT available — every
  // `aubio --version` probe rejects, so the cached detect promise resolves
  // false and the silencedetect parse runs.
  beforeEach(() => {
    execFileMock.mockImplementation(asNodeCallback(new Error("ENOENT: aubio")))
  })

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

describe("pipelineExtractBeatGrid (aubio path)", () => {
  // When aubio is on PATH the detector returns onset markers from stdout
  // (one float per line). The silencedetect output on stderr is unused.
  it("uses aubio onset when available; ignores silencedetect markers", async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const [, argv] = args as [string, string[]]
      if (argv[0] === "--version") {
        return asNodeCallback({ stdout: "aubio 0.4.9\n" })(...args)
      }
      if (argv[0] === "onset") {
        return asNodeCallback({
          stdout: "0.123\n0.456\n0.789\n1.012\n",
        })(...args)
      }
      return asNodeCallback(new Error("unexpected argv"))(...args)
    })
    ;(runFfmpegCapture as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: "",
      // Silencedetect markers should be ignored when aubio succeeds.
      stderr: "[silencedetect @ 0x1] silence_start: 99.9\n",
    })

    const result = await pipelineExtractBeatGrid({
      musicUrl: "https://r2/music.mp3",
      targetDurationSec: 60,
    })

    expect(result.beatGridSeconds).toEqual([0.123, 0.456, 0.789, 1.012])
    // intervals ≈ 0.333, 0.333, 0.223 → median 0.333 → ~180 BPM
    expect(result.detectedBPM).toBe(180)
  })

  it("falls back to silencedetect when aubio probe succeeds but onset fails at run-time", async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const [, argv] = args as [string, string[]]
      if (argv[0] === "--version") {
        return asNodeCallback({ stdout: "aubio 0.4.9\n" })(...args)
      }
      if (argv[0] === "onset") {
        return asNodeCallback(new Error("aubio: unsupported codec"))(...args)
      }
      return asNodeCallback(new Error("unexpected argv"))(...args)
    })
    ;(runFfmpegCapture as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: "",
      stderr:
        "[silencedetect @ 0x1] silence_start: 2.0\n" +
        "[silencedetect @ 0x1] silence_start: 3.0\n",
    })

    const result = await pipelineExtractBeatGrid({
      musicUrl: "https://r2/music.mp3",
      targetDurationSec: 60,
    })

    expect(result.beatGridSeconds).toEqual([2.0, 3.0])
    expect(result.detectedBPM).toBe(60)
  })

  it("aubio onset parses empty + malformed lines", async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const [, argv] = args as [string, string[]]
      if (argv[0] === "--version") {
        return asNodeCallback({ stdout: "aubio 0.4.9\n" })(...args)
      }
      if (argv[0] === "onset") {
        // Mixed: blank lines, NaN, valid floats, trailing whitespace.
        return asNodeCallback({
          stdout: "\n0.5\n\nfoo\n   1.0   \n2.0\n",
        })(...args)
      }
      return asNodeCallback(new Error("unexpected argv"))(...args)
    })
    ;(runFfmpegCapture as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: "",
      stderr: "",
    })

    const result = await pipelineExtractBeatGrid({
      musicUrl: "https://r2/music.mp3",
      targetDurationSec: 60,
    })

    expect(result.beatGridSeconds).toEqual([0.5, 1.0, 2.0])
  })
})
