// The slice memory model's ZOOM term (decided 2026-10-07). A Speaker View
// zoom crops its camera to the start box and scales that window (about 1.56×
// the canvas) on every frame of the segment, so a slice that draws one holds
// more than the canvas model predicts. Measured by the Speaker View plugin's
// probes (F4b / F4c: a one-segment 1080p slice, launched with the host's
// thread counts and encoder, ffmpeg's own peak RSS):
//   2 threads (pinned n8.1.2, the 2-vCPU CI runner): +103 to +118 MiB over the
//     static slice, flat in the box (0.40 down to 0.03 of the frame width);
//   16 / 32 / 48 threads (macOS, ffmpeg 9.0.2): about +330 / +260 / +350 MiB,
//     where at 16 the zoom slice (934–945 MiB) passed the no-zoom
//     prediction (924) and at 32 (1,410–1,425) passed it by up to 134.
// The picture builder says which segments draw one (`memoryHint.zoom` on its
// fragment); a builder that says nothing gets exactly today's prediction.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"
import type { FfmpegThreads } from "../ffmpeg-threads.js"

const fx = vi.hoisted(() => ({
  launches: [] as Array<{ out: string; opts: { peakMemoryMiB?: number } | undefined }>,
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
  pickTargetResolution: async () => ({ width: 1920, height: 1080 }),
  pickTargetFps: async () => 30,
}))

import { canvasPeakMemoryMiB, zoomPeakMemoryMiB } from "../ffmpeg-memory-model.js"
import { buildSliceCommand, type SliceOptions } from "../apply-edl-slice.js"
import { renderEdlTimeline, slicePeakMemoryMiB } from "../edl-timeline.js"
import { pictureFragmentError, type EdlPictureBuilder, type EdlPictureContext } from "../edl-picture.js"
import { scalePadChain } from "../edl-picture-fullframe.js"

const FHD = { width: 1920, height: 1080 }
const PORTRAIT = { width: 1080, height: 1920 }
const UHD = { width: 3840, height: 2160 }
const same = (t: number): FfmpegThreads => ({ decode: t, filter: t, encode: t })

// [canvas, threads, zoom slice peak MiB, static slice peak MiB, where] — every
// row of the plugin's C4 tables. The pinned rows are paired per framing (box
// 0.40, 0.35, 0.19 at 9:16, 0.05, 0.03). The pinned runner is 2 vCPU: its
// harness launches at `availableParallelism()` = 2, the count its quoted
// predictor (604 MiB) is computed at — the tables' "4 threads" label does not
// match that predictor. The local rows are ranges; each is taken at its worst
// pairing (the highest zoom peak over the lowest static one). The 48-thread
// row is indicative only (its static peak sits below the 32-thread one).
const MEASURED: Array<[typeof FHD, number, number, number, string]> = [
  [FHD, 2, 535, 421, "pinned n8.1.2, box 0.40"],
  [FHD, 2, 522, 419, "pinned n8.1.2, box 0.35"],
  [PORTRAIT, 2, 539, 422, "pinned n8.1.2, box 0.19 (9:16)"],
  [FHD, 2, 526, 421, "pinned n8.1.2, box 0.05"],
  [FHD, 2, 540, 423, "pinned n8.1.2, box 0.03"],
  [FHD, 16, 945, 606, "macOS 9.0.2"],
  [FHD, 32, 1425, 1154, "macOS 9.0.2 (production's quota)"],
  [FHD, 48, 1266, 904, "macOS 9.0.2, indicative"],
]

describe("zoomPeakMemoryMiB — the zoom's own term, thread-aware", () => {
  it("is 110 + MP·(82.65 + 2.0·T) MiB, T the graph's side of the counts (decode / filter)", () => {
    const mp = (1920 * 1080) / 1e6
    expect(zoomPeakMemoryMiB(FHD, same(2))).toBeCloseTo(110 + mp * (82.65 + 2.0 * 2), 6)
    expect(zoomPeakMemoryMiB(FHD, same(32))).toBeCloseTo(110 + mp * (82.65 + 2.0 * 32), 6)
  })

  it("is at or above EVERY measured zoom term (zoom slice minus static slice)", () => {
    for (const [canvas, t, zoom, still, where] of MEASURED) {
      const term = zoomPeakMemoryMiB(canvas, same(t))
      expect(term, `${where}, ${t} threads: ${term.toFixed(1)} vs ${zoom - still}`).toBeGreaterThanOrEqual(zoom - still)
    }
  })

  it("grows with the graph's threads, not the encoder's (the zoom is filter-graph work)", () => {
    expect(zoomPeakMemoryMiB(FHD, same(32))).toBeGreaterThan(zoomPeakMemoryMiB(FHD, same(2)))
    expect(zoomPeakMemoryMiB(FHD, { decode: 2, filter: 2, encode: 32 })).toBe(zoomPeakMemoryMiB(FHD, same(2)))
    expect(zoomPeakMemoryMiB(FHD, { decode: 2, filter: 32, encode: 2 })).toBe(zoomPeakMemoryMiB(FHD, same(32)))
  })

  it("scales with the canvas (its windows are canvas-sized): a 4K zoom predicts more than a 1080p one", () => {
    expect(zoomPeakMemoryMiB(UHD, same(32))).toBeGreaterThan(zoomPeakMemoryMiB(FHD, same(32)))
  })
})

describe("canvasPeakMemoryMiB with a zoom", () => {
  it("is at or above EVERY measured zoom slice, and never wildly above", () => {
    for (const [canvas, t, zoom, , where] of MEASURED) {
      const predicted = canvasPeakMemoryMiB(canvas, 1, same(t), { zoom: true })
      const label = `${where}, ${t} threads: ${predicted} vs ${zoom}`
      expect(predicted, label).toBeGreaterThanOrEqual(zoom)
      // Four thread counts on two platforms fit loosely: the margin is set by
      // the 16-thread row, and the canvas model already sits ~1.45× over the
      // pinned 2-thread static slices, so those rows come out ~1.7× under.
      expect(predicted / zoom, label).toBeLessThan(1.75)
    }
  })

  it("the static slices of the same runs stay under the prediction without the zoom (the base model holds)", () => {
    for (const [canvas, t, , still, where] of MEASURED) {
      expect(canvasPeakMemoryMiB(canvas, 1, same(t)), where).toBeGreaterThanOrEqual(still)
    }
  })

  it("the headline point: production's quota (32 threads), 1080p, one segment predicts 1,705 MiB (measured 1,410–1,425; 1,291 without the zoom)", () => {
    expect(canvasPeakMemoryMiB(FHD, 1, same(32))).toBe(1291)
    expect(canvasPeakMemoryMiB(FHD, 1, same(32), { zoom: true })).toBe(1705)
  })

  it("is the canvas model plus the zoom term, rounded up once", () => {
    for (const t of [1, 2, 8, 32]) {
      for (const n of [1, 7, 30]) {
        const exact = 257 + (UHD.width * UHD.height / 1e6) * (136 + 8.85 * n + 11.05 * t) + zoomPeakMemoryMiB(UHD, same(t))
        expect(canvasPeakMemoryMiB(UHD, n, same(t), { zoom: true })).toBe(Math.ceil(exact - 1e-9))
      }
    }
  })

  it("no hint is today's prediction, to the MiB", () => {
    for (const t of [1, 2, 16, 32]) {
      const today = canvasPeakMemoryMiB(UHD, 30, same(t))
      expect(canvasPeakMemoryMiB(UHD, 30, same(t), {})).toBe(today)
      expect(canvasPeakMemoryMiB(UHD, 30, same(t), { zoom: false })).toBe(today)
      expect(canvasPeakMemoryMiB(UHD, 30, same(t), undefined)).toBe(today)
    }
  })
})

// ---------------------------------------------------------------------------
// The hint: the picture builder tells the timeline a segment draws a zoom.

const EDL: Edl = {
  version: 1,
  clock: "master",
  sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }],
  segments: Array.from({ length: 6 }, (_, k) => ({ id: `s${k}`, inMs: k * 1000, outMs: (k + 1) * 1000, video: "A" })),
} as unknown as Edl
const OPTS: SliceOptions = {
  output: "video", quality: "final", target: FHD, fps: 30, chunkStartMs: 0, masterAudioId: undefined, audioPresent: new Map([["A", true]]),
}
/** Draws the full frame; segments whose id is in `zoomed` say they zoom. */
const zoomingOn = (...zoomed: string[]): EdlPictureBuilder => (ctx) => ({
  chain: scalePadChain(ctx.canvas),
  ...(zoomed.includes(ctx.segment.id) ? { memoryHint: { zoom: true } } : {}),
})

describe("a picture fragment carries an optional memory hint", () => {
  const ctx = { segment: { id: "s0" }, slots: [{}], output: "[p0o]" } as unknown as EdlPictureContext
  it("a hinted chain or graph is a valid fragment", () => {
    expect(pictureFragmentError({ chain: "null", memoryHint: { zoom: true } }, ctx)).toBeUndefined()
    expect(pictureFragmentError({ graph: "[p0s0]null[p0o]", memoryHint: { zoom: true } }, ctx)).toBeUndefined()
    expect(pictureFragmentError({ chain: "null", memoryHint: {} }, ctx)).toBeUndefined()
    expect(pictureFragmentError({ chain: "null", memoryHint: { zoom: false } }, ctx)).toBeUndefined()
  })

  it("refuses a malformed hint: not an object, or a non-boolean zoom", () => {
    expect(pictureFragmentError({ chain: "null", memoryHint: "zoom" }, ctx)).toMatch(/memoryHint/)
    expect(pictureFragmentError({ chain: "null", memoryHint: { zoom: "yes" } }, ctx)).toMatch(/memoryHint\.zoom/)
  })

  it("ignores keys it does not know (forward compatibility), so a misspelled key reads as no hint", () => {
    // A newer plugin may send a hint key this host does not know yet; refusing
    // it would fail every render. The cost: a misspelled `zoom` is not caught
    // here (the TypeScript type is what catches it), and reserves no zoom term.
    expect(pictureFragmentError({ chain: "null", memoryHint: { zooms: true } }, ctx)).toBeUndefined()
    expect(pictureFragmentError({ chain: "null", memoryHint: { Zoom: true } }, ctx)).toBeUndefined()
    const misspelled: EdlPictureBuilder = (c) => ({ chain: scalePadChain(c.canvas), memoryHint: { zooms: true } as never })
    const cmd = buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: misspelled })
    expect(cmd.memoryBasis).not.toHaveProperty("zoom")
    expect(slicePeakMemoryMiB(cmd, same(32))).toBe(canvasPeakMemoryMiB(FHD, 6, same(32)))
  })
})

describe("the slice's prediction follows the hint", () => {
  it("a slice with a zoomed segment carries it in its memory basis; one without carries none", () => {
    expect(buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: zoomingOn("s2") }).memoryBasis).toEqual({ ...FHD, segments: 6, zoom: true })
    const plain = buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: zoomingOn() }).memoryBasis
    expect(plain).toEqual({ ...FHD, segments: 6 })
    expect(plain).not.toHaveProperty("zoom")
    expect(buildSliceCommand(EDL, EDL.segments, OPTS).memoryBasis).not.toHaveProperty("zoom")
  })

  it("charges the zoom once per slice, at the launch's threads — carried (rest) segments included", () => {
    const one = buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: zoomingOn("s2") })
    const many = buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: zoomingOn("s2", "s3", "s4") })
    for (const t of [2, 32]) {
      expect(slicePeakMemoryMiB(one, same(t))).toBe(canvasPeakMemoryMiB(FHD, 6, same(t), { zoom: true }))
      expect(slicePeakMemoryMiB(many, same(t))).toBe(slicePeakMemoryMiB(one, same(t)))
    }
  })

  it("the hint is not part of what renders: the graph and the output are the unhinted slice's", () => {
    const hinted = buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: zoomingOn("s0", "s5") })
    const plain = buildSliceCommand(EDL, EDL.segments, { ...OPTS, picture: zoomingOn() })
    expect(hinted.filterGraph).toBe(plain.filterGraph)
    expect(hinted.outputArgs).toEqual(plain.outputArgs)
    expect(slicePeakMemoryMiB(plain, same(32))).toBe(canvasPeakMemoryMiB(FHD, 6, same(32)))
  })

  it("a sound-only slice still predicts nothing", () => {
    const cmd = buildSliceCommand(EDL, EDL.segments, { ...OPTS, output: "audio", audioCodec: "pcm", picture: zoomingOn("s1") })
    expect(cmd.memoryBasis).toBeUndefined()
  })
})

describe("behaviorally: a chunked render reserves the zoom term on exactly the chunks that draw one", () => {
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

  it("chunks [s0 s1 s2] [s3 s4 s5] [s6], zoom on s4: only the middle chunk reserves the zoom", async () => {
    fx.threads = same(32)
    await renderEdlTimeline({
      edl: edl(7), output: "video", quality: "final", jobId: "job-zoom", checkpoint: false, chunkThreshold: 1, maxSegmentsPerChunk: 3,
      picture: zoomingOn("s4"), label: "speaker-view", canvas: FHD,
    })
    const chunks = fx.launches.filter((l) => /\/chunk-\d+\.mp4$/.test(l.out))
    expect(chunks.map((c) => c.opts?.peakMemoryMiB)).toEqual([
      canvasPeakMemoryMiB(FHD, 3, same(32)),
      canvasPeakMemoryMiB(FHD, 3, same(32), { zoom: true }),
      canvasPeakMemoryMiB(FHD, 1, same(32)),
    ])
  })
})
