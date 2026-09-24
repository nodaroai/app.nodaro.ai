/**
 * apply-edl's chunk plan and liveness budget — PURE (no ffmpeg, no storage, no
 * config): imports only `@nodaro/shared` and the dependency-free ceiling leaf
 * `ffmpeg-timeouts.ts`.
 *
 * WHY A LEAF. Two readers need the SAME number for the same job:
 *   - the video worker, whose pre-task heartbeat beats for as long as the
 *     handler's declared budget (`HandlerFn.livenessBudgetMs`), and
 *   - the workflow orchestrator, which sizes an apply-edl node's processing and
 *     poll ceilings — and the enclosing workflow's cap — from it (podcast Track
 *     0.11: a node that declares a budget gets node/poll timeouts = its budget).
 * The orchestrator must not import `apply-edl.ts` (it pulls `child_process`,
 * the R2 client and `config` through `ffmpeg-utils.ts`), and a second copy of
 * the formula would be a second hung-detector free to disagree with the first.
 * So the plan and the budget live here; `apply-edl.ts` renders from them and
 * re-exports them, and `lib/job-budget.ts` hands the one per-job entry point
 * (`applyEdlJobBudgetMs`) to both readers. `__tests__/job-budget-leaf.test.ts`
 * fails the build if this file ever imports the ffmpeg runtime.
 */
import type { Edl, EdlSegment } from "@nodaro/shared"
import { edlDurationMs } from "@nodaro/shared"
import { DEFAULT_FFMPEG_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS, FFPROBE_TIMEOUT_MS } from "./ffmpeg-timeouts.js"

/** How a render is split into chunks. Both the render (`ApplyEdlOptions`
 *  extends this) and its budget read the same options, so they plan the same
 *  chunks. Both options can only LOWER the output's filter-graph cap
 *  (`VIDEO_FILTERGRAPH_MAX_SEGMENTS` / `AUDIO_FILTERGRAPH_MAX_SEGMENTS`), which
 *  is also their default — tests lower them to force the chunked path. */
export interface ChunkPlanOptions {
  /** Segments per render chunk. A chunk is closed only at a hard-cut boundary,
   *  so a long xfade run may exceed this. */
  readonly maxSegmentsPerChunk?: number
  /** At or below this many segments the whole edit renders in ONE pass. */
  readonly chunkThreshold?: number
}

/**
 * The longest OUTPUT one apply-edl render may produce: 180 minutes (product
 * decision 2026-09-24 — the 3-hour cap the podcast Phase-2 plan's F4 set on
 * apply-edl). THE one constant for it:
 *  - every ingress refuses a longer edit with a 400 naming both lengths
 *    (`validateEffectiveEdl` in `lib/apply-edl-plan.ts` — the REST route,
 *    the DAG payload-builder and the MCP verb all call it, before any credit
 *    is reserved);
 *  - the job's declared budget refuses to size one (`applyEdlJobBudgetMs`
 *    below), so a payload that reached a worker WITHOUT passing ingress can
 *    never be budgeted past a 180-minute output — it gets the default
 *    ceilings instead.
 * Measured on the rendered output (`edlDurationMs`, crossfade overlaps
 * subtracted) — the same length the per-minute reserve is priced on.
 */
export const APPLY_EDL_MAX_OUTPUT_MS = 180 * 60_000

/** Max segments in ONE video `filter_complex`. A single video graph SILENTLY
 *  DROPS FRAMES past ~45-60 segments on a cloud runner — measured on the CI
 *  runner with the production-pinned ffmpeg: 45 segments render all frames, 60
 *  drop ~74, 90 drop ~629, while the sample-exact AUDIO graph of the same depth
 *  is untouched. It is the weight of the per-segment picture chain
 *  (fps + scale + pad + trims), not the concat depth or a logic bug — the exact
 *  graph renders every frame locally and on the same binary under emulation, so
 *  it is a runner resource limit the graph must stay under. Every PURE-CUT video
 *  render is therefore chunked to at most this many segments per graph (a margin
 *  under the cliff) and the chunks stream-copy concat; the cumulative frame grid
 *  (`chunkStartSec`) keeps them continuous. ONE case is NOT bounded by this: a
 *  continuous CROSSFADE run has no hard cut to split on, so `planChunks` keeps it
 *  whole and a run longer than this stays a single graph — rare (the podcast
 *  templates cut hard), and no worse than before this cap. Audio graphs have
 *  their own cap (`AUDIO_FILTERGRAPH_MAX_SEGMENTS`), for a different reason.
 *  Guarded by a frame-count e2e assertion. */
export const VIDEO_FILTERGRAPH_MAX_SEGMENTS = 30

/** Max segments in ONE audio `filter_complex` — option B's audio pass and an
 *  audio render alike. Every segment is its own branch off the shared input
 *  (`[i:a]apad,atrim…`): each branch is fed the source from the input's seek
 *  point to its own window, and the graph schedules every filter for every
 *  frame, so a slice's cost grows with segments² × the source span it decodes —
 *  not with its output. Measured on the production-pinned ffmpeg (2 CPUs):
 *  180 × 60 s over a 3-hour master in ONE pass (what a 200-segment threshold
 *  allowed) ran 88.7 min (5,306 CPU-s); the same edit as six 30-segment
 *  slices, 16–23 s each. 100 one-second windows spread over 3 hours in one slice: 21 min
 *  (1,258 CPU-s — the old flat 20-minute floor killed it); 30-segment slices
 *  of the same windows, 27–50 CPU-s each. At this width the linear chunk kill
 *  budget below holds with ≥3× margin; at 100–200 no linear budget can, since
 *  the cost is quadratic in the width. The slices are lossless PCM joined
 *  sample-exactly and encoded to AAC ONCE, so more slices add no seam. Like the
 *  picture cap, it cannot split a continuous crossfade run (`planChunks`), so
 *  such a run stays one wider graph with a floored kill budget
 *  (`WIDE_SLICE_FLOOR_MS`). */
export const AUDIO_FILTERGRAPH_MAX_SEGMENTS = 30

/** Kill budget of option B's final step (join the lossless audio slices, encode
 *  AAC once, stream-copy the picture, mux) — and of a chunked audio render's
 *  join + one AAC encode — per second of output, floored at the default ffmpeg
 *  ceiling. AAC encodes far faster than real time; this is a
 *  ceiling for a hang, not an estimate. */
export const AUDIO_MUX_SECS_PER_OUTPUT_SEC = 1
export function audioMuxTimeoutMs(outputSec: number): number {
  return Math.max(DEFAULT_FFMPEG_TIMEOUT_MS, Math.ceil(outputSec * AUDIO_MUX_SECS_PER_OUTPUT_SEC) * 1000)
}

/** Seconds of lead-in kept before each input's earliest read in a slice when it
 *  is seeked (`-ss`): the seek lands on the prior keyframe and decodes forward,
 *  and the margin keeps a codec's post-seek warm-up (AAC's first frame after a
 *  seek lacks its overlap) out of every trimmed window. The render seeks with
 *  it; the kill budget counts the decode it implies. */
export const INPUT_SEEK_MARGIN_SEC = 2

/**
 * ffmpeg kill budget per chunk — a hung encode is killed by its own spawn, not
 * by anything watching from outside. It is sized from the work the chunk
 * really does, measured on the production-pinned ffmpeg (2 CPUs, the video
 * worker's slot shape): wall clock grows with the seconds of OUTPUT it encodes
 * AND with the seconds of SOURCE it must decode to reach them. Each input is
 * seeked to its earliest read, then decoded through its latest one, so a
 * sparse chunk — 30 one-second windows spread across a 3-hour episode — decodes
 * ~3 hours for 30 s of output (measured 1,340–1,518 s; the old flat 20-minute
 * floor killed it). An output-only limit cannot see that; a flat floor hides
 * it on some shapes and budgets ~120 h for a dense 3-hour edit on others.
 *
 *   budget = max(FLOOR, MARGIN × (PER_OUTPUT·output + PER_VIDEO_SPAN·videoSpan + PER_AUDIO_SPAN·audioSpan))
 *
 * where PER_OUTPUT is the picture ENCODE cost for a slice that renders video,
 * and the far smaller sound-only cost for an audio slice (option B's PCM
 * slices, an audio render) — charging an audio slice the video encode rate
 * would budget a 3-hour audio pass ~22 h for minutes of work. The terms are
 * linear because graphs are capped (`VIDEO_FILTERGRAPH_MAX_SEGMENTS`,
 * `AUDIO_FILTERGRAPH_MAX_SEGMENTS`): a slice's cost also grows with its width,
 * which at 30 segments the margin covers and at 100–200 no coefficient can.
 * The one slice the caps cannot bound — a continuous crossfade run — is floored
 * instead (`WIDE_SLICE_FLOOR_MS`).
 *
 * The picture terms scale with the CANVAS pixel rate (`canvasPixelFactor`:
 * 1080p30 = 1, 1080p60 = 2, 4K30 = 4 — a 4K chunk measured ~4.5× the 1080p
 * cost), so a 1080p hang is caught fast and a 4K chunk still gets the time it
 * needs. The coefficients are the worst measured per-second costs at 1080p30
 * (dense cuts, multicam, crossfades, sparse supercuts), and MARGIN covers a busy
 * box (four ffmpegs share a video worker). Guarded by `apply-edl-budget.test.ts`,
 * which re-checks every measured shape against its new budget.
 *
 * The render's LIVENESS budget is declared at dispatch, before any source is
 * probed, so it cannot know the canvas: it assumes `LIVENESS_CANVAS` (4K30), and
 * a chunk's kill budget never assumes more (its pixel factor is capped there).
 * So the heartbeat and the workflow ceilings are always at least the sum of the
 * chunk kill budgets — looser for a 1080p render, never tighter.
 */
export const CHUNK_RENDER_TIMEOUT_FLOOR_MS = 2 * 60_000
export const CHUNK_RENDER_MARGIN = 3
export const CHUNK_RENDER_SECS_PER_OUTPUT_SEC = 1.6
export const CHUNK_RENDER_SECS_PER_AUDIO_OUTPUT_SEC = 0.1
export const CHUNK_RENDER_SECS_PER_VIDEO_SPAN_SEC = 0.5
export const CHUNK_RENDER_SECS_PER_AUDIO_SPAN_SEC = 0.05

/** The canvas a render draws on (width × height at fps). */
export interface RenderCanvas {
  readonly width: number
  readonly height: number
  readonly fps: number
}

/** The canvas the dispatch-time liveness budget assumes: 4K30, the ceiling a
 *  chunk's kill budget is charged at (see `canvasPixelFactor`). */
export const LIVENESS_CANVAS: RenderCanvas = Object.freeze({ width: 3840, height: 2160, fps: 30 })

const BASE_PIXEL_RATE = 1920 * 1080 * 30

/** How much more picture work a canvas is than 1080p30, floored at 1 (a smaller
 *  canvas keeps the 1080p30 rates) and capped at `LIVENESS_CANVAS`'s factor so a
 *  chunk's kill budget can never exceed what the liveness budget assumed (a
 *  4K60 canvas is charged the 4K30 rate; its measured margin still covers it). */
export function canvasPixelFactor(canvas: RenderCanvas): number {
  const rate = (c: RenderCanvas) => Math.max(0, c.width) * Math.max(0, c.height) * Math.max(0, c.fps)
  const cap = rate(LIVENESS_CANVAS) / BASE_PIXEL_RATE
  const f = rate(canvas) / BASE_PIXEL_RATE
  return Number.isFinite(f) ? Math.min(cap, Math.max(1, f)) : cap
}

/** Which tracks a slice decodes: a picture-only chunk of a multi-chunk video
 *  render reads no sound, an audio slice reads no picture. */
export interface ChunkReads {
  readonly video: boolean
  readonly audio: boolean
}

/**
 * Seconds of SOURCE one slice decodes, per track kind: for every input, from
 * its seek point (earliest read − `INPUT_SEEK_MARGIN_SEC`, floored at 0) to its
 * latest read end — exactly how the render seeks and trims. Pure; counts every
 * read the segments name (the render may skip a zero-frame picture read or a
 * soundless source, so this is never less than the real decode).
 */
export function chunkDecodeSpanSec(
  edl: Edl,
  segs: readonly EdlSegment[],
  reads: ChunkReads,
): { readonly videoSec: number; readonly audioSec: number } {
  const masterAudioId = edl.sources.find((s) => s.role === "master-audio")?.id
  const offsetOf = (id: string): number => edl.sources.find((s) => s.id === id)?.offsetMs ?? 0
  const windows = { video: new Map<string, [number, number]>(), audio: new Map<string, [number, number]>() }
  const note = (kind: "video" | "audio", id: string | undefined, seg: EdlSegment) => {
    if (!id) return
    const off = offsetOf(id)
    const start = Math.max(0, secs(seg.inMs - off))
    const end = Math.max(start, secs(seg.outMs - off))
    const w = windows[kind].get(id)
    windows[kind].set(id, w ? [Math.min(w[0], start), Math.max(w[1], end)] : [start, end])
  }
  for (const seg of segs) {
    if (reads.video) note("video", seg.video, seg)
    if (reads.audio) note("audio", audioSourceId(edl, seg, masterAudioId), seg)
  }
  const span = (m: Map<string, [number, number]>) =>
    [...m.values()].reduce((acc, [start, end]) => acc + (end - Math.max(0, start - INPUT_SEEK_MARGIN_SEC)), 0)
  return { videoSec: span(windows.video), audioSec: span(windows.audio) }
}

export const secs = (ms: number): number => ms / 1000

/** The overlap (seconds) at the boundary INTO `seg`, clamped PER-BOUNDARY to
 *  `0.9·min(adjacent)` (R5 silent-edit guard: never a global clamp). Only a
 *  `crossfade` segment-transition consumes time in phase 1 (layout xfades are
 *  phase 2). */
export function boundaryOverlapSecs(seg: EdlSegment, prev: EdlSegment): number {
  const t = seg.transition
  if (!t || t.type !== "crossfade") return 0
  const d = t.durationMs ?? 0
  if (d <= 0) return 0
  const minAdj = Math.min(seg.outMs - seg.inMs, prev.outMs - prev.inMs)
  return secs(Math.min(d, Math.floor(0.9 * minAdj)))
}

/** Resolve the source id that supplies a segment's SOUND (D19 audio doctrine). */
export function audioSourceId(edl: Edl, seg: EdlSegment, masterAudioId: string | undefined): string | undefined {
  if (seg.audio) return seg.audio
  if (masterAudioId) return masterAudioId
  return seg.video
}

/** The chunk plan for a given OUTPUT: ONE pass at or below the output's
 *  filter-graph cap, else slices of at most that many segments closed at hard
 *  cuts (a continuous crossfade run stays whole — see `planChunks`). The cap is
 *  `VIDEO_FILTERGRAPH_MAX_SEGMENTS` for a video render's picture chunks and
 *  `AUDIO_FILTERGRAPH_MAX_SEGMENTS` for sound (an audio render, and option B's
 *  audio pass, which plans with `"audio"`). Both the render and its liveness
 *  budget call THIS, so they agree on how many chunks there are. The cap is a
 *  ceiling — an explicit smaller option still wins. */
export function resolveChunksForOutput(
  segs: readonly EdlSegment[],
  output: "video" | "audio",
  options: ChunkPlanOptions = {},
): EdlSegment[][] {
  const cap = output === "video" ? VIDEO_FILTERGRAPH_MAX_SEGMENTS : AUDIO_FILTERGRAPH_MAX_SEGMENTS
  const threshold = Math.min(options.chunkThreshold ?? cap, cap)
  const maxPerChunk = Math.min(options.maxSegmentsPerChunk ?? cap, cap)
  return segs.length > threshold ? planChunks(segs, maxPerChunk) : [segs as EdlSegment[]]
}

/** The output seconds one chunk renders (D17: crossfade overlaps subtracted). */
export function chunkOutputSec(segs: readonly EdlSegment[]): number {
  return segs.reduce((acc, s, i) => acc + secs(s.outMs - s.inMs) - (i > 0 ? boundaryOverlapSecs(segs[i], segs[i - 1]) : 0), 0)
}

/** The kill budget for a slice's WORK — its output seconds and the seconds of
 *  source it decodes per track kind (see `CHUNK_RENDER_TIMEOUT_FLOOR_MS` for
 *  the formula and how it was measured). Exported so the measured table can be
 *  re-checked against it directly. */
export function chunkBudgetMs(work: {
  readonly outputSec: number
  /** Does the slice encode picture? (false: an audio-only slice) */
  readonly encodesVideo: boolean
  readonly videoSpanSec: number
  readonly audioSpanSec: number
  /** `canvasPixelFactor` of the canvas; scales the picture terms only. */
  readonly pixelFactor: number
}): number {
  const pf = Math.max(1, work.pixelFactor)
  const perOutput = work.encodesVideo ? CHUNK_RENDER_SECS_PER_OUTPUT_SEC * pf : CHUNK_RENDER_SECS_PER_AUDIO_OUTPUT_SEC
  const workSec = perOutput * work.outputSec
    + CHUNK_RENDER_SECS_PER_VIDEO_SPAN_SEC * pf * work.videoSpanSec
    + CHUNK_RENDER_SECS_PER_AUDIO_SPAN_SEC * work.audioSpanSec
  return Math.max(CHUNK_RENDER_TIMEOUT_FLOOR_MS, Math.ceil(CHUNK_RENDER_MARGIN * workSec) * 1000)
}

/**
 * The floor of a slice WIDER than its graph cap. Only a continuous crossfade run
 * can be one — `planChunks` never splits it, and the node's Default crossfade
 * turns a whole edit into one run — and its cost grows faster than linearly
 * with its width, which the linear terms cannot see. Measured on the pinned
 * 8.1.2 (2 CPUs), 50 ms crossfades on every boundary: 300 × 200 ms audio-only
 * (45 s out) ran past a 120 s limit with 16 s rendered; 250 × 200 ms video
 * (37.6 s out) ran past 338 s with 21.9 s rendered. Until crossfade runs are split
 * into pieces (plan B2), such a slice keeps at least the limit production gave
 * every chunk before the linear budget — max(20 min, 6 × output), on its OWN
 * output. The same graph is never killed where production rendered it (all of
 * a video render's crossfade runs, and an audio edit that is one run — the
 * Default crossfade case). Residual until B2: a mixed audio-only edit of ≤200
 * segments rendered in ONE pass before, budgeted on the whole edit's output,
 * while its run's chunk is now floored on the run's own output. A floor, not a
 * model of its cost.
 */
export const WIDE_SLICE_FLOOR_MS = 20 * 60_000
export const WIDE_SLICE_SECS_PER_OUTPUT_SEC = 6

/** The ffmpeg kill budget `renderSlice` gives one chunk: `chunkBudgetMs` of the
 *  chunk's output and the source spans it decodes for the tracks it reads, on
 *  its canvas — floored for a slice wider than its graph cap (picture cap when
 *  it reads picture, else the sound cap; see `WIDE_SLICE_FLOOR_MS`). */
export function chunkRenderTimeoutMs(edl: Edl, segs: readonly EdlSegment[], reads: ChunkReads, canvas: RenderCanvas): number {
  const { videoSec, audioSec } = chunkDecodeSpanSec(edl, segs, reads)
  const outputSec = chunkOutputSec(segs)
  const linear = chunkBudgetMs({
    outputSec,
    encodesVideo: reads.video,
    videoSpanSec: videoSec,
    audioSpanSec: audioSec,
    pixelFactor: canvasPixelFactor(canvas),
  })
  const cap = reads.video ? VIDEO_FILTERGRAPH_MAX_SEGMENTS : AUDIO_FILTERGRAPH_MAX_SEGMENTS
  if (segs.length <= cap) return linear
  return Math.max(linear, WIDE_SLICE_FLOOR_MS, Math.ceil(outputSec * WIDE_SLICE_SECS_PER_OUTPUT_SEC) * 1000)
}

/** Per referenced source, run in sequence before the first chunk: one fetch
 *  (`downloadFile`'s ceiling), then `hasAudioStream` (one ffprobe), then
 *  `probeStreamEnds` — its stream listing (one ffprobe) plus up to two per-track
 *  packet scans, each with the default ffmpeg watchdog. */
export const APPLY_EDL_PER_SOURCE_PREP_MS =
  DOWNLOAD_TIMEOUT_MS + 2 * FFPROBE_TIMEOUT_MS + 2 * DEFAULT_FFMPEG_TIMEOUT_MS

/** Once per VIDEO render, before the first chunk: the picture-canvas probes —
 *  resolution, then fps, each run across every video source in parallel, each
 *  at the ffprobe ceiling. An audio-only render skips them. */
export const APPLY_EDL_CANVAS_PROBE_MS = 2 * FFPROBE_TIMEOUT_MS

/** The sources `applyEdl` downloads for this output — the picture source of
 *  each segment for a video render, and each segment's sound source
 *  (`audioSourceId`) always. The one read set the render and its budget share. */
export function referencedSourceIds(edl: Edl, output: "video" | "audio"): Set<string> {
  const masterAudioId = edl.sources.find((s) => s.role === "master-audio")?.id
  const referenced = new Set<string>()
  for (const seg of edl.segments) {
    if (output === "video" && seg.video) referenced.add(seg.video)
    const aId = audioSourceId(edl, seg, masterAudioId)
    if (aId) referenced.add(aId)
  }
  return referenced
}

/**
 * The handler's liveness budget (`HandlerFn.livenessBudgetMs`): the sum of the
 * kill budgets of every BOUNDED step `applyEdl` runs for this EDL and output,
 * in the order it runs them — each referenced source's fetch + audio probe
 * (`referencedSourceIds`, the same read set the render uses), the canvas
 * probes (video only), every chunk's ffmpeg budget (`chunkRenderTimeoutMs`,
 * over `resolveChunksForOutput` — the same plan the render uses), and when
 * there is more than one chunk: for a VIDEO render the ffmpeg-build probe and
 * the stream-copy concat (default ceiling each), every slice of the audio pass
 * (`chunkRenderTimeoutMs` over the AUDIO plan) and the single join/encode/mux
 * step (`audioMuxTimeoutMs`) (option B); for an AUDIO render, whose chunks are
 * those lossless slices, the one join + AAC encode (`audioMuxTimeoutMs`). One
 * number decides "hung" for the heartbeat and for those steps.
 *
 * NOT in the sum, because they have no ceiling of their own to add: time
 * WAITING for an ffmpeg slot, and storage I/O (the R2 client has no request
 * timeout — chunk checkpoints, the 404-fallback download, and the deliverable
 * upload after the render). Those ride in the slack between a real render and
 * its kill budgets, plus the 30 minutes after the last beat; see the wrapper
 * doc (`workers/pre-task-heartbeat.ts`).
 */
export function applyEdlRenderBudgetMs(
  edl: Edl,
  options: ChunkPlanOptions & { readonly output?: "video" | "audio" } = {},
): number {
  const output = options.output === "audio" ? "audio" : "video"
  const chunks = resolveChunksForOutput(edl.segments, output, options)
  // The same reads each slice makes: a multi-chunk video render's chunks are
  // picture-only (option B renders the sound separately); a single-pass video
  // render reads both; an audio render reads sound only.
  const chunkReads: ChunkReads = output === "audio"
    ? { video: false, audio: true }
    : { video: true, audio: chunks.length === 1 }
  // Dispatch-time: no source is probed yet, so every chunk is charged at the
  // liveness canvas — never less than the kill budget it will get.
  const render = chunks.reduce((acc, chunk) => acc + chunkRenderTimeoutMs(edl, chunk, chunkReads, LIVENESS_CANVAS), 0)
  const prep = referencedSourceIds(edl, output).size * APPLY_EDL_PER_SOURCE_PREP_MS
    + (output === "video" ? APPLY_EDL_CANVAS_PROBE_MS : 0)
  // Past one chunk — exactly the steps `applyEdl` runs, keep in lockstep:
  //  - VIDEO: probe the ffmpeg build (the picture checkpoints' resume keys hash
  //    it), stream-copy concat the picture chunks, render the sound in slices of
  //    the AUDIO plan (each at its own kill budget), then join/encode/mux once
  //    (option B);
  //  - AUDIO: the chunks already ARE those lossless slices (never checkpointed,
  //    so no build probe) — join them and encode AAC once.
  const joinEncode = audioMuxTimeoutMs(edlDurationMs(edl) / 1000)
  const assemble = chunks.length === 1
    ? 0
    : output === "audio"
      ? joinEncode
      : 2 * DEFAULT_FFMPEG_TIMEOUT_MS
        + resolveChunksForOutput(edl.segments, "audio", options).reduce((acc, c) => acc + chunkRenderTimeoutMs(edl, c, { video: false, audio: true }, LIVENESS_CANVAS), 0)
        + joinEncode
  return render + prep + assemble
}

/** Split the timeline into contiguous slices closed ONLY at hard-cut boundaries
 *  (index i is a cut when segment i has no time-consuming transition). A run of
 *  xfaded segments stays whole even if it overshoots `maxPerChunk`. */
export function planChunks(segs: readonly EdlSegment[], maxPerChunk: number): EdlSegment[][] {
  const chunks: EdlSegment[][] = []
  let current: EdlSegment[] = []
  for (let i = 0; i < segs.length; i++) {
    const isCutBoundary = i > 0 && boundaryOverlapSecs(segs[i], segs[i - 1]) === 0
    if (isCutBoundary && current.length >= maxPerChunk) {
      chunks.push(current)
      current = []
    }
    current.push(segs[i])
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/**
 * The budget of ONE apply-edl job, read off its queue payload (`job.data` for
 * the worker, the dispatched payload for the orchestrator, `jobs.input_data`
 * — the same payload spread — for a reader of the row). `undefined` when the
 * payload carries no usable EDL, which keeps every reader on its default.
 *
 * This is the only place the payload is interpreted: the handler's
 * `livenessBudgetMs` and the orchestrator's node ceilings both reach it
 * through `declaredJobBudgetMs` (`lib/job-budget.ts`), so they cannot read the
 * same job two ways (e.g. one defaulting a missing `output` to audio).
 *
 * Defensive clamp: an EDL whose output exceeds `APPLY_EDL_MAX_OUTPUT_MS` never
 * passes ingress, so one here bypassed it (a stale row, a future lane that
 * forgot the check). It declares NO budget — every reader falls back to its
 * default ceiling — so no job can ever be budgeted beyond a 180-minute output.
 */
export function applyEdlJobBudgetMs(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined
  const { edl, output } = data as { edl?: Edl; output?: unknown }
  if (!edl || !Array.isArray(edl.segments) || !Array.isArray(edl.sources)) return undefined
  if (edlDurationMs(edl) > APPLY_EDL_MAX_OUTPUT_MS) return undefined
  return applyEdlRenderBudgetMs(edl, { output: output === "audio" ? "audio" : "video" })
}
