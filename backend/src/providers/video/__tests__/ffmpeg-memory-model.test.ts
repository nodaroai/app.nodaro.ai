// How much memory one ffmpeg launch needs at its peak — what it reserves from
// the container's budget before it starts (decided 2026-10-05, fixing the 4K
// OOM), so the launcher can hold a second 4K chunk back until the first is done
// instead of letting both run the box out of memory.
//
// Measured on the Railway nodaro-ci runner (pinned ffmpeg n8.1.2) with the
// decode/filter/encode thread counts FORCED: one final chunk's peak RSS is
//   4K ≈ 1,223 + 91.7·T + 72.6·N MiB      1080p ≈ 393 + 22.9·T + 17.75·N MiB
// and across canvases ≈ 107 + MP·(136 + 8.85·N + 11.05·T), N = the chunk's
// segments, T = threads. Threads dominate; segment COUNT matters, segment
// LENGTH does not, inline audio adds nothing measurable.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Edl, EdlSegment } from "@nodaro/shared"
import type { FfmpegThreads } from "../ffmpeg-threads.js"

const fx = vi.hoisted(() => ({
  /** Every ffmpeg launch: its output path (last argument) and launch options. */
  launches: [] as Array<{ out: string; opts: { peakMemoryMiB?: number } | undefined }>,
  canvas: { width: 1280, height: 720 },
  /** The counts `ffmpegThreads()` places on this "box" (undefined: none placed). */
  threads: undefined as { decode: number; filter: number; encode: number } | undefined,
}))

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    downloadFile: async () => {},
    runFfprobe: async () => "audio\n",
    probeStreamEnds: async () => ({ video: { state: "measured", endSec: 10_000 }, audio: { state: "measured", endSec: 10_000 } }),
    ffmpegVersionLine: async () => "ffmpeg version test",
    runFfmpeg: async (args: readonly string[], _timeoutMs?: number, opts?: { peakMemoryMiB?: number }) => {
      fx.launches.push({ out: String(args[args.length - 1]), opts })
      return ""
    },
  }
})
vi.mock("../ffmpeg-threads.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-threads.js")>()
  return {
    ...actual,
    ffmpegThreads: () => fx.threads,
    ffmpegEffectiveThreads: () => fx.threads ?? actual.ffmpegAutoThreadsFor(8),
  }
})
vi.mock("../../../lib/storage.js", () => ({
  getR2ObjectSize: async () => 0,
  downloadR2ObjectToFile: async () => {},
  uploadFileWithKeyToR2: async () => {},
  deleteFromR2: async () => {},
}))
vi.mock("../combine-videos.js", () => ({
  pickTargetResolution: async () => fx.canvas,
  pickTargetFps: async () => 30,
}))

import { canvasPeakMemoryMiB, defaultPeakMemoryMiB } from "../ffmpeg-memory-model.js"
import { ffmpegMemoryBudget } from "../ffmpeg-memory.js"
import { applyEdl, buildSliceCommand, slicePeakMemoryMiB, type SliceOptions } from "../apply-edl.js"

const UHD = { width: 3840, height: 2160 }
const FHD = { width: 1920, height: 1080 }
const same = (t: number): FfmpegThreads => ({ decode: t, filter: t, encode: t })

// [canvas, N, decode/filter threads, encode threads, measured peak RSS MiB] —
// the MAX over the probe's repeats, from the runner's thread-count probe
// (every row, including the mixed counts and the N = 10 sets whose frame
// count was one off — their memory is as measured as any).
const MEASURED: Array<[typeof UHD, number, number, number, number]> = [
  [UHD, 10, 16, 16, 3508], [UHD, 10, 2, 2, 2133], [UHD, 10, 2, 32, 4321], [UHD, 10, 32, 16, 3928], [UHD, 10, 32, 2, 2867],
  [UHD, 10, 32, 32, 5049], [UHD, 10, 32, 8, 3312], [UHD, 10, 4, 4, 2332], [UHD, 10, 8, 8, 2706], [UHD, 2, 16, 16, 2920],
  [UHD, 2, 2, 2, 1549], [UHD, 2, 32, 32, 4308], [UHD, 2, 4, 4, 1744], [UHD, 2, 8, 8, 2122], [UHD, 30, 16, 16, 4971],
  [UHD, 30, 2, 2, 3603], [UHD, 30, 2, 32, 5523], [UHD, 30, 32, 16, 5174], [UHD, 30, 32, 2, 4186], [UHD, 30, 32, 32, 6286],
  [UHD, 30, 32, 8, 4593], [UHD, 30, 4, 4, 3747], [UHD, 30, 8, 8, 4163],
  [FHD, 10, 16, 16, 999], [FHD, 10, 2, 2, 614], [FHD, 10, 32, 32, 1444], [FHD, 10, 4, 4, 671], [FHD, 10, 8, 8, 788],
  [FHD, 2, 16, 16, 847], [FHD, 2, 2, 2, 462], [FHD, 2, 32, 32, 1175], [FHD, 2, 4, 4, 521], [FHD, 2, 8, 8, 634],
  [FHD, 30, 16, 16, 1378], [FHD, 30, 2, 2, 981], [FHD, 30, 32, 32, 1753], [FHD, 30, 4, 4, 1043], [FHD, 30, 8, 8, 1147],
]

describe("canvasPeakMemoryMiB — the measured model", () => {
  it("equal counts: 257 + MP·(136 + 8.85·N + 11.05·T) MiB, rounded up (the fit's 107 plus a flat 150 margin)", () => {
    expect(canvasPeakMemoryMiB(UHD, 30, same(32))).toBe(Math.ceil(257 + 8.2944 * (136 + 8.85 * 30 + 11.05 * 32)))
    expect(canvasPeakMemoryMiB(FHD, 30, same(2))).toBe(Math.ceil(257 + 2.0736 * (136 + 8.85 * 30 + 11.05 * 2)))
  })

  it("threads dominate: 4K, N = 30 predicts ~1.8× more at 32 threads than at 2", () => {
    const at2 = canvasPeakMemoryMiB(UHD, 30, same(2))
    const at32 = canvasPeakMemoryMiB(UHD, 30, same(32))
    expect(at32 / at2).toBeGreaterThan(1.7)
    expect(at32 / at2).toBeLessThan(1.9)
  })

  it("the encoder's threads weigh more than the decoders' and the filter graph's", () => {
    const encodeOnly = canvasPeakMemoryMiB(UHD, 30, { decode: 2, filter: 2, encode: 32 })
    const decodeOnly = canvasPeakMemoryMiB(UHD, 30, { decode: 32, filter: 32, encode: 2 })
    expect(encodeOnly).toBeGreaterThan(decodeOnly)
    // …and each count adds something over the all-2 launch.
    const all2 = canvasPeakMemoryMiB(UHD, 30, same(2))
    expect(decodeOnly).toBeGreaterThan(all2)
    expect(encodeOnly).toBeGreaterThan(all2)
  })

  it("a slice with no segments is charged as one", () => {
    expect(canvasPeakMemoryMiB(FHD, 0, same(4))).toBe(canvasPeakMemoryMiB(FHD, 1, same(4)))
  })

  it("is at or above EVERY measured final chunk — mixed thread counts included — and never wildly above", () => {
    for (const [canvas, n, dec, enc, rss] of MEASURED) {
      const predicted = canvasPeakMemoryMiB(canvas, n, { decode: dec, filter: dec, encode: enc })
      const label = `${canvas.height}p N=${n} dec/filter ${dec} enc ${enc}: ${predicted} vs ${rss}`
      expect(predicted, label).toBeGreaterThanOrEqual(rss)
      expect(predicted / rss, label).toBeLessThan(1.4)
    }
  })

  it("the headline point: 4K, N = 30, T = 32 predicts 6,521 MiB (measured 6,286; the fit alone says 6,370)", () => {
    expect(canvasPeakMemoryMiB(UHD, 30, same(32))).toBe(6521)
  })

  it("the production container (25,622 MiB budget, 2,048 MiB reserve) holds THREE 4K 30-segment chunks at 32 threads, not four", () => {
    // The budget is DERIVED from production's memory.max, not retyped: 32,000,000,000 B.
    // Decided 2026-10-05: the reserve went 1,024 -> 2,048 MiB (idle containers measured 1.66 GB / 1.9 GB of
    // memory.current) and the +150 MiB margin stayed, so the fourth chunk (4 x 6,521 = 26,084 MiB) no longer fits.
    const read = (path: string) => (path === "/sys/fs/cgroup/memory.max" ? "32000000000\n" : path === "/proc/self/cgroup" ? "0::/\n" : undefined)
    const budget = ffmpegMemoryBudget({}, read, 330_437 * 1024 * 1024).budgetMiB
    expect(budget).toBe(25_622)
    const one = canvasPeakMemoryMiB(UHD, 30, same(32))
    expect(3 * one).toBeLessThanOrEqual(budget)
    expect(4 * one).toBeGreaterThan(budget)
    // What tips the fourth out is the flat margin: without it four would fit by 138 MiB.
    expect(4 * (one - 150)).toBeLessThanOrEqual(budget)
  })

  it("two 30-segment 4K chunks predict more than the measured runner's 5,022 MiB budget — they serialize", () => {
    expect(2 * canvasPeakMemoryMiB(UHD, 30, same(2))).toBeGreaterThan(5022)
  })
})

describe("defaultPeakMemoryMiB — a launch that predicts nothing: 393 + 22.9·T", () => {
  it("scales with the thread count (the 1080p base)", () => {
    expect(defaultPeakMemoryMiB(same(2))).toBe(439)
    expect(defaultPeakMemoryMiB(same(4))).toBe(485)
    expect(defaultPeakMemoryMiB(same(32))).toBe(1126) // production: not 512
    expect(defaultPeakMemoryMiB(same(32))).toBeGreaterThan(2 * 512)
  })

  it("is the 1080p base — within 15 % of the lightest measured 1080p chunk (N = 2) at every thread count", () => {
    for (const [canvas, n, dec, enc, rss] of MEASURED) {
      if (canvas !== FHD || n !== 2) continue
      expect(defaultPeakMemoryMiB({ decode: dec, filter: dec, encode: enc }), `T=${enc}`).toBeGreaterThanOrEqual(rss * 0.85)
    }
  })

  it("weighs the encoder's and the decoders' counts as the canvas model does", () => {
    expect(defaultPeakMemoryMiB({ decode: 2, filter: 2, encode: 32 })).toBeGreaterThan(defaultPeakMemoryMiB({ decode: 32, filter: 32, encode: 2 }))
  })
})

const SLICE_EDL: Edl = {
  version: 1,
  clock: "master",
  sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }],
  segments: Array.from({ length: 7 }, (_, k) => ({ id: `s${k}`, inMs: k * 1000, outMs: (k + 1) * 1000, video: "A" })),
} as unknown as Edl
const OPTS: SliceOptions = {
  output: "video", quality: "final", target: UHD, fps: 30, chunkStartMs: 0, masterAudioId: undefined, audioPresent: new Map([["A", true]]),
}

describe("buildSliceCommand carries what the prediction is made from", () => {
  it("a picture slice (with or without inline audio) carries its canvas and segment count", () => {
    expect(buildSliceCommand(SLICE_EDL, SLICE_EDL.segments, OPTS).memoryBasis).toEqual({ ...UHD, segments: 7 })
    expect(buildSliceCommand(SLICE_EDL, SLICE_EDL.segments, { ...OPTS, omitAudio: true }).memoryBasis).toEqual({ ...UHD, segments: 7 })
    expect(buildSliceCommand(SLICE_EDL, SLICE_EDL.segments.slice(0, 3), { ...OPTS, target: FHD }).memoryBasis).toEqual({ ...FHD, segments: 3 })
  })

  it("a sound-only slice has no picture to predict: the launcher's default estimate", () => {
    const cmd = buildSliceCommand(SLICE_EDL, SLICE_EDL.segments, { ...OPTS, output: "audio", audioCodec: "pcm" })
    expect(cmd.memoryBasis).toBeUndefined()
    expect(slicePeakMemoryMiB(cmd, same(32))).toBeUndefined()
  })

  it("the prediction uses the counts the launch runs with — explicit ones, else the ones ffmpeg picks", () => {
    const cmd = buildSliceCommand(SLICE_EDL, SLICE_EDL.segments, OPTS)
    expect(slicePeakMemoryMiB(cmd, same(32))).toBe(canvasPeakMemoryMiB(UHD, 7, same(32)))
    expect(slicePeakMemoryMiB(cmd, same(2))).toBe(canvasPeakMemoryMiB(UHD, 7, same(2)))
    fx.threads = undefined // no quota below the cores: 8 "cores" → decode/filter 8, x264 12
    expect(slicePeakMemoryMiB(cmd, undefined)).toBe(canvasPeakMemoryMiB(UHD, 7, { decode: 8, filter: 8, encode: 12 }))
  })
})

describe("census: every Apply EDL slice launch passes its prediction to the launcher", () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  // The slice runner is the EDL timeline's since the Speaker View extraction
  // (Apply EDL runs on it), so every renderer on it inherits the reservation.
  const source = readFileSync(join(HERE, "..", "edl-timeline.ts"), "utf8")

  it("textually: every ffmpeg run of a slice argv passes peakMemoryMiB", () => {
    // A slice is launched with `sliceArgv(...)` as runFfmpeg's argv; the call's
    // remaining arguments must carry the prediction.
    const calls = [...source.matchAll(/runFfmpeg\(\s*sliceArgv\(/g)]
    expect(calls.length).toBeGreaterThan(0)
    for (const m of calls) {
      const rest = source.slice(m.index, m.index! + 400)
      const call = rest.slice(0, rest.indexOf("\n"))
      expect(call, `a slice launch without a prediction: ${call}`).toMatch(/peakMemoryMiB/)
    }
  })

  function edl(n: number): Edl {
    const segments = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, inMs: i * 2000, outMs: (i + 1) * 2000, video: "A" })) as EdlSegment[]
    return { version: 1, clock: "master", sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }], segments } as unknown as Edl
  }

  beforeEach(() => {
    fx.launches = []
    fx.threads = undefined
    vi.useFakeTimers({ toFake: ["Date"] })
  })
  afterEach(() => vi.useRealTimers())

  it("behaviorally: a chunked 4K render launches every picture chunk with the model's prediction at its thread counts", async () => {
    fx.canvas = UHD
    fx.threads = same(32)
    await applyEdl({ edl: edl(7), output: "video", quality: "final", jobId: "job-mem", checkpoint: false, chunkThreshold: 1, maxSegmentsPerChunk: 3 })
    const chunks = fx.launches.filter((l) => /\/chunk-\d+\.mp4$/.test(l.out))
    expect(chunks.map((c) => c.opts?.peakMemoryMiB)).toEqual([3, 3, 1].map((n) => canvasPeakMemoryMiB(UHD, n, same(32))))
  })

  it("behaviorally: a single-chunk render (inline audio) predicts too", async () => {
    fx.canvas = FHD
    fx.threads = same(2)
    await applyEdl({ edl: edl(4), output: "video", quality: "final", jobId: "job-mem", checkpoint: false })
    const picture = fx.launches.filter((l) => /\/chunk-0\.mp4$/.test(l.out))
    expect(picture).toHaveLength(1)
    expect(picture[0]!.opts?.peakMemoryMiB).toBe(canvasPeakMemoryMiB(FHD, 4, same(2)))
  })
})
