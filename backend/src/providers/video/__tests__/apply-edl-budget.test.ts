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
// (`resolveChunksForOutput` — every graph is capped at
// `VIDEO_FILTERGRAPH_MAX_SEGMENTS` / `AUDIO_FILTERGRAPH_MAX_SEGMENTS`; a chunked
// video render adds one continuous audio pass + mux, a chunked audio render one
// join + encode). Storage I/O and ffmpeg-slot waits have no
// ceiling to add; they are the stated residual, not part of this sum.
import { describe, it, expect } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"
import { edlDurationMs, validateEdl } from "@nodaro/shared"
import { boundaryOverlapSecs, type PlanSegment } from "../apply-edl-budget.js"
import {
  applyEdlRenderBudgetMs,
  audioMuxTimeoutMs,
  chunkRenderTimeoutMs,
  planChunks,
  referencedSourceIds,
  splitInsideCrossfadeRun,
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
  AUDIO_FILTERGRAPH_MAX_SEGMENTS,
  VIDEO_FILTERGRAPH_MAX_SEGMENTS,
  WIDE_SLICE_FLOOR_MS,
  WIDE_SLICE_SECS_PER_OUTPUT_SEC,
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
 *  change to either cap or the resolver shows up as a disagreement here: ONE
 *  pass at or below the output's cap, else slices of at most the cap. */
function chunksOf(edl: Edl, output: "video" | "audio" = "video"): EdlSegment[][] {
  const cap = output === "video" ? VIDEO_FILTERGRAPH_MAX_SEGMENTS : AUDIO_FILTERGRAPH_MAX_SEGMENTS
  return edl.segments.length > cap ? planChunks(edl.segments, cap) : [edl.segments as EdlSegment[]]
}

describe("resolveChunksForOutput — every graph is capped, picture and sound alike", () => {
  it.each([1, 30, 31, 180, 250, 1000])("a %i-segment edit matches the capped plan for both outputs", (n) => {
    expect(resolveChunksForOutput(cuts(n, 1).segments, "video")).toEqual(chunksOf(cuts(n, 1), "video"))
    expect(resolveChunksForOutput(cuts(n, 1).segments, "audio")).toEqual(chunksOf(cuts(n, 1), "audio"))
  })
  it.each(["video", "audio"] as const)("no pure-cut %s graph exceeds its cap", (output) => {
    const cap = output === "video" ? VIDEO_FILTERGRAPH_MAX_SEGMENTS : AUDIO_FILTERGRAPH_MAX_SEGMENTS
    for (const n of [31, 180, 199, 200, 201, 250, 1000]) {
      for (const c of resolveChunksForOutput(cuts(n, 1).segments, output)) expect(c.length).toBeLessThanOrEqual(cap)
    }
  })
  // The measured reason for the audio cap: a slice's cost grows with
  // segments² × decoded span, so the 180-cut 3-hour edit that a 200-segment
  // threshold rendered in ONE 88.7-minute pass must never be one graph again.
  it("a 180-cut 3-hour edit's sound renders as six 30-segment slices, not one pass", () => {
    const plan = resolveChunksForOutput(cuts(180, 60).segments, "audio")
    expect(plan.map((c) => c.length)).toEqual([30, 30, 30, 30, 30, 30])
  })
  it("an explicit smaller option still wins over the cap; a larger one cannot raise it", () => {
    for (const output of ["video", "audio"] as const) {
      for (const c of resolveChunksForOutput(cuts(90, 1).segments, output, { maxSegmentsPerChunk: 10, chunkThreshold: 1 })) {
        expect(c.length).toBeLessThanOrEqual(10)
      }
      const cap = output === "video" ? VIDEO_FILTERGRAPH_MAX_SEGMENTS : AUDIO_FILTERGRAPH_MAX_SEGMENTS
      expect(resolveChunksForOutput(cuts(90, 1).segments, output, { maxSegmentsPerChunk: 500, chunkThreshold: 500 }))
        .toEqual(planChunks(cuts(90, 1).segments, cap))
    }
  })
})

/** `n` segments of `segMs` on source A, every boundary a `xfadeMs` crossfade —
 *  what the node's Default crossfade makes of an edit: ONE continuous run. */
function crossfadeRun(n: number, segMs: number, xfadeMs: number): Edl {
  const segments = Array.from({ length: n }, (_, i) => ({
    id: `x${i}`, inMs: i * segMs, outMs: (i + 1) * segMs, video: "A",
    ...(i > 0 ? { transition: { type: "crossfade" as const, durationMs: xfadeMs } } : {}),
  })) as EdlSegment[]
  return { version: 1, clock: "master", sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }], segments } as unknown as Edl
}

// The one slice the caps cannot always bound: a crossfade run whose segments
// are too short for their crossfades to take a cut (`splitInsideCrossfadeRun`)
// renders as ONE graph of any width, and its cost grows faster than linearly
// with that width (review of #1623 on the pinned 8.1.2: 300 × 200 ms
// all-crossfade audio ran past a 120 s limit with 16 of 45 s rendered). It
// keeps production's former limit as a floor, on its own output.
describe("a slice wider than its cap (an unsplittable crossfade run) keeps production's former limit as a floor", () => {
  const prodLimitMs = (edl: Edl) => Math.max(20 * MIN, Math.ceil(chunkOutputSec(edl.segments) * 6) * 1000)
  it("the floor IS production's former per-chunk limit: max(20 min, 6 × output)", () => {
    expect(WIDE_SLICE_FLOOR_MS).toBe(20 * MIN)
    expect(WIDE_SLICE_SECS_PER_OUTPUT_SEC).toBe(6)
  })
  it.each(["video", "audio"] as const)("a %s run of 1 s segments under 0.9 s crossfades (the most a 1 s clip allows) cannot be cut and stays one graph", (output) => {
    const run = crossfadeRun(300, 1000, 900)
    expect(resolveChunksForOutput(run.segments, output).map((c) => c.length)).toEqual([300])
  })
  it.each([
    ["an audio slice", AUDIO_ONLY],
    ["a picture chunk", VIDEO_ONLY],
    ["a single-pass picture + sound render", BOTH],
  ] as const)("%s wider than its cap never gets less than production's former limit", (_label, reads) => {
    for (const [n, segMs] of [[31, 200], [300, 200], [400, 150], [250, 200], [120, 60_000]] as const) {
      const run = crossfadeRun(n, segMs, 50)
      for (const canvas of [HD30, LIVENESS_CANVAS]) {
        expect(chunkRenderTimeoutMs(run, run.segments, reads, canvas)).toBeGreaterThanOrEqual(prodLimitMs(run))
      }
    }
  })
  it("a slice at the cap keeps the linear budget — the floor is only for what the cap cannot split", () => {
    const run = crossfadeRun(30, 200, 50)
    expect(chunkRenderTimeoutMs(run, run.segments, AUDIO_ONLY, HD30)).toBeLessThan(WIDE_SLICE_FLOOR_MS)
    const hardCuts = cuts(30, 1)
    expect(chunkRenderTimeoutMs(hardCuts, hardCuts.segments, VIDEO_ONLY, HD30)).toBeLessThan(WIDE_SLICE_FLOOR_MS)
  })
  it("the liveness budget carries the floor too — the render and its hung-detector agree", () => {
    const run = crossfadeRun(300, 1000, 900)
    expect(applyEdlRenderBudgetMs(run, { output: "audio" }))
      .toBe(chunkRenderTimeoutMs(run, run.segments, AUDIO_ONLY, LIVENESS_CANVAS) + referencedSourceIds(run, "audio").size * APPLY_EDL_PER_SOURCE_PREP_MS)
    expect(applyEdlRenderBudgetMs(run, { output: "audio" })).toBeGreaterThanOrEqual(prodLimitMs(run))
  })
})

// Plan B2: a crossfade run past the cap is closed by cutting one of its
// segments in two at an invisible hard cut, so no graph is wider than its cap
// and the kill budget stays linear. Nothing about the output may move: every
// crossfade keeps its exact overlap, the length is unchanged, and the two
// halves read the whole segment's source time between them.
describe("a crossfade run past the cap is cut inside one of its segments (B2)", () => {
  const baseId = (id: string) => id.replace(/~[12]$/, "")
  const flatten = (chunks: readonly (readonly PlanSegment[])[]) => chunks.flat()

  it.each(["video", "audio"] as const)("no %s graph is wider than its cap for a 300-segment all-crossfade edit", (output) => {
    const run = crossfadeRun(300, 200, 50)
    const plan = resolveChunksForOutput(run.segments, output)
    expect(plan.length).toBeGreaterThan(1)
    for (const c of plan) expect(c.length).toBeLessThanOrEqual(30)
  })

  it.each([
    [300, 200, 50], [300, 200, 90], [120, 2000, 1500], [90, 617, 300], [61, 33, 20], [400, 150, 50],
  ] as const)("keeps every crossfade's exact overlap and the total length (%i × %i ms, %i ms crossfades)", (n, segMs, xfadeMs) => {
    const run = crossfadeRun(n, segMs, xfadeMs)
    const original = run.segments
    const overlapInto = new Map(original.map((s, i) => [s.id, i > 0 ? boundaryOverlapSecs(s, original[i - 1]) : 0]))
    const plan = resolveChunksForOutput(original, "video")
    const flat = flatten(plan)
    for (let k = 1; k < flat.length; k++) {
      const [a, b] = [flat[k - 1], flat[k]]
      if (b.splitLeadMs) {
        // The new cut: the two halves of ONE segment, a hard cut between them.
        expect(baseId(a.id)).toBe(baseId(b.id))
        expect(boundaryOverlapSecs(b, a)).toBe(0)
      } else {
        expect(boundaryOverlapSecs(b, a)).toBe(overlapInto.get(baseId(b.id)))
      }
    }
    const planned = plan.reduce((acc, c) => acc + chunkOutputSec(c), 0)
    expect(planned).toBeCloseTo(edlDurationMs(run) / 1000, 9)
  })

  it("the two halves cover the segment's source time exactly, and the tail's picture lead is its head", () => {
    const run = crossfadeRun(300, 200, 50)
    const flat = flatten(resolveChunksForOutput(run.segments, "video"))
    const byId = new Map(run.segments.map((s) => [s.id, s]))
    const tails = flat.filter((s) => s.splitLeadMs)
    expect(tails.length).toBeGreaterThan(0)
    for (const tail of tails) {
      const head = flat[flat.indexOf(tail) - 1]
      const whole = byId.get(baseId(tail.id))!
      expect([head.inMs, head.outMs, tail.inMs, tail.outMs]).toEqual([whole.inMs, tail.inMs, head.outMs, whole.outMs])
      expect(tail.splitLeadMs).toBe(head.outMs - head.inMs)
      expect(head.transition).toEqual(whole.transition)
      expect(tail.transition).toBeUndefined()
      expect([head.video, tail.video]).toEqual([whole.video, whole.video])
    }
  })

  it("every chunk after the first opens with the tail of a cut (a hard cut) — never mid-dissolve", () => {
    const plan = resolveChunksForOutput(crossfadeRun(300, 200, 50).segments, "audio")
    for (const c of plan.slice(1)) {
      expect(c[0].splitLeadMs).toBeGreaterThan(0)
      expect(c[0].transition).toBeUndefined()
    }
  })

  it("the head is the shortest that keeps its crossfade in — the tail's picture re-reads it", () => {
    const [prev, seg, next] = crossfadeRun(3, 200, 50).segments
    const split = splitInsideCrossfadeRun(prev, seg, next)!
    const x = split.head.outMs - split.head.inMs
    expect(boundaryOverlapSecs(split.head, prev)).toBe(boundaryOverlapSecs(seg, prev))
    expect(boundaryOverlapSecs({ ...split.head, outMs: split.head.outMs - 1 }, prev)).toBeLessThan(boundaryOverlapSecs(seg, prev))
    expect(x).toBe(56) // floor(0.9 × 56) = 50
  })

  it("refuses a cut that would shrink either crossfade", () => {
    const [prev, seg, next] = crossfadeRun(3, 1000, 900).segments // 900 ms each side of a 1 s segment
    expect(splitInsideCrossfadeRun(prev, seg, next)).toBeUndefined()
  })

  it("an edit with no crossfade plans exactly as before — picture checkpoints keep their resume keys", () => {
    for (const n of [31, 90, 250]) {
      const plan = resolveChunksForOutput(cuts(n, 1).segments, "video")
      expect(plan.flat().some((s) => (s as PlanSegment).splitLeadMs)).toBe(false)
      expect(plan.map((c) => c.length)).toEqual(chunksOf(cuts(n, 1), "video").map((c) => c.length))
    }
  })

  it("the liveness budget is the SAME split plan's chunk budgets — linear again, no floor", () => {
    const run = crossfadeRun(300, 200, 50)
    const plan = resolveChunksForOutput(run.segments, "audio")
    const slices = plan.reduce((acc, c) => acc + chunkRenderTimeoutMs(run, c, AUDIO_ONLY, LIVENESS_CANVAS), 0)
    const prep = referencedSourceIds(run, "audio").size * APPLY_EDL_PER_SOURCE_PREP_MS
    expect(applyEdlRenderBudgetMs(run, { output: "audio" })).toBe(slices + prep + audioMuxTimeoutMs(edlDurationMs(run) / 1000))
    for (const c of plan) expect(chunkRenderTimeoutMs(run, c, AUDIO_ONLY, LIVENESS_CANVAS)).toBeLessThan(WIDE_SLICE_FLOOR_MS)
  })

  // Review of #1630: a greedy planner that only tried a cut in slot 30 left
  // 31–33-segment graphs — when a run started right after slot 29, or when the
  // slot-30 segment was too short to cut. A full chunk now closes at the latest
  // hard cut or cuttable run segment within the cap.
  it("a run that starts at slot 30 opens a fresh chunk — never a head in slot 31", () => {
    const segments = [
      ...cuts(29, 1).segments,
      ...crossfadeRun(40, 1000, 300).segments.map((s, k) => ({ ...s, id: `r${k}`, inMs: 29_000 + k * 1000, outMs: 30_000 + k * 1000 })),
    ] as EdlSegment[]
    for (const output of ["video", "audio"] as const) {
      for (const c of resolveChunksForOutput(segments, output)) expect(c.length).toBeLessThanOrEqual(30)
    }
  })

  it("a slot-30 segment too short to cut sends the cut back to an earlier run segment", () => {
    // Every 30th segment is a 1 s clip under 800 ms crossfades both sides
    // (uncuttable: each half would need 889 ms); the rest are 3 s clips that can.
    const segments = Array.from({ length: 120 }, (_, i) => {
      const len = i % 30 === 29 ? 1000 : 3000
      return { id: `m${i}`, inMs: 0, outMs: len, video: "A", ...(i > 0 ? { transition: { type: "crossfade" as const, durationMs: 800 } } : {}) }
    }) as EdlSegment[]
    for (const c of resolveChunksForOutput(segments, "video")) expect(c.length).toBeLessThanOrEqual(30)
  })

  // A seeded sweep over mixed edits (hard cuts, crossfade runs, short and long
  // clips, small and near-maximal crossfades): whenever a run could be cut, no
  // chunk is wider than 30, and every invariant of the split holds.
  it("seeded sweep: the cap holds whenever a cut exists, and nothing about the edit moves", () => {
    let seed = 20260924
    const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    for (let e = 0; e < 300; e++) {
      const n = 20 + Math.floor(rnd() * 220)
      // Crossfades clamped to 0.9 × the shorter neighbour, as the node's Default
      // crossfade is and as validateEdl requires: only a valid edit reaches a render.
      const lens = Array.from({ length: n }, () => [120, 400, 1000, 2500, 6000][Math.floor(rnd() * 5)])
      const segments = lens.map((len, i) => {
        const want = rnd() < 0.7 ? [30, 100, 300, 800, 5000][Math.floor(rnd() * 5)] : 0
        const xfade = i > 0 ? Math.min(want, Math.floor(0.9 * Math.min(len, lens[i - 1]))) : 0
        return { id: `z${i}`, inMs: 0, outMs: len, video: "A", ...(xfade > 0 ? { transition: { type: "crossfade" as const, durationMs: xfade } } : {}) }
      }) as EdlSegment[]
      const edl = { version: 1, clock: "master", sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }], segments } as unknown as Edl
      expect(validateEdl(edl).issues).toEqual([])
      const overlapInto = new Map(segments.map((s, i) => [s.id, i > 0 ? boundaryOverlapSecs(s, segments[i - 1]) : 0]))
      for (const output of ["video", "audio"] as const) {
        const plan = resolveChunksForOutput(segments, output)
        const flat = plan.flat()
        for (let k = 1; k < flat.length; k++) {
          const [a, b] = [flat[k - 1], flat[k]]
          if (b.splitLeadMs) expect(boundaryOverlapSecs(b, a)).toBe(0)
          else expect(boundaryOverlapSecs(b, a)).toBe(overlapInto.get(baseId(b.id)))
        }
        expect(plan.reduce((acc, c) => acc + chunkOutputSec(c), 0)).toBeCloseTo(edlDurationMs(edl) / 1000, 6)
        for (const c of plan) {
          if (c.length <= 30) continue
          // Wider only if no segment of its trailing run up to slot 30 could close it.
          for (let k = 1; k < 30; k++) {
            const seg = c[k]
            if (boundaryOverlapSecs(seg, c[k - 1]) === 0) throw new Error(`chunk of ${c.length} had a hard cut at slot ${k + 1}`)
            expect(splitInsideCrossfadeRun(c[k - 1], seg, c[k + 1])).toBeUndefined()
          }
        }
      }
    }
  })

  it("the tail's picture re-read is in its decode span; its sound is not", () => {
    const [prev, seg, next] = crossfadeRun(3, 2000, 500).segments
    const { tail } = splitInsideCrossfadeRun(prev, seg, next)!
    const e = crossfadeRun(3, 2000, 500)
    const picture = chunkDecodeSpanSec(e, [tail], VIDEO_ONLY).videoSec
    const sound = chunkDecodeSpanSec(e, [tail], AUDIO_ONLY).audioSec
    expect(picture - sound).toBeCloseTo(tail.splitLeadMs! / 1000, 9)
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
    { shape: "audio slice, 100 × 1 s contiguous from the master (pre-cap width)", outputSec: 99, encodesVideo: false, videoSpanSec: 0, audioSpanSec: 117, pixelFactor: 1, wallSec: 11.9 },
    // The AUDIO_FILTERGRAPH_MAX_SEGMENTS slices (one run each; the sparse one on
    // a host at load ~27 — 50 s of CPU, 130 s of wall clock).
    { shape: "audio slice, 30 × 60 s contiguous from a 3-hour master (30 min out)", outputSec: 1797, encodesVideo: false, videoSpanSec: 0, audioSpanSec: 1802, pixelFactor: 1, wallSec: 23.0 },
    { shape: "audio slice, 30 × 1 s sparse over 53 min of a 3-hour master", outputSec: 30, encodesVideo: false, videoSpanSec: 0, audioSpanSec: 3164, pixelFactor: 1, wallSec: 129.7 },
    { shape: "audio slice, 30 × 1 s sparse over 53 min of a 3-hour camera MP4 (no master)", outputSec: 30, encodesVideo: false, videoSpanSec: 0, audioSpanSec: 3164, pixelFactor: 1, wallSec: 45.4 },
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

  // An AUDIO render never runs option B's separate audio pass — its chunks ARE
  // the lossless slices — and never checkpoints (no ffmpeg-build probe): past
  // one chunk it adds exactly ONE step, the join + single AAC encode. (A
  // phantom audio pass or build probe here would silently loosen every long
  // audio render's hung-detector; this pins it.)
  it.each([1, 30, 31, 180, 250, 1000])("an audio-output render of %i segments counts its own slices plus one join + encode", (n) => {
    const edl = cuts(n, 60)
    const chunks = chunksOf(edl, "audio")
    const renderBudget = chunks.reduce((acc, c) => acc + chunkRenderTimeoutMs(edl, c, AUDIO_ONLY, LIVENESS_CANVAS), 0)
    const joinEncode = chunks.length > 1 ? audioMuxTimeoutMs(n * 60) : 0
    const prep = referencedSourceIds(edl, "audio").size * APPLY_EDL_PER_SOURCE_PREP_MS
    expect(applyEdlRenderBudgetMs(edl, { output: "audio" })).toBe(renderBudget + prep + joinEncode)
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
