/**
 * Silence Detect's pass with ffmpeg stubbed: which spans each list keeps, what
 * reaches `d=`, and which failed passes are never read as whole. The real
 * ffmpeg pass is silence-detect.e2e.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const ff = vi.hoisted(() => ({
  runFfmpegCapture: vi.fn(),
  probeMediaDuration: vi.fn(),
}))
vi.mock("../../video/ffmpeg-utils.js", () => ({
  runFfmpegCapture: ff.runFfmpegCapture,
  probeMediaDuration: ff.probeMediaDuration,
  createWorkDir: vi.fn(),
  cleanupWorkDir: vi.fn(),
  downloadFile: vi.fn(),
}))
vi.mock("../../../services/media-proxy.js", () => ({ ensureMediaProxy: vi.fn() }))

import { ALL_RANGES_MIN_FLOOR_MS, runSilenceDetectOnFile } from "../silence-detect.js"

const STDERR = [
  // 349.94 ms: 5,599 samples at 16 kHz, one sample short of 350 ms.
  "[silencedetect @ 0x1] silence_start: 1.000000",
  "[silencedetect @ 0x1] silence_end: 1.349938 | silence_duration: 0.349938",
  // Exactly 350 ms.
  "[silencedetect @ 0x1] silence_start: 2.000000",
  "[silencedetect @ 0x1] silence_end: 2.350000 | silence_duration: 0.350000",
  // 80 ms.
  "[silencedetect @ 0x1] silence_start: 3.000000",
  "[silencedetect @ 0x1] silence_end: 3.080000 | silence_duration: 0.080000",
].join("\n")

const SETTINGS = { thresholdDb: -35, minSilenceMs: 350, padMs: 110 }

beforeEach(() => {
  vi.clearAllMocks()
  ff.runFfmpegCapture.mockResolvedValue({ stdout: "", stderr: STDERR })
  ff.probeMediaDuration.mockResolvedValue(6)
})

describe("one pass, two lists", () => {
  it("cuts by the measured length: a span one sample short of the minimum is not a pause, though its edges round to 350 ms", async () => {
    const r = await runSilenceDetectOnFile("/tmp/x.m4a", { ...SETTINGS, allRangesMinMs: 50 })
    expect(r.ranges).toEqual([{ startMs: 2110, endMs: 2240 }])
    expect(r.allRanges).toEqual([
      { startMs: 1000, endMs: 1350 },
      { startMs: 2000, endMs: 2350 },
      { startMs: 3000, endMs: 3080 },
    ])
  })

  it("runs ffmpeg once, at the shorter of the two minimums", async () => {
    await runSilenceDetectOnFile("/tmp/x.m4a", { ...SETTINGS, allRangesMinMs: 50 })
    expect(ff.runFfmpegCapture).toHaveBeenCalledTimes(1)
    expect(ff.runFfmpegCapture.mock.calls[0]![0]).toContain("silencedetect=noise=-35dB:d=0.05")
  })

  it("without allRangesMinMs: the pass and the result are the ones they always were", async () => {
    ff.runFfmpegCapture.mockResolvedValue({ stdout: "", stderr: "silence_start: 2.0\nsilence_end: 2.35 | silence_duration: 0.35" })
    const r = await runSilenceDetectOnFile("/tmp/x.m4a", SETTINGS)
    expect(ff.runFfmpegCapture.mock.calls[0]![0]).toContain("silencedetect=noise=-35dB:d=0.35")
    expect(r).toEqual({ version: 1, ranges: [{ startMs: 2110, endMs: 2240 }], durationMs: 6000 })
  })
})

describe("allRangesMinMs — read only as a number", () => {
  it.each([
    [true, false], [[50], false], [[], false], ["abc", false], [null, false],
    ["50", true], [50, true],
  ])("%j asks for the list: %s", async (value, asks) => {
    const r = await runSilenceDetectOnFile("/tmp/x.m4a", { ...SETTINGS, allRangesMinMs: value as never })
    expect("allRanges" in r).toBe(asks)
  })

  it(`never below ${ALL_RANGES_MIN_FLOOR_MS} ms (a workflow's JSON can carry less; the route refuses it)`, async () => {
    await runSilenceDetectOnFile("/tmp/x.m4a", { ...SETTINGS, allRangesMinMs: 1 })
    expect(ff.runFfmpegCapture.mock.calls[0]![0]).toContain(`silencedetect=noise=-35dB:d=${ALL_RANGES_MIN_FLOOR_MS / 1000}`)
  })
})

describe("a failed pass is read only when ffmpeg ran to the end", () => {
  const failed = (flags: Record<string, unknown>) => Object.assign(new Error("ffmpeg exited"), { stderr: "silence_start: 4.0", ...flags })

  it("a non-zero exit with its markers is read (the `-f null -` fallback)", async () => {
    ff.runFfmpegCapture.mockRejectedValue(failed({ killed: false, timedOut: false }))
    await expect(runSilenceDetectOnFile("/tmp/x.m4a", SETTINGS)).resolves.toMatchObject({ ranges: [{ startMs: 4110, endMs: 5890 }] })
  })

  it.each([["truncated", { truncated: true }], ["killed", { killed: true }], ["timed out", { killed: true, timedOut: true }]])(
    "a %s pass throws: its open silence would run to the end of the file",
    async (_name, flags) => {
      ff.runFfmpegCapture.mockRejectedValue(failed(flags))
      await expect(runSilenceDetectOnFile("/tmp/x.m4a", SETTINGS)).rejects.toThrow("ffmpeg exited")
    },
  )
})
