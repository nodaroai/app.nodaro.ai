/**
 * apply-edl executor — render an EDL into ONE media file (video OR audio),
 * each segment's one picture source full frame.
 *
 * The renderer itself is the EDL timeline (`edl-timeline.ts`: the frame grid,
 * chunking, seeks, the one sound pass, checkpoints, budgets — and the doc of
 * all of it), with the full-frame picture (`edl-picture-fullframe.ts`). It was
 * extracted from this file for Speaker View (C2.0, decided 2026-10-06), which
 * draws a different picture on the same timeline; Apply EDL's render is
 * byte-identical to before (the F10 golden trace,
 * `__tests__/apply-edl-golden.test.ts`). Everything this module exported
 * before is still exported from it, so every existing import keeps working.
 */
import { APPLY_EDL_LABEL, renderEdlTimeline } from "./edl-timeline.js"
import type { Edl } from "@nodaro/shared"
import type { ChunkPlanOptions } from "./apply-edl-budget.js"

// The chunk plan and the liveness budget live in the pure leaf
// `apply-edl-budget.ts` (the workflow orchestrator reads the budget without
// importing this ffmpeg runtime). Re-exported so every existing import of them
// from this module keeps working — one definition, two paths.
export {
  APPLY_EDL_CANVAS_PROBE_MS,
  APPLY_EDL_PER_SOURCE_PREP_MS,
  AUDIO_MUX_SECS_PER_OUTPUT_SEC,
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
  AUDIO_FILTERGRAPH_MAX_SEGMENTS,
  VIDEO_FILTERGRAPH_MAX_SEGMENTS,
  WIDE_SLICE_FLOOR_MS,
  WIDE_SLICE_SECS_PER_OUTPUT_SEC,
  applyEdlRenderBudgetMs,
  audioMuxTimeoutMs,
  chunkOutputMs,
  chunkOutputSec,
  chunkRenderTimeoutMs,
  planChunks,
  referencedSourceIds,
  resolveChunksForOutput,
  splitInsideCrossfadeRun,
  type ChunkPlanOptions,
  type PlanSegment,
} from "./apply-edl-budget.js"

// What ONE slice renders — its ffmpeg command, built without touching the
// filesystem — lives in `apply-edl-slice.ts`. Re-exported so every existing
// import of it from this module keeps working.
export {
  APPLY_EDL_GRID_READ_GUARD_FRAMES,
  aacArgs,
  buildSliceCommand,
  pictureFramesOf,
  type SliceCommand,
  type SliceOptions,
} from "./apply-edl-slice.js"

// The one frame grid every output time → frame index goes through.
export { frameAtMs, frameRate, frameRateOf, type FrameRate } from "./apply-edl-frame-grid.js"

// The timeline's runtime pieces, defined in `edl-timeline.ts` since the
// extraction and re-exported here under their old names.
export {
  DECLARED_END_TOLERANCE_SEC,
  SOURCE_END_TOLERANCE_SEC,
  assertSegmentsWithinSources,
  renderEdlTimeline,
  sliceArgv,
  sliceFingerprint,
  slicePeakMemoryMiB,
  type EdlTimelineOptions,
  type EdlTimelineResult,
  type SkippedWindowRead,
} from "./edl-timeline.js"

/** `maxSegmentsPerChunk` / `chunkThreshold` come from `ChunkPlanOptions`
 *  (`apply-edl-budget.ts`) — the same options the liveness budget plans with. */
export interface ApplyEdlOptions extends ChunkPlanOptions {
  readonly edl: Edl
  readonly output: "video" | "audio"
  readonly quality: "proxy" | "final"
  readonly jobId: string
  readonly jobUserId?: string
  /** 0..1 render progress. */
  readonly onProgress?: (fraction: number) => void
  /** R2 checkpointing (default true). Off = pure-local render (unit tests with
   *  no storage). */
  readonly checkpoint?: boolean
}

export interface ApplyEdlResult {
  readonly outputPath: string
  /** Rendered duration in ms — equals `edlDurationMs(edl)` by construction. */
  readonly durationMs: number
}

/** Render an Apply EDL job: the EDL timeline with the full-frame picture. */
export async function applyEdl(options: ApplyEdlOptions): Promise<ApplyEdlResult> {
  return renderEdlTimeline({ ...options, label: APPLY_EDL_LABEL })
}
