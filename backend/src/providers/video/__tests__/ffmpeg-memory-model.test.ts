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
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Edl, EdlSegment } from "@nodaro/shared/edl"
import type { FfmpegThreads } from "../ffmpeg-threads.js"

const fx = vi.hoisted(() => ({
  /** Every ffmpeg launch: its output path (last argument) and launch options. */
  launches: [] as Array<{ out: string; opts: { peakMemoryMiB?: number } | undefined }>,
  canvas: { width: 1280, height: 720 },
  /** What the picture-size probe answers for every video source ("WxH"; anything unparseable = not known). */
  cameraSize: "1920x1080\n",
  /** The counts `ffmpegThreads()` places on this "box" (undefined: none placed). */
  threads: undefined as { decode: number; filter: number; encode: number } | undefined,
}))

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    downloadFile: async () => {},
    // the picture-size probe answers the cameras' size (fx.cameraSize), everything else "has audio"
    runFfprobe: async (args: readonly string[]) => (args.includes("stream=width,height") ? fx.cameraSize : "audio\n"),
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

import { cameraMegapixelsOf, canvasPeakMemoryMiB, defaultPeakMemoryMiB, inputsPeakMemoryMiB, UNKNOWN_INPUTS } from "../ffmpeg-memory-model.js"
import { ffmpegMemoryBudget } from "../ffmpeg-memory.js"
import { applyEdl, buildSliceCommand, slicePeakMemoryMiB, type SliceOptions } from "../apply-edl.js"

const UHD = { width: 3840, height: 2160 }
const FHD = { width: 1920, height: 1080 }
const same = (t: number): FfmpegThreads => ({ decode: t, filter: t, encode: t })
/** The cameras every memory row was measured with: 1080p (megapixels). */
const CAM = (1920 * 1080) / 1e6

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
    expect(canvasPeakMemoryMiB(UHD, 30, same(32), { cameraMegapixels: CAM, inputs: 1 })).toBe(Math.ceil(257 + 8.2944 * (136 + 8.85 * 30 + 11.05 * 32)))
    expect(canvasPeakMemoryMiB(FHD, 30, same(2), { cameraMegapixels: CAM, inputs: 1 })).toBe(Math.ceil(257 + 2.0736 * (136 + 8.85 * 30 + 11.05 * 2)))
  })

  it("threads dominate: 4K, N = 30 predicts ~1.8× more at 32 threads than at 2", () => {
    const at2 = canvasPeakMemoryMiB(UHD, 30, same(2), { cameraMegapixels: CAM, inputs: 1 })
    const at32 = canvasPeakMemoryMiB(UHD, 30, same(32), { cameraMegapixels: CAM, inputs: 1 })
    expect(at32 / at2).toBeGreaterThan(1.7)
    expect(at32 / at2).toBeLessThan(1.9)
  })

  it("the encoder's threads weigh more than the decoders' and the filter graph's", () => {
    const encodeOnly = canvasPeakMemoryMiB(UHD, 30, { decode: 2, filter: 2, encode: 32 }, { cameraMegapixels: CAM, inputs: 1 })
    const decodeOnly = canvasPeakMemoryMiB(UHD, 30, { decode: 32, filter: 32, encode: 2 }, { cameraMegapixels: CAM, inputs: 1 })
    expect(encodeOnly).toBeGreaterThan(decodeOnly)
    // …and each count adds something over the all-2 launch.
    const all2 = canvasPeakMemoryMiB(UHD, 30, same(2), { cameraMegapixels: CAM, inputs: 1 })
    expect(decodeOnly).toBeGreaterThan(all2)
    expect(encodeOnly).toBeGreaterThan(all2)
  })

  it("a slice with no segments is charged as one", () => {
    expect(canvasPeakMemoryMiB(FHD, 0, same(4), { cameraMegapixels: CAM, inputs: 1 })).toBe(canvasPeakMemoryMiB(FHD, 1, same(4), { cameraMegapixels: CAM, inputs: 1 }))
  })

  it("is at or above EVERY measured final chunk — mixed thread counts included — and never wildly above", () => {
    for (const [canvas, n, dec, enc, rss] of MEASURED) {
      const predicted = canvasPeakMemoryMiB(canvas, n, { decode: dec, filter: dec, encode: enc }, { cameraMegapixels: CAM, inputs: 1 })
      const label = `${canvas.height}p N=${n} dec/filter ${dec} enc ${enc}: ${predicted} vs ${rss}`
      expect(predicted, label).toBeGreaterThanOrEqual(rss)
      expect(predicted / rss, label).toBeLessThan(1.4)
    }
  })

  it("the headline point: 4K, N = 30, T = 32 predicts 6,521 MiB (measured 6,286; the fit alone says 6,370)", () => {
    expect(canvasPeakMemoryMiB(UHD, 30, same(32), { cameraMegapixels: CAM, inputs: 1 })).toBe(6521)
  })

  it("the production container (25,622 MiB budget, 2,048 MiB reserve) holds THREE 4K 30-segment chunks at 32 threads, not four", () => {
    // The budget is DERIVED from production's memory.max, not retyped: 32,000,000,000 B.
    // Decided 2026-10-05: the reserve went 1,024 -> 2,048 MiB (idle containers measured 1.66 GB / 1.9 GB of
    // memory.current) and the +150 MiB margin stayed, so the fourth chunk (4 x 6,521 = 26,084 MiB) no longer fits.
    const read = (path: string) => (path === "/sys/fs/cgroup/memory.max" ? "32000000000\n" : path === "/proc/self/cgroup" ? "0::/\n" : undefined)
    const budget = ffmpegMemoryBudget({}, read, 330_437 * 1024 * 1024).budgetMiB
    expect(budget).toBe(25_622)
    const one = canvasPeakMemoryMiB(UHD, 30, same(32), { cameraMegapixels: CAM, inputs: 1 })
    expect(3 * one).toBeLessThanOrEqual(budget)
    expect(4 * one).toBeGreaterThan(budget)
    // What tips the fourth out is the flat margin: without it four would fit by 138 MiB.
    expect(4 * (one - 150)).toBeLessThanOrEqual(budget)
  })

  it("two 30-segment 4K chunks predict more than the measured runner's 5,022 MiB budget — they serialize", () => {
    expect(2 * canvasPeakMemoryMiB(UHD, 30, same(2), { cameraMegapixels: CAM, inputs: 1 })).toBeGreaterThan(5022)
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

describe("inputsPeakMemoryMiB - the per-input term (Base per camera, decided 2026-10-11)", () => {
  // (inputs - 1) * (T - 2) * 9 MiB, T the graph's side of the counts (decode /
  // filter): measured only on the multicam slices (1080p cameras; 2 inputs =
  // one camera and the master's sound, 3 = two cameras and the master, 4 = three
  // and the master) - see the model header and ffmpeg-memory-zoom.test.ts.
  it("is (inputs - 1) * (T - 2) * 9 MiB", () => {
    for (const t of [3, 8, 16, 32, 48]) {
      for (const inputs of [1, 2, 3, 4, 7]) {
        expect(inputsPeakMemoryMiB(same(t), inputs, CAM)).toBe((inputs - 1) * (t - 2) * 9)
      }
    }
  })

  it("is zero for ONE input, and at or below 2 threads (the base model is anchored there and already covers the multicam rows)", () => {
    for (const t of [0, 1, 2, 32]) expect(inputsPeakMemoryMiB(same(t), 1, CAM)).toBe(0)
    for (const inputs of [1, 2, 4, 9]) for (const t of [0, 1, 2]) expect(inputsPeakMemoryMiB(same(t), inputs, CAM)).toBe(0)
  })

  it("follows the graph's side of the counts (the decoders and the filter graph), not the encoder's", () => {
    expect(inputsPeakMemoryMiB({ decode: 2, filter: 2, encode: 32 }, 4, CAM)).toBe(0)
    expect(inputsPeakMemoryMiB({ decode: 32, filter: 2, encode: 2 }, 4, CAM)).toBe(inputsPeakMemoryMiB(same(32), 4, CAM))
    expect(inputsPeakMemoryMiB({ decode: 2, filter: 32, encode: 2 }, 4, CAM)).toBe(inputsPeakMemoryMiB(same(32), 4, CAM))
  })

  it("is charged in MiB whatever the canvas is (the cameras are what they are, not the canvas's size)", () => {
    const at = (canvas: { width: number; height: number }, inputs: number) => canvasPeakMemoryMiB(canvas, 6, same(32), { cameraMegapixels: CAM, inputs })
    const step = (canvas: { width: number; height: number }) => at(canvas, 4) - at(canvas, 1)
    expect(step(UHD)).toBe(3 * 30 * 9)
    expect(step(FHD)).toBe(3 * 30 * 9)
    expect(step({ width: 1280, height: 720 })).toBe(3 * 30 * 9)
  })

  it("a launch that cannot state its input count is charged the largest the model was measured on (4), never fewer", () => {
    expect(UNKNOWN_INPUTS).toBe(4)
    expect(inputsPeakMemoryMiB(same(32), undefined, CAM)).toBe(inputsPeakMemoryMiB(same(32), 4, CAM))
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(inputsPeakMemoryMiB(same(32), bad, CAM), String(bad)).toBe(inputsPeakMemoryMiB(same(32), UNKNOWN_INPUTS, CAM))
    }
    expect(canvasPeakMemoryMiB(FHD, 6, same(32), { cameraMegapixels: CAM, inputs: undefined })).toBe(canvasPeakMemoryMiB(FHD, 6, same(32), { cameraMegapixels: CAM, inputs: 4 }))
    expect(canvasPeakMemoryMiB(FHD, 6, same(32), { cameraMegapixels: CAM, inputs: undefined })).toBeGreaterThan(canvasPeakMemoryMiB(FHD, 6, same(32), { cameraMegapixels: CAM, inputs: 1 }))
    // a fractional count is floored, not rounded up
    expect(inputsPeakMemoryMiB(same(32), 3.9, CAM)).toBe(inputsPeakMemoryMiB(same(32), 3, CAM))
  })

  it("grows with every camera, and is the part of the prediction the single-source rows never see", () => {
    for (const t of [3, 16, 32]) {
      const reservations = [1, 2, 3, 4, 5].map((inputs) => canvasPeakMemoryMiB(FHD, 10, same(t), { cameraMegapixels: CAM, inputs }))
      expect(reservations).toEqual([...reservations].sort((a, b) => a - b))
      expect(new Set(reservations).size).toBe(5)
    }
  })

  it("rounds the whole prediction up once (the term is not rounded on its own)", () => {
    for (const t of [3, 17, 32]) {
      for (const inputs of [2, 3, 4]) {
        const exact = 257 + (FHD.width * FHD.height / 1e6) * (136 + 8.85 * 9 + 11.05 * t) + (inputs - 1) * (t - 2) * 9
        expect(canvasPeakMemoryMiB(FHD, 9, same(t), { cameraMegapixels: CAM, inputs })).toBe(Math.ceil(exact - 1e-9))
      }
    }
  })
})

describe("inputsPeakMemoryMiB - 4K scaling by the largest camera (decided 2026-10-11)", () => {
  const camera = (width: number, height: number) => cameraMegapixelsOf({ width, height })
  it("scales by max(1, the largest camera's megapixels / 1080p's): cameras at or below 1080p change nothing", () => {
    const at1080 = inputsPeakMemoryMiB(same(32), 4, CAM)
    expect(at1080).toBe(3 * 30 * 9)
    for (const small of [camera(1280, 720), camera(640, 360), camera(1080, 1920), camera(1920, 1080), 0.01]) {
      expect(inputsPeakMemoryMiB(same(32), 4, small), String(small)).toBe(at1080)
    }
  })

  it("4K cameras reserve four times the per-input term: 4 inputs at 32 threads +3,240 MiB, not +810", () => {
    expect(inputsPeakMemoryMiB(same(32), 4, camera(3840, 2160))).toBe(3 * 30 * 9 * 4)
    expect(inputsPeakMemoryMiB(same(32), 4, camera(3840, 2160))).toBe(3240)
    expect(inputsPeakMemoryMiB(same(32), 2, camera(3840, 2160))).toBe(1080)
    expect(inputsPeakMemoryMiB(same(32), 4, camera(2560, 1440))).toBeCloseTo(3 * 30 * 9 * (3.6864 / 2.0736), 6)
  })

  it("a camera whose size is not known is 4K, never smaller", () => {
    const uhd = inputsPeakMemoryMiB(same(32), 4, camera(3840, 2160))
    for (const unknown of [undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(inputsPeakMemoryMiB(same(32), 4, unknown), String(unknown)).toBe(uhd)
    }
  })

  it("is still zero for one input and at or below 2 threads, whatever the camera", () => {
    expect(inputsPeakMemoryMiB(same(32), 1, camera(7680, 4320))).toBe(0)
    expect(inputsPeakMemoryMiB(same(32), 1, undefined)).toBe(0)
    expect(inputsPeakMemoryMiB(same(2), 4, camera(3840, 2160))).toBe(0)
  })

  it("the whole reservation at 32 threads, 4 inputs, 4K cameras: +3,240 MiB (2,430 more than 1080p cameras) at every canvas; the budget holds fewer", () => {
    const budget = 25_622
    const at = (canvas: { width: number; height: number }, n: number, megapixels: number) => canvasPeakMemoryMiB(canvas, n, same(32), { inputs: 4, cameraMegapixels: megapixels })
    for (const canvas of [{ width: 1280, height: 720 }, FHD, UHD]) {
      for (const n of [1, 6, 30]) expect(at(canvas, n, camera(3840, 2160)) - at(canvas, n, CAM)).toBe(2430)
    }
    // N = 1 / 6 / 30 at 720p, 1080p and 4K: reservation (launches that fit the budget)
    const table = Object.fromEntries(
      [["720p", { width: 1280, height: 720 }], ["1080p", FHD], ["4K", UHD]].flatMap(([name, canvas]) =>
        [1, 6, 30].map((n) => [`${name as string} N=${n}`, `${at(canvas as typeof FHD, n, camera(3840, 2160))} (${Math.floor(budget / at(canvas as typeof FHD, n, camera(3840, 2160)))})`]),
      ),
    )
    expect(table).toEqual({
      "720p N=1": "3957 (6)", "720p N=6": "3998 (6)", "720p N=30": "4193 (6)",
      "1080p N=1": "4531 (5)", "1080p N=6": "4623 (5)", "1080p N=30": "5063 (5)",
      "4K N=1": "7632 (3)", "4K N=6": "7999 (3)", "4K N=30": "9761 (2)",
    })
  })
})

describe("single-source launches are reserved EXACTLY as before the per-input term", () => {
  it("every measured single-source row: one input is the model of 2026-10-05, to the MiB, and under its 1.4x ceiling", () => {
    // The base fit rows (one source, inline sound). The per-input term is zero
    // for one input, so nothing about them moved: the ceiling is NOT loosened.
    for (const [canvas, n, dec, enc, rss] of MEASURED) {
      const threads = { decode: dec, filter: dec, encode: enc }
      const mp = (canvas.width * canvas.height) / 1e6
      const legacy = Math.ceil(257 + mp * (136 + 8.85 * n + 8.15 * enc + 2.9 * dec))
      expect(canvasPeakMemoryMiB(canvas, n, threads, { cameraMegapixels: CAM, inputs: 1 }), `${canvas.height}p N=${n} ${dec}/${enc}`).toBe(legacy)
      expect(legacy / rss).toBeLessThan(1.4)
    }
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
  // every camera is 1080p (the size the memory rows were measured with)
  sourceSizes: new Map([["A", FHD], ["B", FHD], ["C", FHD]]),
}

describe("a slice's input count is the number of distinct source FILES it opens", () => {
  const cams: Edl = {
    version: 1,
    clock: "master",
    sources: [
      { id: "A", url: "https://f.test/a.mp4", kind: "video" },
      { id: "B", url: "https://f.test/b.mp4", kind: "video" },
      { id: "C", url: "https://f.test/c.mp4", kind: "video" },
      { id: "MIC", url: "https://f.test/m.wav", kind: "audio", role: "master-audio" },
    ],
    segments: [
      { id: "s0", inMs: 0, outMs: 1000, video: "A" },
      { id: "s1", inMs: 1000, outMs: 2000, video: "B" },
      { id: "s2", inMs: 2000, outMs: 3000, video: "C" },
      { id: "s3", inMs: 3000, outMs: 4000, video: "A" },
    ],
  } as unknown as Edl
  const multicam: SliceOptions = {
    ...OPTS,
    masterAudioId: "MIC",
    audioPresent: new Map([["A", true], ["B", true], ["C", true], ["MIC", true]]),
  }

  it("three cameras and the master's sound are four inputs; a chunk that touches two cameras is three (the master is always read)", () => {
    const all = buildSliceCommand(cams, cams.segments, multicam)
    expect(all.inputIds).toEqual(["A", "MIC", "B", "C"])
    expect(all.memoryBasis).toEqual({ ...UHD, segments: 4, inputs: 4, cameraMegapixels: CAM })
    const head = buildSliceCommand(cams, cams.segments.slice(0, 2), multicam)
    expect(head.inputIds.length).toBe(3)
    expect(head.memoryBasis).toEqual({ ...UHD, segments: 2, inputs: 3, cameraMegapixels: CAM })
  })

  it("the reservation pays for the cameras it opens, at the launch's threads, and only above 2", () => {
    const all = buildSliceCommand(cams, cams.segments, multicam)
    const head = buildSliceCommand(cams, cams.segments.slice(0, 2), multicam)
    expect(slicePeakMemoryMiB(all, same(32))).toBe(canvasPeakMemoryMiB(UHD, 4, same(32), { cameraMegapixels: CAM, inputs: 4 }))
    expect(slicePeakMemoryMiB(head, same(32))).toBe(canvasPeakMemoryMiB(UHD, 2, same(32), { cameraMegapixels: CAM, inputs: 3 }))
    expect(slicePeakMemoryMiB(all, same(32))! - canvasPeakMemoryMiB(UHD, 4, same(32), { cameraMegapixels: CAM, inputs: 1 })).toBe(3 * 30 * 9)
    expect(slicePeakMemoryMiB(all, same(2))).toBe(canvasPeakMemoryMiB(UHD, 4, same(2), { cameraMegapixels: CAM, inputs: 1 }))
  })

  it("a picture-only chunk (the sound rides its own pass) is charged as its inline-sound twin: the master's file counts though the chunk never opens it", () => {
    // Every memory row behind the per-input term was an inline-sound launch,
    // so a sound input's own share cannot be separated from a camera's; the
    // production shape (a long edit's picture chunks) takes the safe side.
    const inline = buildSliceCommand(cams, cams.segments.slice(0, 2), multicam)
    const pictureOnly = buildSliceCommand(cams, cams.segments.slice(0, 2), { ...multicam, omitAudio: true })
    expect(inline.inputIds).toEqual(["A", "MIC", "B"])
    expect(pictureOnly.inputIds).toEqual(["A", "B"])
    expect(pictureOnly.memoryBasis?.inputs).toBe(3)
    expect(pictureOnly.memoryBasis).toEqual(inline.memoryBasis)
    // a source without a track has no sound to open, so it adds nothing
    const noMic = buildSliceCommand(cams, cams.segments.slice(0, 2), { ...multicam, omitAudio: true, audioPresent: new Map([["A", true], ["B", true], ["C", true], ["MIC", false]]) })
    expect(noMic.memoryBasis?.inputs).toBe(2)
    // a sound file a picture slot already reads is not counted twice
    const own = buildSliceCommand(cams, cams.segments.slice(0, 2), { ...multicam, omitAudio: true, masterAudioId: undefined })
    expect(own.memoryBasis?.inputs).toBe(2)
  })

  it("the slice carries the LARGEST camera it opens (a sound file is no camera), and the reservation scales by it", () => {
    const mixed = { ...multicam, sourceSizes: new Map([["A", FHD], ["B", FHD], ["C", UHD], ["MIC", UHD]]) }
    const all = buildSliceCommand(cams, cams.segments, mixed)
    expect(all.memoryBasis).toEqual({ ...UHD, segments: 4, inputs: 4, cameraMegapixels: cameraMegapixelsOf(UHD) })
    expect(slicePeakMemoryMiB(all, same(32))! - canvasPeakMemoryMiB(UHD, 4, same(32), { inputs: 4, cameraMegapixels: CAM })).toBe(2430)
    // a chunk that opens only the 1080p cameras is not charged for the 4K one
    const head = buildSliceCommand(cams, cams.segments.slice(0, 2), mixed)
    expect(head.memoryBasis?.cameraMegapixels).toBe(CAM)
    // a sound file's size never counts: a 4K "size" on the master alone leaves 1080p cameras at 1080p
    const sound = buildSliceCommand(cams, cams.segments.slice(0, 2), { ...multicam, sourceSizes: new Map([["A", FHD], ["B", FHD], ["MIC", UHD]]) })
    expect(sound.memoryBasis?.cameraMegapixels).toBe(CAM)
  })

  it("a camera whose size the slice was not given counts as 4K - the whole slice's, if any one is missing", () => {
    const none = buildSliceCommand(cams, cams.segments, { ...multicam, sourceSizes: undefined })
    expect(none.memoryBasis?.cameraMegapixels).toBe(cameraMegapixelsOf(UHD))
    const partial = buildSliceCommand(cams, cams.segments, { ...multicam, sourceSizes: new Map([["A", FHD], ["B", FHD]]) })
    expect(partial.memoryBasis?.cameraMegapixels).toBe(cameraMegapixelsOf(UHD)) // C is missing
    expect(slicePeakMemoryMiB(none, same(32))).toBe(canvasPeakMemoryMiB(UHD, 4, same(32), { inputs: 4, cameraMegapixels: cameraMegapixelsOf(UHD) }))
  })

  it("the silent generator a source without sound needs is not a camera: it does not count", () => {
    const silent = buildSliceCommand(cams, cams.segments, { ...multicam, audioPresent: new Map([["A", false], ["B", false], ["C", false], ["MIC", false]]) })
    expect(silent.needsSilence).toBe(true)
    expect(silent.memoryBasis?.inputs).toBe(silent.inputIds.length)
  })
})

describe("buildSliceCommand carries what the prediction is made from", () => {
  it("a picture slice (with or without inline audio) carries its canvas and segment count", () => {
    // ONE source file with its own sound: one ffmpeg input
    expect(buildSliceCommand(SLICE_EDL, SLICE_EDL.segments, OPTS).memoryBasis).toEqual({ ...UHD, segments: 7, inputs: 1, cameraMegapixels: CAM })
    expect(buildSliceCommand(SLICE_EDL, SLICE_EDL.segments, { ...OPTS, omitAudio: true }).memoryBasis).toEqual({ ...UHD, segments: 7, inputs: 1, cameraMegapixels: CAM })
    expect(buildSliceCommand(SLICE_EDL, SLICE_EDL.segments.slice(0, 3), { ...OPTS, target: FHD }).memoryBasis).toEqual({ ...FHD, segments: 3, inputs: 1, cameraMegapixels: CAM })
  })

  it("a sound-only slice has no picture to predict: the launcher's default estimate", () => {
    const cmd = buildSliceCommand(SLICE_EDL, SLICE_EDL.segments, { ...OPTS, output: "audio", audioCodec: "pcm" })
    expect(cmd.memoryBasis).toBeUndefined()
    expect(slicePeakMemoryMiB(cmd, same(32))).toBeUndefined()
  })

  it("the prediction uses the counts the launch runs with — explicit ones, else the ones ffmpeg picks", () => {
    const cmd = buildSliceCommand(SLICE_EDL, SLICE_EDL.segments, OPTS)
    expect(slicePeakMemoryMiB(cmd, same(32))).toBe(canvasPeakMemoryMiB(UHD, 7, same(32), { cameraMegapixels: CAM, inputs: 1 }))
    expect(slicePeakMemoryMiB(cmd, same(2))).toBe(canvasPeakMemoryMiB(UHD, 7, same(2), { cameraMegapixels: CAM, inputs: 1 }))
    fx.threads = undefined // no quota below the cores: 8 "cores" → decode/filter 8, x264 12
    expect(slicePeakMemoryMiB(cmd, undefined)).toBe(canvasPeakMemoryMiB(UHD, 7, { decode: 8, filter: 8, encode: 12 }, { cameraMegapixels: CAM, inputs: 1 }))
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
    expect(chunks.map((c) => c.opts?.peakMemoryMiB)).toEqual([3, 3, 1].map((n) => canvasPeakMemoryMiB(UHD, n, same(32), { cameraMegapixels: CAM, inputs: 1 })))
  })

  it("behaviorally: a multicam render pays for the cameras each CHUNK opens (per-input term), not the whole edit's", async () => {
    fx.canvas = FHD
    fx.threads = same(32)
    const segments = [
      { id: "s0", inMs: 0, outMs: 2000, video: "A" }, { id: "s1", inMs: 2000, outMs: 4000, video: "A" }, { id: "s2", inMs: 4000, outMs: 6000, video: "A" },
      { id: "s3", inMs: 6000, outMs: 8000, video: "B" }, { id: "s4", inMs: 8000, outMs: 10_000, video: "C" },
    ] as EdlSegment[]
    const multicam = {
      version: 1, clock: "master",
      sources: [
        { id: "A", url: "https://f.test/a.mp4", kind: "video" }, { id: "B", url: "https://f.test/b.mp4", kind: "video" },
        { id: "C", url: "https://f.test/c.mp4", kind: "video" }, { id: "MIC", url: "https://f.test/m.wav", kind: "audio", role: "master-audio" },
      ],
      segments,
    } as unknown as Edl
    await applyEdl({ edl: multicam, output: "video", quality: "final", jobId: "job-mem-mc", checkpoint: false, chunkThreshold: 1, maxSegmentsPerChunk: 3 })
    const chunks = fx.launches.filter((l) => /\/chunk-\d+\.mp4$/.test(l.out))
    // chunk 0 = s0 s1 s2 (camera A + the master: 2 inputs); chunk 1 = s3 s4 (B and C + the master: 3)
    expect(chunks.map((c) => c.opts?.peakMemoryMiB)).toEqual([
      canvasPeakMemoryMiB(FHD, 3, same(32), { cameraMegapixels: CAM, inputs: 2 }),
      canvasPeakMemoryMiB(FHD, 2, same(32), { cameraMegapixels: CAM, inputs: 3 }),
    ])
  })

  it("behaviorally: the render probes each picture source's size, so 4K cameras are charged x4 and 1080p ones are not; a probe that cannot answer means 4K", async () => {
    fx.canvas = FHD
    fx.threads = same(32)
    const edlOf = (): Edl => ({
      version: 1, clock: "master",
      sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }, { id: "B", url: "https://f.test/b.mp4", kind: "video" }, { id: "MIC", url: "https://f.test/m.wav", kind: "audio", role: "master-audio" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 2000, video: "A" }, { id: "s1", inMs: 2000, outMs: 4000, video: "B" }, { id: "s2", inMs: 4000, outMs: 6000, video: "B" },
      ] as EdlSegment[],
    } as unknown as Edl)
    const reservedAt = async (answer: string): Promise<number> => {
      fx.launches = []
      fx.cameraSize = answer
      await applyEdl({ edl: edlOf(), output: "video", quality: "final", jobId: "job-mem-4k", checkpoint: false })
      const picture = fx.launches.filter((l) => /\/chunk-0\.mp4$/.test(l.out))
      expect(picture).toHaveLength(1)
      return picture[0]!.opts!.peakMemoryMiB!
    }
    const at1080 = canvasPeakMemoryMiB(FHD, 3, same(32), { inputs: 3, cameraMegapixels: CAM })
    expect(await reservedAt("1920x1080\n")).toBe(at1080)
    expect(await reservedAt("1280x720\n")).toBe(at1080)
    expect(await reservedAt("3840x2160\n")).toBe(canvasPeakMemoryMiB(FHD, 3, same(32), { inputs: 3, cameraMegapixels: cameraMegapixelsOf(UHD) }))
    expect(await reservedAt("3840x2160\n")).toBe(at1080 + 2 * 30 * 9 * 3)
    expect(await reservedAt("")).toBe(await reservedAt("3840x2160\n")) // unreadable = 4K
    expect(await reservedAt("N/A\n")).toBe(await reservedAt("3840x2160\n"))
    fx.cameraSize = "1920x1080\n"
  })

  it("behaviorally: a single-chunk render (inline audio) predicts too", async () => {
    fx.canvas = FHD
    fx.threads = same(2)
    await applyEdl({ edl: edl(4), output: "video", quality: "final", jobId: "job-mem", checkpoint: false })
    const picture = fx.launches.filter((l) => /\/chunk-0\.mp4$/.test(l.out))
    expect(picture).toHaveLength(1)
    expect(picture[0]!.opts?.peakMemoryMiB).toBe(canvasPeakMemoryMiB(FHD, 4, same(2), { cameraMegapixels: CAM, inputs: 1 }))
  })
})

describe("census: every caller of the memory model states its input count", () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  const SRC = join(HERE, "..", "..", "..")
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : walk(path)
      return path.endsWith(".ts") ? [path] : []
    })
  /** The text of each `canvasPeakMemoryMiB(...)` call in a file (balanced parentheses). */
  const callsIn = (source: string): string[] => {
    const calls: string[] = []
    for (const m of source.matchAll(/(?<![\w.])canvasPeakMemoryMiB\(/g)) {
      let depth = 1
      let i = m.index! + m[0].length
      while (depth > 0 && i < source.length) {
        if (source[i] === "(") depth++
        else if (source[i] === ")") depth--
        i++
      }
      calls.push(source.slice(m.index!, i))
    }
    return calls
  }

  it("the type forces it (the argument is required); this scan keeps `inputs` from being passed as a bare default", () => {
    const sites: Array<{ file: string; call: string }> = []
    for (const file of walk(SRC)) {
      if (file.endsWith("ffmpeg-memory-model.ts")) continue
      for (const call of callsIn(readFileSync(file, "utf8"))) sites.push({ file: file.slice(SRC.length + 1), call })
    }
    // Every production caller today: the re-encode, the yt-dlp recode, the
    // media proxy, the face detector's frame decode, the timeline slice, Mask
    // Composite (three files for the video fill, two for pixelate / blur), Video Mask (its source re-encode, its chunk split and its mask encode)
    // and Split into Chunks' constant-rate re-encode.
    expect(sites.map((s) => s.file).sort()).toEqual([
      "providers/video/edl-timeline.ts",
      "providers/video/mask-composite.ts",
      "providers/video/mask-composite.ts",
      "providers/video/split-media.ts",
      "providers/video/video-file-stages.ts",
      "providers/video/video-mask.ts",
      "providers/video/video-mask.ts",
      "providers/video/video-mask.ts",
      "providers/video/ytdlp-ffmpeg-limits.ts",
      "services/face-detect/face-detect-budget.ts",
      "services/video-proxy-encode.ts",
    ])
    for (const { file, call } of sites) {
      expect(call, `${file} must pass { inputs: ... } (1 for a launch that decodes one file)`).toMatch(/\binputs\b/)
      expect(call, `${file} must pass { cameraMegapixels: ... } (the size of the picture it decodes, undefined if unknown)`).toMatch(/\bcameraMegapixels\b/)
    }
  })

  it("the launches that decode ONE file say 1; only the timeline slice passes a counted value", () => {
    const read = (rel: string) => readFileSync(join(SRC, rel), "utf8")
    for (const rel of ["providers/video/video-file-stages.ts", "providers/video/ytdlp-ffmpeg-limits.ts", "services/face-detect/face-detect-budget.ts", "services/video-proxy-encode.ts", "providers/video/video-mask.ts", "providers/video/split-media.ts"]) {
      for (const call of callsIn(read(rel))) {
        expect(call, rel).toMatch(/inputs:\s*1\b/)
        expect(call, rel).toMatch(/cameraMegapixels:\s*cameraMegapixelsOf\(/)
      }
    }
    const slice = callsIn(read("providers/video/edl-timeline.ts"))
    expect(slice).toHaveLength(1)
    expect(slice[0]).toMatch(/inputs:\s*basis\.inputs/)
    expect(slice[0]).toMatch(/cameraMegapixels:\s*basis\.cameraMegapixels/)
    // ...and the render hands every picture slice the sizes it probed
    const timeline = read("providers/video/edl-timeline.ts")
    const picture = timeline.slice(timeline.indexOf("const cmd = buildSliceCommand(edl, chunks[c]"))
    expect(picture.slice(0, 700)).toMatch(/\bsourceSizes\b/)
    expect(timeline).toMatch(/sourceSizes\.set\(id, size\)/)
  })
})
