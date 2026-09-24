/**
 * apply-edl executor — render an EDL into ONE media file (video OR audio).
 *
 * The EDL's segment ORDER is the output timeline. Each segment names a source
 * time-window on the MASTER clock; we trim every referenced source at
 * `masterMs − offsetMs(source)` (D19 sign), normalize picture to one canvas,
 * and JOIN the segments pairwise — a `cut` boundary abuts (`concat`), a
 * `crossfade` boundary overlaps (`xfade` video / `acrossfade` audio), so the
 * rendered length is the D17 overlap-compressed `edlDurationMs(edl)`.
 *
 * Audio doctrine: when a `role:"master-audio"` source exists, EVERY segment's
 * sound comes from it (a camera switch never touches the sound); otherwise each
 * segment uses its own `audio` (defaulting to its `video` source). Both are
 * trimmed to the SAME master-time windows and joined with the SAME boundaries,
 * so picture and sound stay locked.
 *
 * Long edits render in chunks split ONLY at hard-cut boundaries (an xfade
 * cannot straddle a chunk), at most `VIDEO_FILTERGRAPH_MAX_SEGMENTS` segments
 * per picture graph and `AUDIO_FILTERGRAPH_MAX_SEGMENTS` per sound graph. A
 * chunked VIDEO render's chunks carry picture only, each checkpointed to R2 so
 * a worker restart resumes instead of re-rendering, joined with a stream-copy
 * concat; its audio is rendered in lossless slices, joined, encoded to AAC once
 * and muxed on. A chunked AUDIO render's chunks ARE such lossless slices,
 * joined and encoded to AAC once. So no seam ever carries encoder priming. The
 * checkpoint cache
 * (`apply-edl-cache/<jobId>/chunk-<c>-<fingerprint>.…`, keyed by a hash of the
 * exact command — `sliceFingerprint`) is internal scratch: uploaded with NO
 * `trackUserId` so it never bills the user's storage quota, and best-effort
 * deleted once the final output exists or the render is cancelled.
 */
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import type { Edl, EdlSegment, EdlSource } from "@nodaro/shared"
import { edlDurationMs } from "@nodaro/shared"
import {
  downloadFile,
  runFfmpeg,
  runFfprobe,
  probeStreamEnds,
  type StreamEnds,
  createWorkDir,
  cleanupWorkDir,
  COMBINE_DELIVERY_CRF,
  ffmpegVersionLine,
} from "./ffmpeg-utils.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { JobCancelledError, throwIfJobCancelled } from "../../lib/job-cancellation.js"
import { pickTargetResolution, pickTargetFps } from "./combine-videos.js"
import {
  audioMuxTimeoutMs,
  audioSourceId,
  boundaryOverlapSecs,
  chunkOutputSec,
  chunkRenderTimeoutMs,
  referencedSourceIds,
  resolveChunksForOutput,
  secs,
  INPUT_SEEK_MARGIN_SEC,
  type ChunkPlanOptions,
} from "./apply-edl-budget.js"

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
  chunkOutputSec,
  chunkRenderTimeoutMs,
  planChunks,
  referencedSourceIds,
  resolveChunksForOutput,
  type ChunkPlanOptions,
} from "./apply-edl-budget.js"

/** The one AAC delivery encode: a single-pass render's inline audio, option B's
 *  mux and a chunked audio render's join all produce the same stream. */
const AAC_DELIVERY_ARGS = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"] as const

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

/** Frames a grid cut reads PAST its window so `fps` yields at least the N frames
 *  the cumulative grid asks for (Track 0.14). Reading past the source end simply
 *  yields fewer frames — the `SOURCE_END_TOLERANCE_SEC` skew case, not a crash. */
export const APPLY_EDL_GRID_READ_GUARD_FRAMES = 4

/** The tail that holds a chunk's picture to EXACTLY `frames` frames on the
 *  canvas grid: clone the last frame without limit (a short chain), keep
 *  `frames` (a long one), and rebuild the timestamps from the frame index — a
 *  crossfade over a short outgoing input can emit frames whose timestamps do
 *  not advance, which the encoder would otherwise drop after `trim` counted
 *  them (pinned 8.1.2: 538 of 547). `trim` ends the stream, so the unbounded
 *  pad terminates. `round(…)`: on a 1/F timebase `N/FRAME_RATE/TB` evaluates
 *  to e.g. 122.999… for frame 123 at 30 fps and setpts truncates, giving two
 *  frames the same pts (masked today by the CLI's CFR output, not relied on). */
function gridHold(frames: number): string {
  return `tpad=stop_mode=clone:stop=-1,trim=start_frame=0:end_frame=${frames},setpts=round(N/FRAME_RATE/TB)`
}

const offsetOf = (s: EdlSource | undefined): number => s?.offsetMs ?? 0

/** How far past a track's measured end a segment may reach before it is a
 *  refusal rather than rounding — see `assertSegmentsWithinSources` (a
 *  transcript's last word can end a beat after the audio; a clip's audio
 *  outlasts its picture by a frame or two). Inside it the segment still renders
 *  its FULL window: every source is held past its end — the picture freezes on
 *  its last frame (`tpad` clone), the sound continues as silence (`apad`) — so
 *  each segment is exactly its planned length, the picture stays on the
 *  cumulative frame grid (Track 0.14) and the delivered length is
 *  `edlDurationMs(edl)`. A segment that came up short would pull every later cut
 *  ahead of the single continuous audio track (option B). */
export const SOURCE_END_TOLERANCE_SEC = 1

/** Tolerance past a re-anchoring container's DECLARED duration (MPEG-TS/PS,
 *  whose per-track ends are not on the render's clock — `TrackEnd.declaredEndSec`).
 *  Wider than `SOURCE_END_TOLERANCE_SEC` because the bound is coarse (the span of
 *  every stream). The probe attaches it only when the file's timestamps never run
 *  backwards — then it can only over-state a track's end, so this never refuses a
 *  correct edit — and it caps what an overrun there can render as frozen picture
 *  + silence (the source is held past its end) at a few seconds. A joined or
 *  reconnected recording (timestamps jump back, or forward past the CLI's fold
 *  threshold when a restarted clock is "unwrapped") declares something other
 *  than it plays, so it carries no bound and is skipped like any unmeasured
 *  track. */
export const DECLARED_END_TOLERANCE_SEC = 5

/** A read the window check could not verify, for the caller to log. */
export interface SkippedWindowRead {
  readonly segment: string
  readonly source: string
  readonly track: "video" | "audio"
  readonly reason: string
}

/** Throws a `DeterministicJobError` — the same inputs fail the same way on a
 *  retry, so the job fails and refunds now — naming the segment, the source
 *  and the TRACK when a segment reads media that is not there:
 *   - its window reaches more than `SOURCE_END_TOLERANCE_SEC` past the end of
 *     the track it reads: the picture source's VIDEO track (video output
 *     only), the sound source's AUDIO track always — a file whose tracks differ
 *     in length is two lengths, not one;
 *   - its picture source has no video track at all (an audio file, or an mp3
 *     whose only "video" is cover art) — the render would otherwise fail on an
 *     empty stream specifier, or show a still.
 *  A sound source with no audio track is not a refusal: the render pads that
 *  segment with silence. A track present but unmeasured is checked coarsely
 *  when its container declares a safe upper bound (`TrackEnd.declaredEndSec`,
 *  MPEG-TS/PS only): past that + `DECLARED_END_TOLERANCE_SEC` it is refused the
 *  same way. With no such bound it is skipped and RETURNED, so the caller can
 *  log it — a skipped check always leaves a trace.
 *  Pure; the measured ends (`probeStreamEnds`) are passed in, and a source
 *  with no entry at all (its probe failed outright) is skipped silently here
 *  because the caller already logged that failure. */
export function assertSegmentsWithinSources(
  edl: Edl,
  masterAudioId: string | undefined,
  wantVideo: boolean,
  sourceEnds: ReadonlyMap<string, StreamEnds>,
): SkippedWindowRead[] {
  const skipped: SkippedWindowRead[] = []
  edl.segments.forEach((seg, i) => {
    const reads: Array<{ id: string; track: "video" | "audio" }> = []
    if (wantVideo && seg.video) reads.push({ id: seg.video, track: "video" })
    const aId = audioSourceId(edl, seg, masterAudioId)
    if (aId) reads.push({ id: aId, track: "audio" })
    for (const { id, track } of reads) {
      // A read before the source's origin (masterMs < offsetMs) has no media:
      // refuse it, never clamp it to the first frame. It depends only on the
      // EDL, so it runs FIRST — before the probe-keyed skips below (a probe that
      // failed, or a sound track that is absent, must not wave it through).
      // Ingress (`validateEffectiveEdl`) already refuses it; this is the
      // executor's own guarantee for any caller that reaches it.
      const originMs = offsetOf(edl.sources.find((s) => s.id === id))
      if (seg.inMs < originMs) {
        throw new DeterministicJobError(
          `apply-edl: segment[${i}] "${seg.id}" starts at ${secs(seg.inMs).toFixed(3)}s on the master clock, before source "${id}" ` +
            `begins (its offsetMs is ${originMs}) — start the segment later or check the source's offsetMs`,
        )
      }
      const t = sourceEnds.get(id)?.[track]
      if (t === undefined) continue
      if (t.state === "absent") {
        if (track === "video") {
          throw new DeterministicJobError(
            `apply-edl: segment[${i}] "${seg.id}" takes its picture from source "${id}", but that source has no video track ` +
              `(an audio file, or only embedded cover art) — pick a video source, or use output:"audio"`,
          )
        }
        continue // no sound track → the render pads this segment with silence
      }
      const src = edl.sources.find((s) => s.id === id)
      const endSec = secs(seg.outMs - offsetOf(src))
      if (t.state === "unmeasured") {
        if (t.declaredEndSec !== undefined) {
          if (endSec > t.declaredEndSec + DECLARED_END_TOLERANCE_SEC) {
            throw new DeterministicJobError(
              `apply-edl: segment[${i}] "${seg.id}" ends at ${endSec.toFixed(2)}s on source "${id}", ` +
                `but that file declares only ${t.declaredEndSec.toFixed(2)}s (${t.reason}) — shorten the segment or check the source's offsetMs`,
            )
          }
          continue // inside the coarse bound — renders its full window (held source)
        }
        skipped.push({ segment: seg.id, source: id, track, reason: t.reason })
        continue
      }
      if (endSec > t.endSec + SOURCE_END_TOLERANCE_SEC) {
        throw new DeterministicJobError(
          `apply-edl: segment[${i}] "${seg.id}" ends at ${endSec.toFixed(2)}s on source "${id}", ` +
            `but its ${track} track is only ${t.endSec.toFixed(2)}s long — shorten the segment or check the source's offsetMs`,
        )
      }
    }
  })
  return skipped
}

async function hasAudioStream(filePath: string): Promise<boolean> {
  try {
    const out = await runFfprobe([
      "-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath,
    ])
    return out.trim().length > 0
  } catch {
    return false
  }
}

/** Proxy renders cap the picture at 720p (height), preserving aspect, even-rounded. */
function targetForQuality(
  picked: { width: number; height: number },
  quality: "proxy" | "final",
): { width: number; height: number } {
  if (quality !== "proxy" || picked.height <= 720) return even(picked)
  const scale = 720 / picked.height
  return even({ width: picked.width * scale, height: 720 })
}

const even = (d: { width: number; height: number }): { width: number; height: number } => ({
  width: Math.max(2, Math.round(d.width / 2) * 2),
  height: Math.max(2, Math.round(d.height / 2) * 2),
})

/** How ONE contiguous slice of segments renders (see `buildSliceCommand`). */
export interface SliceOptions {
  readonly output: "video" | "audio"
  /** Keys the ENCODER: a proxy (review) render encodes fast at a lower
   *  quality; a final one at delivery quality — whatever the canvas size. (It
   *  used to key on `target.height <= 720`, so a FINAL render of 720p sources
   *  got the proxy encoder.) The canvas cap is `targetForQuality`'s job. */
  readonly quality: "proxy" | "final"
  readonly target: { width: number; height: number }
  readonly fps: number
  /** This chunk's start position on the GLOBAL output timeline, in seconds
   *  (Σ of prior chunks' output length). The cumulative frame grid (Track
   *  0.14) is laid from here so chunk seams sit on the same grid — a chunked
   *  render holds round(totalDur·fps) frames end to end, not per chunk. */
  readonly chunkStartSec: number
  readonly masterAudioId: string | undefined
  readonly audioPresent: Map<string, boolean>
  /** Render the PICTURE only, no audio track (video output only). Used for the
   *  chunks of a multi-chunk video render: their audio would be encoded and
   *  concatenated per chunk, injecting AAC priming at every seam; instead the
   *  audio is rendered once over the whole timeline and muxed on at the end
   *  (option B). A single-chunk render keeps its audio (no seam). */
  readonly omitAudio?: boolean
  /** Audio codec for an AUDIO slice: `aac` (a deliverable) or `pcm` — lossless
   *  32-bit float in RF64/WAV, for the slices of option B's audio pass and the
   *  chunks of a chunked audio render, which join sample-exactly and are
   *  encoded to AAC ONCE (no per-seam priming). */
  readonly audioCodec?: "aac" | "pcm"
}

/** One slice's ffmpeg command, built WITHOUT touching the filesystem so a
 *  resume key can be derived from exactly what would render (`sliceFingerprint`)
 *  before anything runs. Local paths are bound at run time (`runSlice`). */
export interface SliceCommand {
  /** Source ids in ffmpeg input order; a silence generator follows them when
   *  `needsSilence`. */
  readonly inputIds: readonly string[]
  readonly needsSilence: boolean
  /** The whole filter graph. `runSlice` hands it to ffmpeg as a FILE
   *  (`-/filter_complex`): a graph grows ~160 B per segment and a single argv
   *  string is capped at 128 KiB on Linux (spawn E2BIG), a limit a dev Mac
   *  never shows. */
  readonly filterGraph: string
  /** Every output argument except the output path. */
  readonly outputArgs: readonly string[]
  /** Per input (aligned with `inputIds`), the `-ss` seek in seconds; 0 = none.
   *  The graph's trim times are relative to it, so the fingerprint hashes it. */
  readonly inputSeekSec: readonly number[]
  /** The ffmpeg kill budget for this slice (`chunkRenderTimeoutMs`). */
  readonly timeoutMs: number
}

/**
 * Build the command that renders ONE contiguous slice of segments (internal
 * boundaries may be cut or crossfade) through a single filter_complex.
 * `audioPresent` maps a source id to whether its file carries an audio stream.
 */
export function buildSliceCommand(edl: Edl, segs: readonly EdlSegment[], opts: SliceOptions): SliceCommand {
  const { output, target, fps, chunkStartSec, masterAudioId, audioPresent, omitAudio, audioCodec = "aac" } = opts
  const wantVideo = output === "video"
  const emitAudio = !omitAudio // audio-only renders never pass omitAudio

  // Stable ffmpeg input list: every distinct source this slice touches, plus a
  // shared silent generator when some segment's audio source has no track.
  const inputIds: string[] = []
  const inputIndexOf = new Map<string, number>()
  const addInput = (id: string): number => {
    if (inputIndexOf.has(id)) return inputIndexOf.get(id)!
    const idx = inputIds.length
    inputIds.push(id)
    inputIndexOf.set(id, idx)
    return idx
  }

  interface SegPlan { readonly vLabel?: string; readonly aLabel?: string }
  const filters: string[] = []
  const plans: SegPlan[] = []
  let needsSilence = false

  // A/V DRIFT (Track 0.14): the video timeline is laid on ONE cumulative frame
  // grid so it tracks the sample-exact audio. `fps=${fps}` on EACH segment
  // resamples that segment's DURATION independently; when a source's fps differs
  // from the canvas (fractional 29.97, or a mixed-fps multicam) the per-segment
  // rounding is systematic and accumulates across cuts — measured at +0.44s over
  // 90 cuts of a 30/24 fps two-cam edit, while the audio does not move. Instead
  // each cut segment gets EXACTLY N_i = round(cumEnd_i·F) − round(cumStart_i·F)
  // frames, where cumStart_i is the segment's GLOBAL output position (this
  // chunk's start + the segments before it). The counts telescope, so the whole
  // render holds round(totalDur·F) frames and the video end lands within a frame
  // of the audio (measured +0.003s over the same 90 cuts). A chunk that
  // CONTAINS a crossfade is on the same grid, laid on the overlap-compressed
  // output timeline (`xfPlan`, Track 0.16): every segment keeps exactly its
  // grid frames and every xfade blends whole frames at a frame-counted offset,
  // so no boundary drifts and no real frame is cut. Both kinds of chunk still
  // end with `gridHold` — a backstop that guarantees the chunk's count, which
  // option B's single continuous audio pass depends on.
  const chunkHasXfade = wantVideo && segs.some((s, i) => i > 0 && boundaryOverlapSecs(s, segs[i - 1]) > 0)
  const useGrid = wantVideo && !chunkHasXfade

  // Each segment's GLOBAL frame interval [startF, endF), for both kinds of
  // chunk, computed with EXACTLY `chunkOutputSec`'s arithmetic: the running
  // prefix is `(prefix + duration) − overlap` in that operation order, so the
  // last segment's end is the bitwise-same double `gridN` rounds and the caller
  // adds to the next chunk's `chunkStartSec`. A chunk's plan, its gridHold and
  // the next chunk's first frame therefore agree even at an exact half-frame
  // tie, where two float orders of the same sum round to opposite frames. A
  // plan built from a different running sum disagreed with gridHold at ~1–5% of
  // crossfade chunks at 25/30/50/60 fps (gridHold then cloned the last frame in
  // place of a real one), and a cut-only chunk's end could miss the next
  // chunk's start by a frame — a one-frame A/V step per such seam. A cut's
  // start IS the previous end (the same integer), so the counts telescope.
  const intervals: Array<{ readonly startF: number; readonly endF: number; readonly overlapSec: number }> = []
  {
    let prefix = 0
    let prevEndF = Math.round(chunkStartSec * fps)
    segs.forEach((seg, i) => {
      const overlapSec = i > 0 ? boundaryOverlapSecs(seg, segs[i - 1]) : 0
      const startF = overlapSec > 0 ? Math.round((chunkStartSec + (prefix - overlapSec)) * fps) : prevEndF
      prefix = prefix + secs(seg.outMs - seg.inMs) - overlapSec
      const endF = Math.round((chunkStartSec + prefix) * fps)
      intervals.push({ startF, endF, overlapSec })
      prevEndF = endF
    })
  }

  // Per-segment frame counts on the global cumulative grid (grid path only).
  const gridFrames: number[] = []
  if (useGrid) {
    for (const { startF, endF } of intervals) gridFrames.push(endF - startF)
    // A whole chunk shorter than half a frame would round to zero frames
    // everywhere and leave no video stream at all — give the first segment one
    // frame so the render still produces a picture (degenerate EDL, never real).
    if (gridFrames.length > 0 && !gridFrames.some((n) => n > 0)) gridFrames[0] = 1
  }

  // Per-segment frame plan for a chunk that CONTAINS a crossfade (Track 0.16) —
  // the same intervals, on the overlap-compressed output timeline. The joined
  // picture so far ends at `accEndF`. A crossfade blends exactly
  // `accEndF − startF` frames at an offset counted in FRAMES, so nothing is
  // lost: the old offset accumulated NOMINAL seconds while each segment's `fps`
  // output rounded (a sliver or a one-frame segment rounds UP), and xfade
  // silently cut the long outgoing tail. A crossfade that rounds to under one
  // frame is a cut; one whose incoming segment lies wholly inside the overlap
  // adds nothing (its end equals the picture's end — no frame is lost), and a
  // zero-frame segment drops out. `endF` never decreases, so `accEndF` is
  // always the previous kept segment's end and a cut's incoming segment is
  // never partly covered. The chunk then holds exactly its grid count
  // (`accEndF − chunkStartF === gridN`); gridHold below is the backstop.
  interface XfSeg { readonly frames: number; readonly join: "first" | "concat" | "xfade" | "none"; readonly xfFrames: number; readonly offsetFrames: number }
  const xfPlan: XfSeg[] = []
  if (chunkHasXfade) {
    const chunkStartF = Math.round(chunkStartSec * fps)
    let accEndF = chunkStartF
    let started = false
    intervals.forEach(({ startF, endF, overlapSec }) => {
      const frames = Math.max(0, endF - startF)
      const covered = Math.max(0, accEndF - startF) // frames of this segment the picture already holds
      if (started && overlapSec > 0 && covered >= 1 && covered < frames) {
        xfPlan.push({ frames, join: "xfade", xfFrames: covered, offsetFrames: startF - chunkStartF })
        accEndF = endF
      } else if (frames - covered > 0) {
        xfPlan.push({ frames, join: started ? "concat" : "first", xfFrames: 0, offsetFrames: 0 })
        started = true
        accEndF = endF
      } else {
        xfPlan.push({ frames, join: "none", xfFrames: 0, offsetFrames: 0 })
      }
    })
    // Degenerate: the whole chunk rounds to no frame — keep one so a picture exists.
    if (!started && xfPlan.length > 0) xfPlan[0] = { frames: 1, join: "first", xfFrames: 0, offsetFrames: 0 }
  }

  const scalePad =
    `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,` +
    `pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=black`

  // Where each segment reads, on its source's own clock (master − offsetMs).
  const videoReadOf = (seg: EdlSegment) => {
    const vs = edl.sources.find((s) => s.id === seg.video)!
    // max(0): unreachable in a render — assertSegmentsWithinSources refuses a
    // pre-origin read first; kept so a direct builder call never asks for
    // negative source time.
    const start = Math.max(0, secs(seg.inMs - offsetOf(vs)))
    return { id: vs.id, start, end: Math.max(start, secs(seg.outMs - offsetOf(vs))) }
  }
  const audioReadOf = (seg: EdlSegment) => {
    const aId = audioSourceId(edl, seg, masterAudioId)
    const aSrc = aId ? edl.sources.find((s) => s.id === aId) : undefined
    if (!aSrc || !audioPresent.get(aSrc.id)) return undefined
    const start = Math.max(0, secs(seg.inMs - offsetOf(aSrc)))
    return { id: aSrc.id, start, end: Math.max(start, secs(seg.outMs - offsetOf(aSrc))) }
  }

  // INPUT SEEK. `trim`/`atrim` run AFTER the decoder, so without a seek a slice
  // whose window sits at t=T decodes every source from 0 just to discard it:
  // with chunks capped at 30 segments, the last chunk of an hour-long 1080p edit
  // took 1,475 s on 2 cores against its 1,200 s kill budget (pinned 8.1.2). Each
  // input is instead seeked (`-ss` before `-i`, frame/sample-accurate — ffmpeg
  // decodes from the prior keyframe and discards up to the target) to its
  // EARLIEST read in this slice minus INPUT_SEEK_MARGIN_SEC, and every trim on it
  // is rebased by that offset. Measured byte-identical to the unseeked render.
  const minReadOf = new Map<string, number>()
  const noteRead = (id: string, t: number) => minReadOf.set(id, Math.min(minReadOf.get(id) ?? Infinity, t))
  segs.forEach((seg, i) => {
    const dropped = useGrid ? gridFrames[i] <= 0 : chunkHasXfade && xfPlan[i]!.join === "none"
    if (wantVideo && !dropped) noteRead(videoReadOf(seg).id, videoReadOf(seg).start)
    if (emitAudio) {
      const a = audioReadOf(seg)
      if (a) noteRead(a.id, a.start)
    }
  })
  const seekOf = (id: string): number =>
    Math.max(0, Math.floor(((minReadOf.get(id) ?? 0) - INPUT_SEEK_MARGIN_SEC) * 1000) / 1000)

  segs.forEach((seg, i) => {
    const durS = secs(seg.outMs - seg.inMs)

    // --- video --- (`:V` — a real video stream, never embedded cover art;
    // the same stream `probeStreamEnds` measured). Every picture read starts
    // from the SOURCE held past its end (`tpad` clone): a window that reaches
    // beyond the camera's last frame — inside SOURCE_END_TOLERANCE_SEC, which the
    // window check accepts — reads a frozen last frame instead of coming up
    // short. A short segment would otherwise pull every later cut ahead of the
    // single continuous audio track (option B) for the rest of the render.
    let vLabel: string | undefined
    if (wantVideo) {
      const v = videoReadOf(seg)
      const seek = seekOf(v.id)
      const start = v.start - seek
      const end = v.end - seek
      const held = `[${addInput(v.id)}:V]tpad=stop_mode=clone:stop=-1,`
      if (useGrid) {
        const nFrames = gridFrames[i]
        // nFrames === 0 is a sub-half-frame cut: it contributes NO video frame
        // (skipped from the chain), while its audio atrim below still plays and
        // the next segment's N absorbs the rounding — the total stays on grid.
        if (nFrames > 0) {
          vLabel = `[v${i}]`
          // Read a few frames past the window so `fps` yields at least N_i
          // frames, then keep EXACTLY N_i — every kept frame sits on the shared
          // output grid, with no per-segment `fps` accumulation. The held source
          // always has those frames, even past its real end.
          const readEnd = end + APPLY_EDL_GRID_READ_GUARD_FRAMES / fps
          filters.push(
            `${held}trim=start=${start.toFixed(6)}:end=${readEnd.toFixed(6)},setpts=PTS-STARTPTS,` +
              `${scalePad},fps=${fps},trim=start_frame=0:end_frame=${nFrames},setpts=PTS-STARTPTS,` +
              `format=yuv420p,setsar=1${vLabel}`,
          )
        }
      } else {
        // xfade chunk (Track 0.16): exactly the segment's grid frames — read
        // past the window from the held source, then keep that many, like the
        // grid path.
        const plan = xfPlan[i]!
        if (plan.join !== "none") {
          vLabel = `[v${i}]`
          const readEnd = end + APPLY_EDL_GRID_READ_GUARD_FRAMES / fps
          filters.push(
            `${held}trim=start=${start.toFixed(6)}:end=${readEnd.toFixed(6)},setpts=PTS-STARTPTS,` +
              `${scalePad},fps=${fps},trim=start_frame=0:end_frame=${plan.frames},setpts=PTS-STARTPTS,` +
              `format=yuv420p,setsar=1${vLabel}`,
          )
        }
      }
    }

    // --- audio --- (skipped for a video-only chunk; the audio is rendered once
    // over the whole timeline and muxed on later). `apad` holds the source past
    // its end with silence, so every segment's sound is EXACTLY its window —
    // the joined audio track cannot come up short and slide later cuts early.
    let aLabel: string | undefined
    if (emitAudio) {
      const a = audioReadOf(seg)
      aLabel = `[a${i}]`
      if (a) {
        const seek = seekOf(a.id)
        filters.push(
          `[${addInput(a.id)}:a]apad,atrim=start=${(a.start - seek).toFixed(6)}:end=${(a.end - seek).toFixed(6)},asetpts=PTS-STARTPTS,` +
            `aformat=sample_rates=48000:channel_layouts=stereo${aLabel}`,
        )
      } else {
        // No usable audio track for this segment — synthesize silence of exactly
        // the segment's length so the audio timeline stays continuous.
        needsSilence = true
        filters.push(
          `[SILENCE]atrim=duration=${durS.toFixed(6)},asetpts=PTS-STARTPTS,` +
            `aformat=sample_rates=48000:channel_layouts=stereo${aLabel}`,
        )
      }
    }

    plans.push({ vLabel, aLabel })
  })
  const inputSeekSec = inputIds.map((id) => seekOf(id))

  // Re-point the [SILENCE] placeholder at the anullsrc input, which `runSlice`
  // appends right after the sources.
  const graph = needsSilence
    ? filters.map((f) => f.replaceAll("[SILENCE]", `[${inputIds.length}:a]`)).join(";")
    : filters.join(";")

  // Audio joins pairwise with offsets in seconds (like combine-videos'
  // buildVideoFilter); the video chain below counts whole frames (xfPlan).
  const durs = segs.map((s) => secs(s.outMs - s.inMs))
  const chainParts: string[] = []

  // audio chain (skipped for a video-only chunk)
  let audioOutLabel: string | undefined
  if (emitAudio) {
    let aAcc = plans[0].aLabel!
    let runA = durs[0]
    for (let i = 1; i < segs.length; i++) {
      const D = boundaryOverlapSecs(segs[i], segs[i - 1])
      const out = i === segs.length - 1 ? "[aout]" : `[aAcc${i}]`
      if (D > 0) {
        chainParts.push(`${aAcc}${plans[i].aLabel!}acrossfade=d=${D.toFixed(6)}${out}`)
        runA = Math.max(0, runA - D) + durs[i]
      } else {
        chainParts.push(`${aAcc}${plans[i].aLabel!}concat=n=2:v=0:a=1${out}`)
        runA += durs[i]
      }
      aAcc = out
    }
    audioOutLabel = segs.length === 1 ? plans[0].aLabel! : "[aout]"
  }

  // video chain (video output only)
  let videoOutLabel: string | undefined
  if (wantVideo && chunkHasXfade) {
    // xfade chunk — joined in plan order (Track 0.16). Every xfade's duration
    // and offset are whole FRAMES of the accumulated picture, so the chain is
    // frame-exact and ends on the grid; `gridHold` stays as the backstop that
    // guarantees the chunk's count for option B's continuous audio.
    // `concat` outputs on the microsecond timebase while segments and xfade
    // outputs are on 1/fps; xfade refuses mismatched inputs (Track 0.15), so a
    // cut is renumbered by frame index and put back on 1/fps — keeping every
    // frame even at degenerate joins (a bare `fps` dropped one there).
    let vAcc: string | undefined
    for (let i = 0; i < segs.length; i++) {
      const plan = xfPlan[i]!
      const label = plans[i].vLabel
      if (plan.join === "none" || !label) continue
      if (!vAcc) {
        vAcc = label
        continue
      }
      const out = `[vAcc${i}]`
      if (plan.join === "xfade") {
        chainParts.push(`${vAcc}${label}xfade=transition=fade:duration=${(plan.xfFrames / fps).toFixed(6)}:offset=${(plan.offsetFrames / fps).toFixed(6)}${out}`)
      } else {
        chainParts.push(`${vAcc}${label}concat=n=2:v=1:a=0,setpts=N/FRAME_RATE/TB,fps=${fps}${out}`)
      }
      vAcc = out
    }
    chainParts.push(`${vAcc!}null[vxf]`)
    const gridN = Math.max(1, Math.round((chunkStartSec + chunkOutputSec(segs)) * fps) - Math.round(chunkStartSec * fps))
    chainParts.push(`[vxf]${gridHold(gridN)}[vout]`)
    videoOutLabel = "[vout]"
  } else if (wantVideo) {
    // grid chunk — every surviving segment is already `fps` with an integer
    // frame count, so a plain concat yields a clean CFR timeline (zero-frame
    // segments were dropped above). No final resample: the counts are on grid.
    const vLabels = plans.map((p) => p.vLabel).filter((l): l is string => !!l)
    let vcat = vLabels[0]
    for (let i = 1; i < vLabels.length; i++) {
      const out = `[vAcc${i}]`
      chainParts.push(`${vcat}${vLabels[i]}concat=n=2:v=1:a=0${out}`)
      vcat = out
    }
    // Every segment is already exactly N_i frames (held source), so this is
    // a no-op in practice — it is the backstop that GUARANTEES the chunk ends on
    // the grid, which option B's continuous audio depends on.
    chainParts.push(`${vcat}${gridHold(gridFrames.reduce((a, n) => a + n, 0))}[vout]`)
    videoOutLabel = "[vout]"
  }

  const fullFilter = [graph, ...chainParts].filter(Boolean).join(";")

  const proxy = opts.quality === "proxy"
  const outputArgs: string[] = []
  if (wantVideo) {
    outputArgs.push("-map", videoOutLabel!)
    if (emitAudio) outputArgs.push("-map", audioOutLabel!)
    outputArgs.push(
      "-c:v", "libx264",
      "-preset", proxy ? "veryfast" : "fast",
      "-crf", proxy ? "26" : COMBINE_DELIVERY_CRF,
      "-pix_fmt", "yuv420p",
    )
    if (emitAudio) outputArgs.push(...AAC_DELIVERY_ARGS)
    else outputArgs.push("-an")
    outputArgs.push("-movflags", "+faststart")
  } else if (audioCodec === "pcm") {
    // RF64 keeps a multi-hour f32 stereo slice past WAV's 4 GiB header limit.
    outputArgs.push("-map", audioOutLabel!, "-c:a", "pcm_f32le", "-ar", "48000", "-ac", "2", "-rf64", "auto")
  } else {
    outputArgs.push("-map", audioOutLabel!, ...AAC_DELIVERY_ARGS)
  }

  // Explicit longer timeout: the default 10-min per-spawn would kill a long
  // chunk. The handler's liveness budget (`applyEdlRenderBudgetMs`) is summed
  // from this same per-chunk figure, so "hung" means one thing to both.
  return { inputIds, needsSilence, filterGraph: fullFilter, outputArgs, inputSeekSec, timeoutMs: chunkRenderTimeoutMs(edl, segs, { video: wantVideo, audio: emitAudio }, { width: target.width, height: target.height, fps }) }
}

/** Run a built slice: bind the local source paths, hand ffmpeg the graph as a
 *  file (`-/filter_complex` — never as one argv string, see `SliceCommand`),
 *  write `outPath`. */
async function runSlice(cmd: SliceCommand, sourcePaths: Map<string, string>, outPath: string): Promise<void> {
  const graphPath = `${outPath}.filtergraph`
  await fs.writeFile(graphPath, cmd.filterGraph)
  const args: string[] = ["-y"]
  cmd.inputIds.forEach((id, k) => {
    // Omit the seek entirely at 0 — `-ss 0` still changes how an AAC input's
    // first frame is primed.
    if (cmd.inputSeekSec[k] > 0) args.push("-ss", cmd.inputSeekSec[k].toFixed(3))
    args.push("-i", sourcePaths.get(id)!)
  })
  if (cmd.needsSilence) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo")
  args.push("-/filter_complex", graphPath, ...cmd.outputArgs, outPath)
  try {
    await runFfmpeg(args, cmd.timeoutMs)
  } finally {
    await fs.rm(graphPath, { force: true })
  }
}

async function renderSlice(
  edl: Edl,
  segs: readonly EdlSegment[],
  opts: SliceOptions & { readonly sourcePaths: Map<string, string>; readonly outPath: string },
): Promise<void> {
  await runSlice(buildSliceCommand(edl, segs, opts), opts.sourcePaths, opts.outPath)
}

/**
 * The resume identity of a slice: a hash of EXACTLY what would render — the
 * filter graph (trims, frame counts, grid position, canvas, fps), each input's
 * seek (the graph's trims are relative to it), the encode arguments, the
 * sources by id + URL (never the per-run local paths), and the ffmpeg build. A checkpoint is reused only under this key, so any change to
 * chunk planning, the grid, the width cap, `omitAudio`, the encode, or the
 * ffmpeg pin misses the old object instead of splicing a chunk rendered for a
 * different plan into this one (which once completed a job with a scrambled
 * picture over the right audio — and deleted the evidence). There is no scheme
 * version to remember to bump: the key IS the command.
 */
export function sliceFingerprint(cmd: SliceCommand, edl: Edl, ffmpegVersion: string): string {
  const sources = cmd.inputIds.map((id) => [id, edl.sources.find((s) => s.id === id)?.url ?? null])
  return createHash("sha256")
    .update(JSON.stringify({ ffmpegVersion, sources, inputSeekSec: cmd.inputSeekSec, needsSilence: cmd.needsSilence, filterGraph: cmd.filterGraph, outputArgs: cmd.outputArgs }))
    .digest("hex")
    .slice(0, 16)
}

export async function applyEdl(options: ApplyEdlOptions): Promise<ApplyEdlResult> {
  const { edl, output, quality, jobId, jobUserId, onProgress, checkpoint = true } = options
  const wantVideo = output === "video"
  const workDir = await createWorkDir("apply-edl")
  const ext = wantVideo ? "mp4" : "m4a"
  // Every checkpoint key this attempt uploaded or resumed — outside the `try`
  // so a cancelled render can delete them too (see the catch).
  const checkpointKeys: string[] = []

  try {
    // Which sources do we actually touch? Download each ONCE.
    const masterAudio = edl.sources.find((s) => s.role === "master-audio")
    const masterAudioId = masterAudio?.id
    const referenced = referencedSourceIds(edl, output)

    const sourcePaths = new Map<string, string>()
    const audioPresent = new Map<string, boolean>()
    const sourceEnds = new Map<string, StreamEnds>()
    let dl = 0
    for (const id of referenced) {
      // Cancellation boundary (see the chunk loop below).
      await throwIfJobCancelled()
      const src = edl.sources.find((s) => s.id === id)
      if (!src) throw new Error(`apply-edl: segment references unknown source "${id}"`)
      const localPath = join(workDir, `src-${sourcePaths.size}.${src.kind === "audio" ? "m4a" : "mp4"}`)
      await downloadFile(src.url, localPath)
      sourcePaths.set(id, localPath)
      audioPresent.set(id, await hasAudioStream(localPath))
      // The one per-source measurement that lets the window check below be
      // honest: each track's REAL end, from its own packets, on the render's
      // clock — not the container's declared duration (a Xing-less VBR mp3
      // under-reports it; a live-muxed MediaRecorder WebM omits it; both
      // render fine), and not one blended number for a file whose picture and
      // sound differ in length. A file this cannot read at all stays
      // unmeasured: the check skips it (logged) rather than failing a paid job
      // over a probe — and since every read is held past its source's end, a
      // segment that overruns such a track renders its full window as a frozen
      // last frame / silence, however long the overrun.
      try {
        sourceEnds.set(id, await probeStreamEnds(localPath))
      } catch (err) {
        console.warn(
          `[apply-edl] source "${id}": could not measure its tracks, the window check skips it (${err instanceof Error ? err.message : String(err)})`,
        )
      }
      dl++
      onProgress?.(0.05 + 0.15 * (dl / referenced.size))
    }

    // Every segment must exist on the media it reads. Ingress already refused a
    // segment that starts before its source's origin; only the file itself can
    // say whether one runs PAST the end of the track it reads — so it is
    // checked here, once the sources are local, per track, and the job FAILS
    // naming the segment (a DeterministicJobError: failed + refunded now, not
    // retried — the same inputs fail the same way). It never clamps: a silently
    // shortened segment would deliver a shorter render than the EDL (and than
    // the reserve and the caption remap) describes, with no error anywhere.
    // Overshoot inside SOURCE_END_TOLERANCE_SEC is rounding — a transcript's
    // last word can end a beat after the audio — and renders its full window
    // (the source is held past its end: frozen last frame, silence).
    const skipped = assertSegmentsWithinSources(edl, masterAudioId, wantVideo, sourceEnds)
    for (const s of skipped) {
      console.warn(
        `[apply-edl] segment "${s.segment}" reads the ${s.track} track of source "${s.source}", which could not be measured — the window check skips it (${s.reason})`,
      )
    }

    // Picture canvas (video output only): majority resolution / fps of the
    // referenced VIDEO sources, then proxy-capped.
    let target = { width: 1280, height: 720 }
    let fps = 30
    if (wantVideo) {
      const videoPaths = [...referenced]
        .map((id) => edl.sources.find((s) => s.id === id))
        .filter((s): s is EdlSource => !!s && s.kind === "video")
        .map((s) => sourcePaths.get(s.id)!)
      const picked = videoPaths.length > 0 ? await pickTargetResolution(videoPaths) : { width: 1280, height: 720 }
      target = targetForQuality(picked, quality)
      fps = videoPaths.length > 0 ? await pickTargetFps(videoPaths) : 30
    }

    const chunks = resolveChunksForOutput(edl.segments, output, options)
    // A multi-chunk render never encodes AAC per chunk: a stream-copy concat of
    // AAC chunks injects encoder priming at every seam. A VIDEO render renders
    // its chunks WITHOUT audio and muxes one continuous audio track on at the
    // end (option B); an AUDIO render renders its chunks as lossless PCM, joined
    // and encoded to AAC once. A single-chunk render keeps its audio inline.
    const muxAudioSeparately = wantVideo && chunks.length > 1
    const pcmChunks = !wantVideo && chunks.length > 1
    // Only picture chunks are checkpointed. A sound slice is capped at
    // AUDIO_FILTERGRAPH_MAX_SEGMENTS and re-renders in seconds, while its PCM
    // (~23 MB per minute) would cost more to upload and fetch back than that.
    const useCheckpoint = checkpoint && muxAudioSeparately
    // Resume keys hash the exact command, including the ffmpeg build.
    const ffmpegVersion = useCheckpoint ? await ffmpegVersionLine() : ""

    const chunkPaths: string[] = []
    // Running GLOBAL output position handed to each chunk so the cumulative
    // frame grid (Track 0.14) is continuous across chunk seams — advanced by
    // every chunk, resumed ones included, so a resume can't shift the grid.
    let chunkStartSec = 0
    for (let c = 0; c < chunks.length; c++) {
      // Chunk boundary = cancellation boundary. A user cancel (or the
      // orchestrator's `cancelJobAndThrow` on a timed-out / cancelled run)
      // flips the row to `cancelled`; the video worker runs every handler
      // inside `runWithJobCancellation`, so this throttled check sees it and
      // throws `JobCancelledError` before the next chunk takes an ffmpeg slot —
      // a cancelled multi-hour render stops within one chunk instead of
      // rendering (and holding a slot) to the end. The chunk in flight finishes
      // under its own kill budget. The checkpoints uploaded so far are keyed by
      // this jobId, and a cancelled job is never resumed, so the catch below
      // deletes them. Outside a worker context (tests, the characterization
      // suite) this is a no-op.
      await throwIfJobCancelled()
      const chunkPath = join(workDir, `chunk-${c}.${pcmChunks ? "wav" : ext}`)
      const cmd = buildSliceCommand(edl, chunks[c], {
        output, quality, target, fps, chunkStartSec, masterAudioId, audioPresent, omitAudio: muxAudioSeparately,
        ...(pcmChunks ? { audioCodec: "pcm" as const } : {}),
      })
      // The key is the command's fingerprint, so a checkpoint rendered for a
      // different plan (other chunk boundaries, grid position, width cap,
      // encode, or ffmpeg build — e.g. an attempt that started before a deploy)
      // is never spliced into this one: it simply isn't found.
      const key = `apply-edl-cache/${jobId}/chunk-${c}-${sliceFingerprint(cmd, edl, ffmpegVersion)}.${ext}`

      // Resume: a chunk already checkpointed to R2 (a prior worker attempt) is
      // pulled back instead of re-rendered. Storage is dynamically imported so
      // the module graph (and unit tests) never pull the R2 client unless a
      // real multi-chunk render needs it.
      let resumed = false
      if (useCheckpoint) {
        try {
          const { getR2ObjectSize, downloadR2ObjectToFile } = await import("../../lib/storage.js")
          if ((await getR2ObjectSize(key)) > 0) {
            await downloadR2ObjectToFile(key, chunkPath)
            resumed = true
          }
        } catch {
          /* checkpoint miss — render below */
        }
      }

      if (!resumed) {
        await runSlice(cmd, sourcePaths, chunkPath)
        if (useCheckpoint) {
          try {
            const { uploadFileWithKeyToR2 } = await import("../../lib/storage.js")
            // No trackUserId: this is internal render scratch, not a
            // deliverable, so it must never count against the user's quota.
            await uploadFileWithKeyToR2(chunkPath, key, "video/mp4", undefined)
          } catch {
            /* checkpoint upload best-effort — a restart just re-renders */
          }
        }
      }
      if (useCheckpoint) checkpointKeys.push(key)
      chunkPaths.push(chunkPath)
      chunkStartSec += chunkOutputSec(chunks[c])
      onProgress?.(0.2 + 0.7 * ((c + 1) / chunks.length))
    }

    // Single chunk → it IS the output. Multiple chunks (all joined at hard
    // cuts) → a concat-demuxer join: stream-copy for picture chunks, one AAC
    // encode for an audio render's lossless chunks.
    //
    // Scratch disk: the steps below are ordered so every file dies at its LAST
    // read — a 3-hour two-camera 1080p render holds ~15 GB of sources, ~10 GB of
    // picture and ~4 GB of PCM, and the mux peak used to hold all of them plus
    // the output (~40 GB). Order: audio slices (last read of the sources) →
    // delete the sources → concat the chunks → delete the chunks → mux → delete
    // the PCM + picture intermediate. Peak ≈ sources + chunks + PCM.
    const writeList = (path: string, files: readonly string[]) =>
      fs.writeFile(path, files.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"))
    let outputPath: string
    if (chunkPaths.length === 1) {
      outputPath = chunkPaths[0]
    } else {
      // Option B (a chunked VIDEO render): ONE continuous audio track over the
      // whole timeline, encoded to AAC once. It is rendered in slices of the
      // audio plan — at most AUDIO_FILTERGRAPH_MAX_SEGMENTS each, split only at
      // hard cuts so an acrossfade is never cut (a slice's cost grows with
      // segments² × the source span it decodes; see that constant). Only the
      // video chunks are checkpointed — a retry re-runs this pass, which is
      // cheap at that width. Each slice is lossless PCM, so joining them is
      // sample-exact and adds no encoder priming; the single AAC encode happens
      // in the mux, which stream-copies the picture. (A chunked AUDIO render's
      // chunks already are such slices.)
      const pcmPaths: string[] = []
      if (muxAudioSeparately) {
        const audioChunks = resolveChunksForOutput(edl.segments, "audio", options)
        for (let k = 0; k < audioChunks.length; k++) {
          // Same cancellation boundary as the picture chunks.
          await throwIfJobCancelled()
          const pcmPath = join(workDir, `audio-${k}.wav`)
          await renderSlice(edl, audioChunks[k], {
            output: "audio", audioCodec: "pcm", quality, target, fps, chunkStartSec: 0, masterAudioId, audioPresent, sourcePaths, outPath: pcmPath,
          })
          pcmPaths.push(pcmPath)
        }
      }
      // Nothing reads the sources past this point.
      await Promise.all([...sourcePaths.values()].map((p) => fs.rm(p, { force: true })))
      // Last boundary before the join (and its one AAC encode).
      await throwIfJobCancelled()

      const listPath = join(workDir, "chunks.txt")
      await writeList(listPath, chunkPaths)
      outputPath = join(workDir, `output.${ext}`)
      if (pcmChunks) {
        // A chunked AUDIO render: join the lossless chunks sample-exactly and
        // encode AAC once — that is the output.
        await runFfmpeg(
          ["-y", "-f", "concat", "-safe", "0", "-i", listPath, ...AAC_DELIVERY_ARGS, "-movflags", "+faststart", outputPath],
          audioMuxTimeoutMs(edlDurationMs(edl) / 1000),
        )
        await Promise.all(chunkPaths.map((p) => fs.rm(p, { force: true })))
      } else {
        // A chunked VIDEO render: its chunks are picture-only — concat them into
        // a picture scratch file, then mux the audio on.
        const concatPath = join(workDir, `video.${ext}`)
        await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", concatPath])
        // The chunks now live in `concatPath` (and in R2 for a resume).
        await Promise.all(chunkPaths.map((p) => fs.rm(p, { force: true })))
        const audioListPath = join(workDir, "audio-chunks.txt")
        await writeList(audioListPath, pcmPaths)
        await runFfmpeg(
          [
            "-y", "-i", concatPath, "-f", "concat", "-safe", "0", "-i", audioListPath,
            "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", ...AAC_DELIVERY_ARGS,
            "-movflags", "+faststart", outputPath,
          ],
          audioMuxTimeoutMs(edlDurationMs(edl) / 1000),
        )
        await Promise.all([...pcmPaths, concatPath].map((p) => fs.rm(p, { force: true })))
      }
    }

    // The final output exists — only NOW has the checkpoint cache done its job
    // (a failure in the concat, the audio pass or the mux resumes every chunk
    // instead of re-rendering the whole picture). Best-effort delete.
    await deleteCheckpoints(checkpointKeys)

    onProgress?.(1)
    return { outputPath, durationMs: edlDurationMs(edl) }
  } catch (err) {
    // A CANCELLED render is never resumed (the row is terminal, and the video
    // worker does not retry a JobCancelledError), so its checkpoints are dead
    // weight — delete them like the success path does. Any OTHER failure keeps
    // them: BullMQ retries it under the SAME jobId and the retry resumes them.
    if (err instanceof JobCancelledError) await deleteCheckpoints(checkpointKeys)
    await cleanupWorkDir(workDir)
    throw err
  }
}

/**
 * Best-effort delete of a render's R2 checkpoints. NOTHING else deletes
 * apply-edl-cache/ today (no R2 lifecycle rule is configured): a job that
 * fails for good after uploading (its last BullMQ attempt, or a worker that
 * dies and is never retried), or any checkpoint under an older key scheme,
 * stays until a lifecycle rule is added for the prefix.
 */
async function deleteCheckpoints(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  try {
    const { deleteFromR2 } = await import("../../lib/storage.js")
    await Promise.allSettled(keys.map((k) => deleteFromR2(k)))
  } catch {
    /* cleanup is best-effort */
  }
}
