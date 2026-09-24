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
 *  chunks. */
export interface ChunkPlanOptions {
  /** Segments per render chunk (default 100; a VIDEO render is additionally
   *  capped at `VIDEO_FILTERGRAPH_MAX_SEGMENTS`). A chunk is closed only at a
   *  hard-cut boundary, so a long xfade run may exceed this. */
  readonly maxSegmentsPerChunk?: number
  /** At or below this many segments the whole edit renders in ONE pass with no
   *  R2 checkpoint (default 200; a VIDEO render is capped lower at
   *  `VIDEO_FILTERGRAPH_MAX_SEGMENTS`, so a video edit past that always chunks).
   *  Lower it to force the chunked path (tests). */
  readonly chunkThreshold?: number
}

export const DEFAULT_MAX_SEGMENTS_PER_CHUNK = 100
export const DEFAULT_CHUNK_THRESHOLD = 200

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
 *  templates cut hard), and no worse than before this cap. Audio-only graphs are
 *  unaffected and keep the larger `DEFAULT_*` sizes. Guarded by a frame-count
 *  e2e assertion. */
export const VIDEO_FILTERGRAPH_MAX_SEGMENTS = 30

/** Kill budget of option B's final step (join the lossless audio slices, encode
 *  AAC once, stream-copy the picture, mux) per second of output, floored at the
 *  default ffmpeg ceiling. AAC encodes far faster than real time; this is a
 *  ceiling for a hang, not an estimate. */
export const AUDIO_MUX_SECS_PER_OUTPUT_SEC = 1
export function audioMuxTimeoutMs(outputSec: number): number {
  return Math.max(DEFAULT_FFMPEG_TIMEOUT_MS, Math.ceil(outputSec * AUDIO_MUX_SECS_PER_OUTPUT_SEC) * 1000)
}

/** ffmpeg kill budget per chunk: this many seconds of wall clock per second of
 *  output, with `CHUNK_RENDER_TIMEOUT_FLOOR_MS` as the floor — a hung encode
 *  is killed by its own spawn, not by anything watching from outside. */
export const CHUNK_RENDER_SECS_PER_OUTPUT_SEC = 6
export const CHUNK_RENDER_TIMEOUT_FLOOR_MS = 20 * 60_000

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

/** The chunk plan a render uses: ONE pass at or below the threshold, else
 *  slices closed at hard cuts. The render and its liveness budget both call
 *  this, so they cannot disagree about how many chunks there are. */
export function resolveChunks(
  segs: readonly EdlSegment[],
  options: ChunkPlanOptions = {},
): EdlSegment[][] {
  const maxPerChunk = options.maxSegmentsPerChunk ?? DEFAULT_MAX_SEGMENTS_PER_CHUNK
  const threshold = options.chunkThreshold ?? DEFAULT_CHUNK_THRESHOLD
  return segs.length > threshold ? planChunks(segs, maxPerChunk) : [segs as EdlSegment[]]
}

/** The chunk plan for a given OUTPUT. A VIDEO render additionally caps every
 *  chunk (and the single-pass threshold) at `VIDEO_FILTERGRAPH_MAX_SEGMENTS`, so
 *  a pure-cut video `filter_complex` never grows wide enough to drop frames on a
 *  cloud runner (the one exception is a continuous crossfade run, which
 *  `planChunks` keeps whole — see that constant); an AUDIO render keeps the
 *  larger `DEFAULT_*` sizes. Both the render and its liveness budget call THIS,
 *  so they agree on how many chunks there are. The cap is a ceiling — an
 *  explicit smaller option still wins. */
export function resolveChunksForOutput(
  segs: readonly EdlSegment[],
  output: "video" | "audio",
  options: ChunkPlanOptions = {},
): EdlSegment[][] {
  if (output !== "video") return resolveChunks(segs, options)
  const cap = VIDEO_FILTERGRAPH_MAX_SEGMENTS
  return resolveChunks(segs, {
    chunkThreshold: Math.min(options.chunkThreshold ?? DEFAULT_CHUNK_THRESHOLD, cap),
    maxSegmentsPerChunk: Math.min(options.maxSegmentsPerChunk ?? DEFAULT_MAX_SEGMENTS_PER_CHUNK, cap),
  })
}

/** The output seconds one chunk renders (D17: crossfade overlaps subtracted). */
export function chunkOutputSec(segs: readonly EdlSegment[]): number {
  return segs.reduce((acc, s, i) => acc + secs(s.outMs - s.inMs) - (i > 0 ? boundaryOverlapSecs(segs[i], segs[i - 1]) : 0), 0)
}

/** The ffmpeg kill budget `renderSlice` gives one chunk. */
export function chunkRenderTimeoutMs(segs: readonly EdlSegment[]): number {
  return Math.max(CHUNK_RENDER_TIMEOUT_FLOOR_MS, Math.ceil(chunkOutputSec(segs) * CHUNK_RENDER_SECS_PER_OUTPUT_SEC) * 1000)
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
 * there is more than one chunk: the ffmpeg-build probe and the stream-copy
 * concat (default ceiling each), plus — for a video render — every slice of the
 * audio pass (`chunkRenderTimeoutMs` over the AUDIO plan) and the single
 * join/encode/mux step (`audioMuxTimeoutMs`) (option B). One number decides
 * "hung" for the heartbeat and for those steps.
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
  const render = chunks.reduce((acc, chunk) => acc + chunkRenderTimeoutMs(chunk), 0)
  const prep = referencedSourceIds(edl, output).size * APPLY_EDL_PER_SOURCE_PREP_MS
    + (output === "video" ? APPLY_EDL_CANVAS_PROBE_MS : 0)
  // A chunked render probes the ffmpeg build once (its resume keys hash it),
  // then stream-copy concats the chunks.
  const chunked = chunks.length > 1 ? 2 * DEFAULT_FFMPEG_TIMEOUT_MS : 0
  // Multi-chunk VIDEO also renders the audio in slices of the AUDIO plan (each
  // at its own kill budget) and joins/encodes/muxes them in one step (option
  // B) — exactly the steps `applyEdl` runs in that case. Keep in lockstep.
  const audioMux = output === "video" && chunks.length > 1
    ? resolveChunksForOutput(edl.segments, "audio", options).reduce((acc, c) => acc + chunkRenderTimeoutMs(c), 0)
      + audioMuxTimeoutMs(edlDurationMs(edl) / 1000)
    : 0
  return render + prep + chunked + audioMux
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
