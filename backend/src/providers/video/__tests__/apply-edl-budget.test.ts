// apply-edl's liveness budget is built from the kill budgets of its own
// bounded steps. The video worker's
// pre-task heartbeat stops beating at a cap so a hung handler ages into the
// reconcile sweep; the DEFAULT cap (the orchestrator's 90-min node ceiling)
// is far shorter than a legitimate final-quality render of a long episode on a
// direct lane, and a cap sized by guesswork ("~2× real time") was a second
// hung-detector that disagreed with the renderer's own (6× output per chunk).
// So the handler declares `applyEdlRenderBudgetMs(edl)` — the sum of the kill
// budgets of its BOUNDED steps, the per-chunk figure being the SAME one
// `renderSlice` hands `runFfmpeg` over the SAME chunk plan
// (`resolveChunksForOutput` — a video render caps graph width at
// `VIDEO_FILTERGRAPH_MAX_SEGMENTS` and, when that makes it multi-chunk, adds one
// continuous audio pass + mux). Storage I/O and ffmpeg-slot waits have no
// ceiling to add; they are the stated residual, not part of this sum.
import { describe, it, expect } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"
import {
  applyEdlRenderBudgetMs,
  audioMuxTimeoutMs,
  chunkRenderTimeoutMs,
  planChunks,
  referencedSourceIds,
  resolveChunks,
  resolveChunksForOutput,
  APPLY_EDL_CANVAS_PROBE_MS,
  APPLY_EDL_PER_SOURCE_PREP_MS,
  CHUNK_RENDER_MARGIN,
  CHUNK_RENDER_SECS_PER_AUDIO_OUTPUT_SEC,
  CHUNK_RENDER_SECS_PER_AUDIO_SPAN_SEC,
  CHUNK_RENDER_SECS_PER_OUTPUT_SEC,
  CHUNK_RENDER_SECS_PER_VIDEO_SPAN_SEC,
  CHUNK_RENDER_TIMEOUT_FLOOR_MS,
  INPUT_SEEK_MARGIN_SEC,
  LIVENESS_CANVAS,
  canvasPixelFactor,
  chunkBudgetMs,
  chunkDecodeSpanSec,
  chunkOutputSec,
  DEFAULT_CHUNK_THRESHOLD,
  DEFAULT_MAX_SEGMENTS_PER_CHUNK,
  VIDEO_FILTERGRAPH_MAX_SEGMENTS,
  AUDIO_MUX_SECS_PER_OUTPUT_SEC,
} from "../apply-edl.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS, FFPROBE_TIMEOUT_MS } from "../ffmpeg-utils.js"

const MIN = 60_000

/** `n` hard-cut segments of `segSec` seconds each, all on source A. */
function cuts(n: number, segSec: number): Edl {
  const segments: EdlSegment[] = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, inMs: i * segSec * 1000, outMs: (i + 1) * segSec * 1000, video: "A",
  }))
  return { version: 1, clock: "master", sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }], segments } as unknown as Edl
}

/** The chunk plan spelled out independently of `resolveChunksForOutput`, so a
 *  change to the thresholds, the VIDEO width cap, or the resolver shows up as a
 *  disagreement here. A video render caps every graph at
 *  `VIDEO_FILTERGRAPH_MAX_SEGMENTS`; audio is uncapped. */
function chunksOf(edl: Edl, output: "video" | "audio" = "video"): EdlSegment[][] {
  const cap = output === "video" ? VIDEO_FILTERGRAPH_MAX_SEGMENTS : Infinity
  const threshold = Math.min(DEFAULT_CHUNK_THRESHOLD, cap)
  const maxPer = Math.min(DEFAULT_MAX_SEGMENTS_PER_CHUNK, cap)
  return edl.segments.length > threshold
    ? planChunks(edl.segments, maxPer)
    : [edl.segments as EdlSegment[]]
}

describe("resolveChunks — the raw threshold rule (uncapped)", () => {
  it.each([1, 200, 201, 1000])("matches the threshold rule for a %i-segment edit", (n) => {
    expect(resolveChunks(cuts(n, 60).segments)).toEqual(
      cuts(n, 60).segments.length > DEFAULT_CHUNK_THRESHOLD
        ? planChunks(cuts(n, 60).segments, DEFAULT_MAX_SEGMENTS_PER_CHUNK)
        : [cuts(n, 60).segments],
    )
  })
})

describe("resolveChunksForOutput — video caps the graph width, audio does not", () => {
  it.each([1, 30, 31, 250, 1000])("a video render matches the capped plan for a %i-segment edit", (n) => {
    expect(resolveChunksForOutput(cuts(n, 1).segments, "video")).toEqual(chunksOf(cuts(n, 1), "video"))
  })
  it("no video graph exceeds VIDEO_FILTERGRAPH_MAX_SEGMENTS", () => {
    for (const c of resolveChunksForOutput(cuts(250, 1).segments, "video")) {
      expect(c.length).toBeLessThanOrEqual(VIDEO_FILTERGRAPH_MAX_SEGMENTS)
    }
  })
  it("an audio render is uncapped — same plan as resolveChunks", () => {
    expect(resolveChunksForOutput(cuts(250, 1).segments, "audio")).toEqual(resolveChunks(cuts(250, 1).segments))
  })
  it("an explicit smaller maxSegmentsPerChunk still wins over the cap", () => {
    for (const c of resolveChunksForOutput(cuts(90, 1).segments, "video", { maxSegmentsPerChunk: 10, chunkThreshold: 1 })) {
      expect(c.length).toBeLessThanOrEqual(10)
    }
  })
})

describe("the prep terms are the ceilings of the steps they name", () => {
  it("per source: one fetch + the audio-stream probe + probeStreamEnds (listing + 2 packet scans); once per render: the resolution and fps probes", () => {
    expect(APPLY_EDL_PER_SOURCE_PREP_MS).toBe(DOWNLOAD_TIMEOUT_MS + 2 * FFPROBE_TIMEOUT_MS + 2 * DEFAULT_FFMPEG_TIMEOUT_MS)
    expect(APPLY_EDL_CANVAS_PROBE_MS).toBe(2 * FFPROBE_TIMEOUT_MS)
  })
})

const HD30 = { width: 1920, height: 1080, fps: 30 } as const
const VIDEO_ONLY = { video: true, audio: false } as const
const BOTH = { video: true, audio: true } as const
const AUDIO_ONLY = { video: false, audio: true } as const

/** Segments at explicit source windows (seconds), all on source A. */
function windows(ws: Array<[number, number]>): Edl {
  const segments = ws.map(([a, b], i) => ({ id: `w${i}`, inMs: a * 1000, outMs: b * 1000, video: "A" })) as EdlSegment[]
  return { version: 1, clock: "master", sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }], segments } as unknown as Edl
}

describe("chunkDecodeSpanSec — the source a slice decodes, as the render seeks it", () => {
  it("a contiguous chunk decodes from its first read (less the seek margin, floored at 0) to its last", () => {
    const e = cuts(3, 60) // A [0, 180) s
    expect(chunkDecodeSpanSec(e, e.segments, VIDEO_ONLY)).toEqual({ videoSec: 180, audioSec: 0 })
    const late = windows([[100, 110], [110, 130]])
    expect(chunkDecodeSpanSec(late, late.segments, VIDEO_ONLY).videoSec).toBe(130 - (100 - INPUT_SEEK_MARGIN_SEC))
  })

  it("a SPARSE chunk decodes the whole span between its windows — the cost an output-only limit cannot see", () => {
    const sparse = windows(Array.from({ length: 30 }, (_, k) => [k * 360, k * 360 + 1] as [number, number])) // 30 × 1 s over ~3 h
    expect(chunkOutputSec(sparse.segments)).toBe(30)
    expect(chunkDecodeSpanSec(sparse, sparse.segments, VIDEO_ONLY).videoSec).toBe(29 * 360 + 1)
  })

  it("sums every input, applies each source's offset, and resolves the sound to the master", () => {
    const e = {
      version: 1, clock: "master",
      sources: [
        { id: "A", url: "https://f.test/a.mp4", kind: "video", offsetMs: 10_000 },
        { id: "B", url: "https://f.test/b.mp4", kind: "video" },
        { id: "MIC", url: "https://f.test/m.m4a", kind: "audio", role: "master-audio" },
      ],
      segments: [
        { id: "s0", inMs: 20_000, outMs: 30_000, video: "A" }, // A reads [10, 20) s
        { id: "s1", inMs: 30_000, outMs: 40_000, video: "B" }, // B reads [30, 40) s
      ],
    } as unknown as Edl
    expect(chunkDecodeSpanSec(e, e.segments, BOTH)).toEqual({ videoSec: (20 - 8) + (40 - 28), audioSec: 40 - 18 })
    expect(chunkDecodeSpanSec(e, e.segments, VIDEO_ONLY).audioSec).toBe(0) // a picture-only chunk decodes no sound
    expect(chunkDecodeSpanSec(e, e.segments, AUDIO_ONLY).videoSec).toBe(0) // an audio slice decodes no picture
  })
})

describe("chunkBudgetMs — the kill budget for a slice's work", () => {
  it("is MARGIN × (output cost + decode cost), floored", () => {
    const work = { outputSec: 100, encodesVideo: true, videoSpanSec: 400, audioSpanSec: 200, pixelFactor: 1 }
    const expected = Math.ceil(CHUNK_RENDER_MARGIN * (CHUNK_RENDER_SECS_PER_OUTPUT_SEC * 100
      + CHUNK_RENDER_SECS_PER_VIDEO_SPAN_SEC * 400 + CHUNK_RENDER_SECS_PER_AUDIO_SPAN_SEC * 200)) * 1000
    expect(chunkBudgetMs(work)).toBe(Math.max(CHUNK_RENDER_TIMEOUT_FLOOR_MS, expected))
    expect(chunkBudgetMs({ outputSec: 1, encodesVideo: true, videoSpanSec: 1, audioSpanSec: 0, pixelFactor: 1 })).toBe(CHUNK_RENDER_TIMEOUT_FLOOR_MS)
  })

  it("an audio-only slice is charged the sound cost, not the picture encode cost", () => {
    const audio = chunkBudgetMs({ outputSec: 3600, encodesVideo: false, videoSpanSec: 0, audioSpanSec: 3600, pixelFactor: 1 })
    const video = chunkBudgetMs({ outputSec: 3600, encodesVideo: true, videoSpanSec: 0, audioSpanSec: 3600, pixelFactor: 1 })
    expect(audio).toBeLessThan(video / 5)
    expect(CHUNK_RENDER_SECS_PER_AUDIO_OUTPUT_SEC).toBeLessThan(CHUNK_RENDER_SECS_PER_OUTPUT_SEC)
  })

  // Measured on the production-pinned ffmpeg n8.1.2 (docker edl-ff:arm64,
  // --cpus=2, the real buildSliceCommand graph + encode args, 2026-09-24, on a
  // heavily loaded host — so these wall clocks are high, not low). The worst of
  // up to 3 runs. Every measured shape must get at least 3× its wall clock, so a
  // real chunk is never killed as "hung". Harness: scratchpad floor/ (gen2.mts +
  // run2.mjs) of the session that set these constants.
  const MEASURED: ReadonlyArray<{ shape: string; outputSec: number; encodesVideo: boolean; videoSpanSec: number; audioSpanSec: number; pixelFactor: number; wallSec: number }> = [
    { shape: "dense 30 cuts 1080p30, picture", outputSec: 47, encodesVideo: true, videoSpanSec: 58, audioSpanSec: 0, pixelFactor: canvasPixelFactor(HD30), wallSec: 58.4 },
    { shape: "dense 30 cuts 1080p30, picture + sound", outputSec: 47, encodesVideo: true, videoSpanSec: 58, audioSpanSec: 58, pixelFactor: canvasPixelFactor(HD30), wallSec: 60.0 },
    { shape: "dense 30 cuts 1080p60, picture", outputSec: 47, encodesVideo: true, videoSpanSec: 58, audioSpanSec: 0, pixelFactor: canvasPixelFactor({ width: 1920, height: 1080, fps: 60 }), wallSec: 96.4 },
    { shape: "dense 30 cuts 4K30, picture (~4.5× the 1080p cost)", outputSec: 47, encodesVideo: true, videoSpanSec: 58, audioSpanSec: 0, pixelFactor: canvasPixelFactor({ width: 3840, height: 2160, fps: 30 }), wallSec: 265.5 },
    { shape: "dense 30 cuts 720p30, picture + sound", outputSec: 47, encodesVideo: true, videoSpanSec: 58, audioSpanSec: 58, pixelFactor: canvasPixelFactor(HD30), wallSec: 56.4 },
    { shape: "multicam, 2 cameras, 1080p30", outputSec: 76, encodesVideo: true, videoSpanSec: 161, audioSpanSec: 0, pixelFactor: canvasPixelFactor(HD30), wallSec: 123.0 },
    { shape: "multicam, 3 cameras + sound, 1080p30", outputSec: 76, encodesVideo: true, videoSpanSec: 232, audioSpanSec: 83, pixelFactor: canvasPixelFactor(HD30), wallSec: 113.2 },
    { shape: "every boundary a crossfade, 1080p30 + sound", outputSec: 46, encodesVideo: true, videoSpanSec: 131, audioSpanSec: 68, pixelFactor: canvasPixelFactor(HD30), wallSec: 78.7 },
    { shape: "30 × 10 s, 1080p30", outputSec: 300, encodesVideo: true, videoSpanSec: 308, audioSpanSec: 0, pixelFactor: canvasPixelFactor(HD30), wallSec: 348.5 },
    { shape: "30 × 60 s (30 min out), 1080p30", outputSec: 1800, encodesVideo: true, videoSpanSec: 1808, audioSpanSec: 0, pixelFactor: canvasPixelFactor(HD30), wallSec: 2216.3 },
    { shape: "sparse 30 × 1 s over 5 min, 1080p30", outputSec: 30, encodesVideo: true, videoSpanSec: 302, audioSpanSec: 0, pixelFactor: canvasPixelFactor(HD30), wallSec: 66.5 },
    { shape: "sparse 30 × 1 s over 30 min, 1080p30 + sound", outputSec: 30, encodesVideo: true, videoSpanSec: 1802, audioSpanSec: 1802, pixelFactor: canvasPixelFactor(HD30), wallSec: 253.5 },
    { shape: "sparse 30 × 1 s over 9.5 min, 4K30", outputSec: 30, encodesVideo: true, videoSpanSec: 572, audioSpanSec: 0, pixelFactor: canvasPixelFactor({ width: 3840, height: 2160, fps: 30 }), wallSec: 353.2 },
    { shape: "sparse 30 × 1 s over 11.5 min, 1080p60", outputSec: 30, encodesVideo: true, videoSpanSec: 692, audioSpanSec: 0, pixelFactor: canvasPixelFactor({ width: 1920, height: 1080, fps: 60 }), wallSec: 169.0 },
    { shape: "sparse 30 × 1 s over 30 min on 3 cameras, 1080p30", outputSec: 30, encodesVideo: true, videoSpanSec: 5034, audioSpanSec: 0, pixelFactor: canvasPixelFactor(HD30), wallSec: 711.9 },
    { shape: "audio slice, 100 × 1 s contiguous from the master", outputSec: 99, encodesVideo: false, videoSpanSec: 0, audioSpanSec: 117, pixelFactor: 1, wallSec: 11.9 },
    { shape: "sparse 30 × 1 s over 179 min, 1080p30 + sound (killed by the old 20-min floor)", outputSec: 30, encodesVideo: true, videoSpanSec: 10742, audioSpanSec: 10742, pixelFactor: canvasPixelFactor(HD30), wallSec: 1517.7 },
  ]
  it.each(MEASURED)("gives a measured real chunk at least 3× its wall clock — $shape", (m) => {
    expect(chunkBudgetMs(m) / 1000).toBeGreaterThanOrEqual(3 * m.wallSec)
  })
})

describe("canvasPixelFactor — how much more picture work a canvas is than 1080p30", () => {
  it("1080p30 = 1, 1080p60 = 2, 4K30 = 4; a smaller canvas keeps the 1080p30 rates; anything above 4K30 is charged 4K30", () => {
    expect(canvasPixelFactor(HD30)).toBe(1)
    expect(canvasPixelFactor({ width: 1920, height: 1080, fps: 60 })).toBe(2)
    expect(canvasPixelFactor(LIVENESS_CANVAS)).toBe(4)
    expect(canvasPixelFactor({ width: 1280, height: 720, fps: 30 })).toBe(1)
    expect(canvasPixelFactor({ width: 3840, height: 2160, fps: 60 })).toBe(4)
    expect(canvasPixelFactor({ width: NaN, height: 1080, fps: 30 })).toBe(4) // unreadable → the safe ceiling
  })

  it("a 4K chunk gets ~4× the 1080p kill budget, so a 1080p hang is still caught fast", () => {
    const e = cuts(30, 2)
    const hd = chunkRenderTimeoutMs(e, e.segments, VIDEO_ONLY, HD30)
    const uhd = chunkRenderTimeoutMs(e, e.segments, VIDEO_ONLY, LIVENESS_CANVAS)
    expect(uhd).toBeGreaterThan(3.5 * hd)
  })
})

describe("chunkRenderTimeoutMs — the kill budget one chunk gets", () => {
  it("is chunkBudgetMs of the chunk's own output and decode spans", () => {
    const e = cuts(30, 2)
    const { videoSec, audioSec } = chunkDecodeSpanSec(e, e.segments, BOTH)
    expect(chunkRenderTimeoutMs(e, e.segments, BOTH, HD30)).toBe(chunkBudgetMs({ outputSec: 60, encodesVideo: true, videoSpanSec: videoSec, audioSpanSec: audioSec, pixelFactor: 1 }))
  })

  it("subtracts crossfade overlaps (D17) from the output it charges", () => {
    const long = cuts(40, 60)
    const faded = { ...long, segments: long.segments.map((s, i) => (i > 0 ? { ...s, transition: { type: "crossfade" as const, durationMs: 4000 } } : s)) } as Edl
    expect(chunkRenderTimeoutMs(faded, faded.segments, VIDEO_ONLY, HD30)).toBeLessThan(chunkRenderTimeoutMs(long, long.segments, VIDEO_ONLY, HD30))
  })

  it("a sparse chunk gets far more than a dense one of the same output — the old flat floor killed it", () => {
    const sparse = windows(Array.from({ length: 30 }, (_, k) => [k * 360, k * 360 + 1] as [number, number]))
    const dense = windows(Array.from({ length: 30 }, (_, k) => [k, k + 1] as [number, number]))
    expect(chunkRenderTimeoutMs(sparse, sparse.segments, BOTH, HD30)).toBeGreaterThan(20 * MIN) // the old floor
    expect(chunkRenderTimeoutMs(dense, dense.segments, BOTH, HD30)).toBeLessThan(10 * MIN)
  })
})

describe("applyEdlRenderBudgetMs — the handler's liveness budget", () => {
  // Declared at dispatch, before any source is probed: every chunk is charged
  // at LIVENESS_CANVAS (4K30), the most a chunk's kill budget can assume.
  it("is never less than the kill budget any real canvas gives a chunk", () => {
    const e = cuts(30, 2)
    for (const canvas of [HD30, { width: 1280, height: 720, fps: 30 }, { width: 1920, height: 1080, fps: 60 }, LIVENESS_CANVAS, { width: 3840, height: 2160, fps: 60 }, { width: 7680, height: 4320, fps: 30 }]) {
      expect(chunkRenderTimeoutMs(e, e.segments, BOTH, canvas)).toBeLessThanOrEqual(chunkRenderTimeoutMs(e, e.segments, BOTH, LIVENESS_CANVAS))
    }
  })

  it.each([1, 250, 1000])("covers every chunk's kill budget for a %i-segment edit (the SAME chunk plan the render uses)", (n) => {
    const edl = cuts(n, 60)
    const chunks = chunksOf(edl, "video")
    const reads = chunks.length > 1 ? VIDEO_ONLY : BOTH // option B: multi-chunk video chunks carry no sound
    const renderBudget = chunks.reduce((acc, c) => acc + chunkRenderTimeoutMs(edl, c, reads, LIVENESS_CANVAS), 0)
    expect(applyEdlRenderBudgetMs(edl)).toBeGreaterThanOrEqual(renderBudget)
    // and it is exactly the bounded steps' ceilings — render + per-source prep +
    // canvas probes + (when chunked: the ffmpeg-build probe + the concat, and
    // for video every audio slice of the AUDIO plan + the one join/encode/mux)
    // — no slack invented.
    const chunked = chunks.length > 1 ? 2 * DEFAULT_FFMPEG_TIMEOUT_MS : 0
    const audioSlices = chunksOf(edl, "audio").reduce((acc, c) => acc + chunkRenderTimeoutMs(edl, c, AUDIO_ONLY, LIVENESS_CANVAS), 0)
    const audioMux = chunks.length > 1 ? audioSlices + audioMuxTimeoutMs(n * 60) : 0
    expect(applyEdlRenderBudgetMs(edl)).toBe(renderBudget + APPLY_EDL_PER_SOURCE_PREP_MS + APPLY_EDL_CANVAS_PROBE_MS + chunked + audioMux)
  })

  // An AUDIO render chunks on the uncapped plan and never runs option B's
  // separate audio pass — its chunks ARE the audio. (Dropping the
  // `output === "video"` guard would add a phantom audio pass to every long
  // audio render's budget; this pins it.)
  it.each([1, 250, 1000])("an audio-output render of %i segments counts its own chunks and no audio-mux step", (n) => {
    const edl = cuts(n, 60)
    const chunks = chunksOf(edl, "audio")
    const renderBudget = chunks.reduce((acc, c) => acc + chunkRenderTimeoutMs(edl, c, AUDIO_ONLY, LIVENESS_CANVAS), 0)
    const chunked = chunks.length > 1 ? 2 * DEFAULT_FFMPEG_TIMEOUT_MS : 0
    const prep = referencedSourceIds(edl, "audio").size * APPLY_EDL_PER_SOURCE_PREP_MS
    expect(applyEdlRenderBudgetMs(edl, { output: "audio" })).toBe(renderBudget + prep + chunked)
  })

  it("the join/encode/mux step's ceiling scales with the output, floored at the default", () => {
    expect(audioMuxTimeoutMs(30)).toBe(DEFAULT_FFMPEG_TIMEOUT_MS)
    expect(audioMuxTimeoutMs(3 * 3600)).toBe(3 * 3600 * AUDIO_MUX_SECS_PER_OUTPUT_SEC * 1000)
  })

  it("counts prep once per referenced source, including the master-audio source no segment names", () => {
    const one = cuts(1, 60)
    const withMic: Edl = {
      ...one,
      sources: [...one.sources, { id: "MIC", url: "https://f.test/mic.m4a", kind: "audio", role: "master-audio" }],
    } as Edl
    expect(applyEdlRenderBudgetMs(withMic) - applyEdlRenderBudgetMs(one)).toBe(APPLY_EDL_PER_SOURCE_PREP_MS)
  })

  // The read set is the render's own (`referencedSourceIds`): an audio-only cut
  // never downloads the picture sources and never runs the canvas probes.
  it("an audio-only render counts only the sound sources and no canvas probes — exactly what applyEdl runs", () => {
    const one = cuts(1, 60)
    const withMic: Edl = {
      ...one,
      sources: [...one.sources, { id: "MIC", url: "https://f.test/mic.m4a", kind: "audio", role: "master-audio" }],
    } as Edl
    expect(referencedSourceIds(withMic, "video")).toEqual(new Set(["A", "MIC"]))
    expect(referencedSourceIds(withMic, "audio")).toEqual(new Set(["MIC"]))
    expect(applyEdlRenderBudgetMs(withMic, { output: "video" }))
      .toBe(chunkRenderTimeoutMs(withMic, withMic.segments, BOTH, LIVENESS_CANVAS) + 2 * APPLY_EDL_PER_SOURCE_PREP_MS + APPLY_EDL_CANVAS_PROBE_MS)
    expect(applyEdlRenderBudgetMs(withMic, { output: "audio" }))
      .toBe(chunkRenderTimeoutMs(withMic, withMic.segments, AUDIO_ONLY, LIVENESS_CANVAS) + APPLY_EDL_PER_SOURCE_PREP_MS)
  })

  it("outlives the orchestrator's 90-minute node ceiling for a long final render — the case the default cap could not cover", () => {
    // A 3-hour episode cut into 180 one-minute segments: 6 picture chunks of 30
    // + one audio pass. Measured ~1.2 s of wall clock per output second.
    const threeHours = cuts(180, 60)
    expect(applyEdlRenderBudgetMs(threeHours)).toBeGreaterThan(3 * 1.23 * 3 * 60 * MIN)
  })

  // The budget tracks the real render time instead of summing a flat 20-minute
  // floor per 30-segment chunk (which budgeted a ~10,800-cut 3-hour tighten
  // ~120 h — a hung render held its worker slot that long).
  // No longer a flat 20-minute floor per 30-segment chunk (which budgeted a
  // ~10,800-cut 3-hour tighten ~120 h at ANY canvas). The liveness budget is
  // the 4K30 ceiling; a 1080p render's chunk kill budgets are ~4× tighter.
  it.each([
    [1, 10_800],
    [180, 60],
    [10_800, 1],
  ])("a 180-minute edit of %i segments: liveness at the 4K30 ceiling stays bounded; 1080p chunk limits sum far lower", (n, segSec) => {
    const edl = cuts(n, segSec)
    const livenessH = applyEdlRenderBudgetMs(edl) / 3_600_000
    expect(livenessH).toBeLessThan(110)
    const chunks = chunksOf(edl, "video")
    const reads = chunks.length > 1 ? VIDEO_ONLY : BOTH
    const hdChunksH = chunks.reduce((acc, c) => acc + chunkRenderTimeoutMs(edl, c, reads, HD30), 0) / 3_600_000
    expect(hdChunksH).toBeLessThan(30)
    expect(hdChunksH).toBeGreaterThan(3 * 1.23 * 3) // ≥ 3× the measured ~1.23 s per 1080p30 output second
  })

  it("is monotone in output length", () => {
    expect(applyEdlRenderBudgetMs(cuts(90, 60))).toBeLessThan(applyEdlRenderBudgetMs(cuts(120, 60)))
  })
})
