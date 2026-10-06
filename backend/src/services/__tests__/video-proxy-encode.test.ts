import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  runFfmpeg: vi.fn().mockResolvedValue(""),
  runFfprobe: vi.fn(),
  probeVideoFramePtsMs: vi.fn(),
}))
vi.mock("../../providers/video/ffmpeg-threads.js", () => ({
  ffmpegEffectiveThreads: vi.fn(() => ({ decode: 2, filter: 2, encode: 2 })),
}))
vi.mock("node:fs", async (orig) => {
  const real = await orig<typeof import("node:fs")>()
  return { ...real, promises: { ...real.promises, writeFile: vi.fn().mockResolvedValue(undefined) } }
})

import { probeVideoFramePtsMs, runFfmpeg, runFfprobe } from "../../providers/video/ffmpeg-utils.js"
import { audioPeakMemoryMiB, canvasPeakMemoryMiB } from "../../providers/video/ffmpeg-memory-model.js"
import { encodeVideoProxy } from "../video-proxy-encode.js"

const THREADS = { decode: 2, filter: 2, encode: 2 }

/** ffprobe answers: a 4K source; each segment writes `counts[i]` frames at 2 fps. */
function probeAnswers(counts: readonly number[]) {
  const pts = (n: number) => Array.from({ length: n }, (_, k) => k * 500)
  vi.mocked(runFfprobe).mockImplementation(async (args) => {
    const file = args[args.length - 1]
    if (file.endsWith("source")) {
      return JSON.stringify({ streams: [{ width: 3840, height: 2160 }] })
    }
    if (args.includes("packet=pts_time")) throw new Error("frame times must be streamed, not read through runFfprobe's buffer")
    return JSON.stringify({ streams: [{ width: 960, height: 540 }] })
  })
  vi.mocked(probeVideoFramePtsMs).mockImplementation(async (file) => {
    const seg = /seg-(\d+)\.mp4$/.exec(file)
    if (seg) return pts(counts[Number(seg[1])])
    return pts(counts.reduce((a, b) => a + b, 0))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("encodeVideoProxy — every ffmpeg goes through the admitted, thread-placed launcher", () => {
  it("each span encode reserves the SOURCE canvas's predicted peak (the decode dominates), the join reserves the fixed term", async () => {
    probeAnswers([7, 10])
    await encodeVideoProxy("/w/source", "/w", { fps: 2, height: 540, spans: [{ startMs: 0, endMs: 3300 }, { startMs: 10_300, endMs: 14_900 }] })
    const calls = vi.mocked(runFfmpeg).mock.calls
    expect(calls).toHaveLength(3) // two span encodes + one join
    const encodePeak = canvasPeakMemoryMiB({ width: 3840, height: 2160 }, 1, THREADS)
    expect(calls[0][2]).toEqual({ peakMemoryMiB: encodePeak })
    expect(calls[1][2]).toEqual({ peakMemoryMiB: encodePeak })
    expect(calls[2][2]).toEqual({ peakMemoryMiB: audioPeakMemoryMiB() })
    // the launcher places the CPU-quota thread counts; an argv that names its own is left alone, so none may
    for (const [argv] of calls) expect(argv.some((a) => /threads/.test(a))).toBe(false)
  })

  it("seeks each span on the input side and samples on a grid anchored at the span's start, showing what is on screen", async () => {
    probeAnswers([7, 10])
    await encodeVideoProxy("/w/source", "/w", { fps: 2, height: 540, spans: [{ startMs: 0, endMs: 3300 }, { startMs: 10_300, endMs: 14_900 }] })
    const argv = vi.mocked(runFfmpeg).mock.calls[1][0]
    expect(argv.slice(argv.indexOf("-ss"), argv.indexOf("-i") + 2)).toEqual(["-ss", "10.300", "-t", "4.600", "-i", "/w/source"])
    const vf = argv[argv.indexOf("-vf") + 1]
    // No `start_time`: it back-fills the samples before the first decoded frame
    // with that later picture. The grid is anchored by ffmpeg rebasing to `-ss`.
    expect(vf).not.toContain("start_time")
    // `trim` clips the OUTPUT to the span (input `-t` only bounds the read; the
    // fps filter holds a last frame across a VFR hole). Half-open: drops `end`.
    expect(vf.startsWith("fps=fps=2:round=up,trim=end=4.600,")).toBe(true)
    expect(vf).toContain("setsar=1")
    expect(argv).toContain("-an")
  })

  it("the whole source when no spans are given: no cut, read to the picture's real end (never the container's claimed length)", async () => {
    probeAnswers([120])
    const r = await encodeVideoProxy("/w/source", "/w", { fps: 2, height: 540 })
    const argv = vi.mocked(runFfmpeg).mock.calls[0][0]
    expect(argv).not.toContain("-ss")
    expect(argv).not.toContain("-t")
    expect(argv.slice(0, 3)).toEqual(["-y", "-i", "/w/source"])
    expect(argv[argv.indexOf("-vf") + 1]).not.toContain("trim")
    expect(r.spanMap).toEqual([{ proxyStartMs: 0, proxyEndMs: 60_000, sourceStartMs: 0, firstFrame: 0, frameCount: 120 }])
    const probe = vi.mocked(runFfprobe).mock.calls[0][0]
    expect(probe.join(" ")).not.toContain("duration")
  })

  it("a segment that wrote no frames is left out of the join and of the map", async () => {
    probeAnswers([4, 0, 2])
    const r = await encodeVideoProxy("/w/source", "/w", {
      fps: 2, height: 540, spans: [{ startMs: 0, endMs: 2000 }, { startMs: 20_000, endMs: 20_100 }, { startMs: 30_000, endMs: 31_000 }],
    })
    expect(r.spanMap.map((row) => row.sourceStartMs)).toEqual([0, 30_000])
    expect(r.frameCount).toBe(6)
  })
})
