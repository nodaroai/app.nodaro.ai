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
  return {
    ...real,
    // The scene-score file each span encode writes (scdet's per-frame scores), read as a stream.
    createReadStream: vi.fn(),
    promises: { ...real.promises, writeFile: vi.fn().mockResolvedValue(undefined) },
  }
})

import { probeVideoFramePtsMs, runFfmpeg, runFfprobe } from "../../providers/video/ffmpeg-utils.js"
import { audioPeakMemoryMiB, canvasPeakMemoryMiB } from "../../providers/video/ffmpeg-memory-model.js"
import { MEDIA_PROXY_FFMPEG_TIMEOUT_MS, proxySpanEncodeTimeoutMs, proxySpanProbeTimeoutMs } from "../../providers/video/ffmpeg-timeouts.js"
import { encodeVideoProxy } from "../video-proxy-encode.js"
import { createReadStream } from "node:fs"
import { Readable } from "node:stream"

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
  scoreFiles({}, "") // an empty score file (no frame decoded) unless a test says otherwise
})

/** What scdet + `metadata=print` leaves for a segment: 25 fps of quiet frames
 *  for `seconds`, with an isolated spike (a hard cut) on each listed frame. */
function printed(seconds: number, cutFrames: readonly number[] = []): string {
  let out = ""
  for (let k = 0; k < seconds * 25; k++) {
    const cut = cutFrames.includes(k)
    out += `frame:${k}    pts:${k * 40}  pts_time:${k / 25}\nlavfi.scd.mafd=${cut ? 20 : 0.4}\nlavfi.scd.score=${cut ? 19 : k === 0 ? 0 : 0.3}\n`
  }
  return out
}

/** Serve each scene-score file's text by path; an unknown path is a test bug. */
function scoreFiles(byPath: Record<string, string>, fallback?: string) {
  vi.mocked(createReadStream).mockImplementation(((file: string) => {
    const text = byPath[String(file)] ?? fallback
    if (text === undefined) throw new Error(`unexpected read ${String(file)}`)
    return Readable.from(text.split("\n").map((l) => `${l}\n`)) as never
  }) as never)
}

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
    // Scene detection runs first, on every DECODED frame (P3.2b): at 2 fps a
    // cut is indistinguishable from a face jump.
    expect(vf.startsWith("scdet=threshold=100,metadata=mode=print:file=/w/cuts-0001.txt,fps=fps=2:round=up,trim=end=4.600,")).toBe(true)
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

  it("each span's encode and its frame-time probe run at the span's own ceiling; the join keeps the whole-proxy ceiling", async () => {
    probeAnswers([7, 10])
    await encodeVideoProxy("/w/source", "/w", { fps: 2, height: 540, spans: [{ startMs: 0, endMs: 3300 }, { startMs: 10_300, endMs: 14_900 }] })
    const calls = vi.mocked(runFfmpeg).mock.calls
    expect(calls[0][1]).toBe(proxySpanEncodeTimeoutMs(3300))
    expect(calls[1][1]).toBe(proxySpanEncodeTimeoutMs(4600))
    expect(calls[2][1]).toBe(MEDIA_PROXY_FFMPEG_TIMEOUT_MS)
    const probes = vi.mocked(probeVideoFramePtsMs).mock.calls
    expect(probes[0]).toEqual(["/w/seg-0000.mp4", proxySpanProbeTimeoutMs(3300)])
    expect(probes[1]).toEqual(["/w/seg-0001.mp4", proxySpanProbeTimeoutMs(4600)])
    expect(probes[2]).toEqual(["/w/proxy.mp4"]) // the join's: the default ceiling
  })

  it("the whole source (length unknown) keeps the whole-proxy ceiling; a caller's timeoutMs overrides every spawn", async () => {
    probeAnswers([120])
    await encodeVideoProxy("/w/source", "/w", { fps: 2, height: 540 })
    expect(vi.mocked(runFfmpeg).mock.calls.map((c) => c[1])).toEqual([MEDIA_PROXY_FFMPEG_TIMEOUT_MS, MEDIA_PROXY_FFMPEG_TIMEOUT_MS])
    expect(vi.mocked(probeVideoFramePtsMs).mock.calls[0]).toEqual(["/w/seg-0000.mp4"])
    vi.clearAllMocks()
    probeAnswers([7])
    await encodeVideoProxy("/w/source", "/w", { fps: 2, height: 540, spans: [{ startMs: 0, endMs: 3300 }], timeoutMs: 7 * 60_000 })
    expect(vi.mocked(runFfmpeg).mock.calls.map((c) => c[1])).toEqual([7 * 60_000, 7 * 60_000])
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

describe("encodeVideoProxy — scene cuts in the same decode (P3.2b)", () => {
  it("reads each span's scores and returns its cuts on the SOURCE clock, inside the span, ascending", async () => {
    probeAnswers([7, 10])
    scoreFiles({
      "/w/cuts-0000.txt": printed(3.3, [30]), // 1.2 s
      // frame 118 (4.72 s) is past the 4.6 s span: a frame the read decoded beyond its end
      "/w/cuts-0001.txt": printed(4.8, [10, 63, 118]), // 0.4 s, 2.52 s, 4.72 s
    })
    const r = await encodeVideoProxy("/w/source", "/w", { fps: 2, height: 540, spans: [{ startMs: 0, endMs: 3300 }, { startMs: 10_300, endMs: 14_900 }] })
    expect(r.cuts).toEqual([1200, 10_700, 12_820])
    expect(vi.mocked(createReadStream).mock.calls.map((c) => c[0])).toEqual(["/w/cuts-0000.txt", "/w/cuts-0001.txt"])
  })

  it("the whole source keeps every cut", async () => {
    probeAnswers([120])
    scoreFiles({}, printed(60, [300, 1490])) // 12 s, 59.6 s
    const r = await encodeVideoProxy("/w/source", "/w", { fps: 2, height: 540 })
    expect(r.cuts).toEqual([12_000, 59_600])
  })

  it("a span that wrote no frames (past the picture's end) contributes no cut", async () => {
    probeAnswers([4, 0])
    scoreFiles({ "/w/cuts-0000.txt": printed(2, [25]), "/w/cuts-0001.txt": printed(0.1, [1]) })
    const r = await encodeVideoProxy("/w/source", "/w", { fps: 2, height: 540, spans: [{ startMs: 0, endMs: 2000 }, { startMs: 20_000, endMs: 20_100 }] })
    expect(r.cuts).toEqual([1000])
  })

  it("the rule does not follow the proxy's fps: one score stream gives the same cuts at 2 fps and at 60 fps", async () => {
    // A cut at 2.0 s (score 9) with camera motion 200 ms before it (score 5,
    // under the threshold). Within the measured 500 ms window the motion keeps
    // the cut from standing 2x over its neighbourhood; a window of one 60 fps
    // period (16.7 ms) would not see the motion at all.
    let text = ""
    for (let k = 0; k < 100; k++) {
      const [score, mafd] = k === 50 ? [9, 9.5] : k === 45 ? [5, 5.2] : [k === 0 ? 0 : 0.3, 0.4]
      text += `frame:${k}    pts:${k * 40}  pts_time:${k / 25}\nlavfi.scd.mafd=${mafd}\nlavfi.scd.score=${score}\n`
    }
    const cutsAt = async (fps: number) => {
      probeAnswers([8])
      scoreFiles({ "/w/cuts-0000.txt": text })
      return (await encodeVideoProxy("/w/source", "/w", { fps, height: 540, spans: [{ startMs: 0, endMs: 4000 }] })).cuts
    }
    expect(await cutsAt(60)).toEqual(await cutsAt(2))
  })

  it("no cut anywhere is an empty list, never undefined", async () => {
    probeAnswers([4])
    scoreFiles({ "/w/cuts-0000.txt": printed(2) })
    const r = await encodeVideoProxy("/w/source", "/w", { fps: 2, height: 540, spans: [{ startMs: 0, endMs: 2000 }] })
    expect(r.cuts).toEqual([])
  })
})
