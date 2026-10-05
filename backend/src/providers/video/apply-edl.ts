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
 * Quality: a FINAL is the delivery encode. A PROXY (review) render is the same
 * edit on the same frame grid at ≤720p, encoded fast, with lighter MONO sound
 * at the same 48 kHz — the average of the final's two channels (`aacArgs`,
 * `PROXY_DOWNMIX`) — so its cuts are heard exactly where the final's are.
 *
 * Long edits render in chunks split ONLY at hard-cut boundaries (an xfade
 * cannot straddle a chunk), at most `VIDEO_FILTERGRAPH_MAX_SEGMENTS` segments
 * per picture graph and `AUDIO_FILTERGRAPH_MAX_SEGMENTS` per sound graph; a
 * crossfade run past that is closed at a hard cut made INSIDE one of its
 * segments (`planChunks`), whose second half keeps the whole segment's
 * picture frame phase (`PlanSegment.splitLeadMs`). A
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
import type { Edl, EdlSource } from "@nodaro/shared"
import { edlDurationMs } from "@nodaro/shared"
import {
  BIG_MEDIA_DOWNLOAD_LIMITS,
  downloadFile,
  runFfmpeg,
  runFfprobe,
  probeStreamEnds,
  type StreamEnds,
  createWorkDir,
  cleanupWorkDir,
  ffmpegVersionLine,
} from "./ffmpeg-utils.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { JobCancelledError, throwIfJobCancelled } from "../../lib/job-cancellation.js"
import { pickTargetResolution, pickTargetFps } from "./combine-videos.js"
import { ffmpegThreads, type FfmpegThreads } from "./ffmpeg-threads.js"
import {
  audioMuxTimeoutMs,
  audioSourceId,
  chunkOutputSec,
  referencedSourceIds,
  resolveChunksForOutput,
  secs,
  type ChunkPlanOptions,
  type PlanSegment,
} from "./apply-edl-budget.js"
import { aacArgs, buildSliceCommand, offsetOf, type SliceCommand, type SliceOptions } from "./apply-edl-slice.js"

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
  type SliceCommand,
  type SliceOptions,
} from "./apply-edl-slice.js"

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

/** The ffmpeg argv that runs a built slice: the local source paths bound in
 *  input order, the graph read from `graphPath` (`-/filter_complex` — never as
 *  one argv string, see `SliceCommand`), the output at `outPath`. With
 *  `threads` (the box's CPU quota sits below the cores ffmpeg counts —
 *  `ffmpegThreads`) every part is told its count: the filter graph
 *  (`-filter_complex_threads`, global, first), each source's decoder
 *  (`-threads` before its `-i`) and the output's encoders (`-threads` before
 *  the output path — an output option, so an audio-only slice's encoder takes
 *  it too, harmlessly). Without, the argv is exactly the unthreaded one. Pure. */
export function sliceArgv(
  cmd: SliceCommand,
  sourcePaths: ReadonlyMap<string, string>,
  graphPath: string,
  outPath: string,
  threads?: FfmpegThreads,
): string[] {
  const args: string[] = ["-y"]
  if (threads) args.push("-filter_complex_threads", String(threads.filter))
  cmd.inputIds.forEach((id, k) => {
    if (threads) args.push("-threads", String(threads.decode))
    // Omit the seek entirely at 0 — `-ss 0` still changes how an AAC input's
    // first frame is primed.
    if (cmd.inputSeekSec[k] > 0) args.push("-ss", cmd.inputSeekSec[k].toFixed(3))
    args.push("-i", sourcePaths.get(id)!)
  })
  if (cmd.needsSilence) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo")
  args.push("-/filter_complex", graphPath, ...cmd.outputArgs)
  if (threads) args.push("-threads", String(threads.encode))
  args.push(outPath)
  return args
}

/** Run a built slice (`sliceArgv`): write the graph file, render `outPath`. */
async function runSlice(cmd: SliceCommand, sourcePaths: Map<string, string>, outPath: string, threads?: FfmpegThreads): Promise<void> {
  const graphPath = `${outPath}.filtergraph`
  await fs.writeFile(graphPath, cmd.filterGraph)
  try {
    await runFfmpeg(sliceArgv(cmd, sourcePaths, graphPath, outPath, threads), cmd.timeoutMs)
  } finally {
    await fs.rm(graphPath, { force: true })
  }
}

async function renderSlice(
  edl: Edl,
  segs: readonly PlanSegment[],
  opts: SliceOptions & { readonly sourcePaths: Map<string, string>; readonly outPath: string; readonly threads?: FfmpegThreads },
): Promise<void> {
  await runSlice(buildSliceCommand(edl, segs, opts), opts.sourcePaths, opts.outPath, opts.threads)
}

/**
 * The resume identity of a slice: a hash of EXACTLY what would render — the
 * filter graph (trims, frame counts, grid position, canvas, fps), each input's
 * seek (the graph's trims are relative to it), the encode arguments, the
 * sources by id + URL (never the per-run local paths), the ffmpeg build, and
 * the thread counts it runs with (`sliceArgv` binds them at run time, like the
 * paths, but they change the encoded bits — x264's frame threads shape its
 * decisions). A checkpoint is reused only under this key, so any change to
 * chunk planning, the grid, the width cap, `omitAudio`, the encode, the
 * threads, or the ffmpeg pin misses the old object instead of splicing a chunk
 * rendered for a different plan into this one (which once completed a job with
 * a scrambled picture over the right audio — and deleted the evidence). There
 * is no scheme version to remember to bump: the key IS the command. A render
 * with no thread counts (no CPU quota) keeps the key it always had.
 */
export function sliceFingerprint(cmd: SliceCommand, edl: Edl, ffmpegVersion: string, threads?: FfmpegThreads): string {
  const sources = cmd.inputIds.map((id) => [id, edl.sources.find((s) => s.id === id)?.url ?? null])
  return createHash("sha256")
    .update(JSON.stringify({ ffmpegVersion, sources, inputSeekSec: cmd.inputSeekSec, needsSilence: cmd.needsSilence, filterGraph: cmd.filterGraph, outputArgs: cmd.outputArgs, threads }))
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
      // A source original can be many gigabytes (a 3-hour camera file ~15 GB):
      // the staged big-media limits, not the flat 120 s (Track 0.19).
      await downloadFile(src.url, localPath, { limits: BIG_MEDIA_DOWNLOAD_LIMITS })
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
    // (~23 MB per minute; half that for a proxy's mono) would cost more to
    // upload and fetch back than that.
    const useCheckpoint = checkpoint && muxAudioSeparately
    // Resume keys hash the exact command, including the ffmpeg build.
    const ffmpegVersion = useCheckpoint ? await ffmpegVersionLine() : ""
    // Every slice of this render runs with the box's CPU budget, read once:
    // ffmpeg's own auto-threading counts the host's cores, not the container's
    // quota, and at 4K that multiplied x264's frame threads (and their memory)
    // past what the box holds (`ffmpeg-threads.ts`). Undefined = no quota below
    // the cores ffmpeg sees; the render then runs exactly as before.
    const threads = ffmpegThreads()

    const chunkPaths: string[] = []
    // Running GLOBAL output position handed to each chunk so the cumulative
    // frame grid (Track 0.14) is continuous across chunk seams — advanced by
    // every chunk, resumed ones included, so a resume can't shift the grid.
    // Grid frames each picture chunk of a chunked video render holds, on the SAME
    // accumulation as `chunkStartSec` below (bit for bit). A chunk that rounds to
    // no frame — slivers under half a frame in all — contributes NO picture: its
    // sound still plays in the continuous audio pass, and the next chunk's grid
    // position already accounts for it. Rendering it would add the single frame
    // `buildSliceCommand` keeps for a degenerate render and push every later
    // picture a frame behind the sound. (Unless NO chunk has a frame: then the
    // first keeps that one frame so a picture exists at all.)
    const pictureFrames: number[] = []
    for (let c = 0, at = 0; c < chunks.length; c++) {
      const end = at + chunkOutputSec(chunks[c])
      pictureFrames.push(Math.round(end * fps) - Math.round(at * fps))
      at = end
    }
    const skipsPicture = (c: number) => muxAudioSeparately && pictureFrames[c] === 0 && pictureFrames.some((n) => n > 0)

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
      if (skipsPicture(c)) {
        chunkStartSec += chunkOutputSec(chunks[c])
        continue
      }
      const chunkPath = join(workDir, `chunk-${c}.${pcmChunks ? "wav" : ext}`)
      const cmd = buildSliceCommand(edl, chunks[c], {
        output, quality, target, fps, chunkStartSec, masterAudioId, audioPresent, omitAudio: muxAudioSeparately,
        ...(pcmChunks ? { audioCodec: "pcm" as const } : {}),
      })
      // The key is the command's fingerprint, so a checkpoint rendered for a
      // different plan (other chunk boundaries, grid position, width cap,
      // encode, or ffmpeg build — e.g. an attempt that started before a deploy)
      // is never spliced into this one: it simply isn't found.
      const key = `apply-edl-cache/${jobId}/chunk-${c}-${sliceFingerprint(cmd, edl, ffmpegVersion, threads)}.${ext}`

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
        await runSlice(cmd, sourcePaths, chunkPath, threads)
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
    if (chunks.length === 1) {
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
            output: "audio", audioCodec: "pcm", quality, target, fps, chunkStartSec: 0, masterAudioId, audioPresent, sourcePaths, outPath: pcmPath, threads,
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
          ["-y", "-f", "concat", "-safe", "0", "-i", listPath, ...aacArgs(quality), "-movflags", "+faststart", outputPath],
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
            "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", ...aacArgs(quality),
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
