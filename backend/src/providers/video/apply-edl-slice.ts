/**
 * apply-edl's slice command: what ONE contiguous slice of segments renders,
 * built as data — the filter graph, the input order and seeks, the encode
 * arguments and the slice's kill budget — without touching the filesystem.
 * The executor (`apply-edl.ts`) downloads and measures the sources, plans the
 * chunks, binds each command to local paths and runs it (`runSlice`), and keys
 * a chunk's checkpoint on a hash of exactly this command (`sliceFingerprint`).
 * Everything here that `apply-edl.ts` used to export is re-exported from it,
 * so every existing import keeps working.
 */
import type { Edl, EdlSegment, EdlSource, ResolveEdlSlotsOptions } from "@nodaro/shared"
import { resolveEdlSegmentSlots, resolveXfadeName, speakerSwitchOverlaps } from "@nodaro/shared"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { COMBINE_DELIVERY_CRF } from "./ffmpeg-utils.js"
import {
  audioSourceId,
  boundaryOverlapMs,
  boundaryOverlapSecs,
  chunkOutputMs,
  chunkRenderTimeoutMs,
  secs,
  INPUT_SEEK_MARGIN_SEC,
  type PlanSegment,
} from "./apply-edl-budget.js"
import { frameAtMs, frameRateOf } from "./apply-edl-frame-grid.js"
import { pictureFragmentError, type EdlPictureBuilder, type EdlPictureContext, type EdlPictureSlot } from "./edl-picture.js"
import { fullFramePicture } from "./edl-picture-fullframe.js"

/** A render's sound, by quality. A FINAL carries the delivery stream. A PROXY
 *  (review) render carries lighter MONO sound (A1c, TA7 decided 2026-10-04):
 *  AAC at 96 kbps — the top of the decided 64–96 kbps range, so filler and
 *  breath cuts stay easy to judge — at the SAME 48 kHz, so its timing is the
 *  final's sample for sample. The mono mix itself is made in the graph
 *  (`PROXY_DOWNMIX`); the encode only states the layout. */
const AUDIO_BY_QUALITY = {
  final: { bitrate: "192k", channels: 2 },
  proxy: { bitrate: "96k", channels: 1 },
} as const satisfies Record<"proxy" | "final", { readonly bitrate: string; readonly channels: 1 | 2 }>

/** The one AAC encode of a render's sound: a single-pass render's inline
 *  audio, option B's mux and a chunked audio render's join all produce the
 *  same stream for a given quality. */
export function aacArgs(quality: "proxy" | "final"): readonly string[] {
  const { bitrate, channels } = AUDIO_BY_QUALITY[quality]
  return ["-c:a", "aac", "-b:a", bitrate, "-ar", "48000", "-ac", String(channels)]
}

/** A mono render's mix: the AVERAGE of the joined stereo track's two
 *  channels, as the last step of its sound graph. Not the encoder's `-ac 1`,
 *  whose stereo→mono law (each channel at −3 dB, summed) plays a preview 3 dB
 *  louder than its final — a player sends a mono file to both speakers at full
 *  level — and can clip a hot source the final does not. The average is exactly
 *  as loud as the final for centred sound (speech), its peaks never exceed the
 *  final's, and it mixes sample by sample, so nothing moves in time. */
const PROXY_DOWNMIX = "pan=mono|c0=0.5*FL+0.5*FR"

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

export const offsetOf = (s: EdlSource | undefined): number => s?.offsetMs ?? 0

/** The grid frames each chunk of a render holds: chunk c covers
 *  [frameAtMs(start_c), frameAtMs(start_c + its length)) of the GLOBAL grid,
 *  `start_c` being Σ of the chunks before it in whole ms — the position the
 *  executor hands that chunk's slice (`chunkStartMs`), so a chunk's count and
 *  its slice's `gridHold` are one computation. The counts telescope: the whole
 *  render holds `frameAtMs(edlDurationMs(edl))` frames, the length of its sound. */
export function pictureFramesOf(chunks: readonly (readonly PlanSegment[])[], fps: number): number[] {
  const rate = frameRateOf(fps)
  const out: number[] = []
  for (let c = 0, atMs = 0; c < chunks.length; c++) {
    const endMs = atMs + chunkOutputMs(chunks[c])
    out.push(frameAtMs(endMs, rate) - frameAtMs(atMs, rate))
    atMs = endMs
  }
  return out
}

/** The render's one sound rate. Every segment's sound is cut, joined and
 *  encoded at it. */
const RENDER_SAMPLE_RATE = 48_000

/** Whether a source's sound needs the exact resample: a measured integer rate
 *  that is not the render's. An unmeasured rate keeps today's graph. */
const needsExactResample = (rate: number | undefined): boolean =>
  rate !== undefined && Number.isInteger(rate) && rate > 0 && rate !== RENDER_SAMPLE_RATE

/**
 * One segment's sound from a source NOT at 48 kHz, cut sample-exactly (Track
 * 0.18, fix F5, decided 2026-10-06). `atrim` in seconds rounds a cut to the
 * SOURCE's sample grid, and the resampler's output length rounds again: an
 * unseeked 44.1 kHz master lost ~0.7 samples per segment (−20 by segment 30,
 * pinned 8.1.2), and a seek off a whole second shifted every segment by a
 * constant fraction of a sample. Instead, with the input seeked to a WHOLE
 * second (`seekOf`) — an exact sample at any integer rate:
 *  1. cut coarsely, from a whole second at least 1 s before the segment to one
 *     at least 1 s after it — exact samples again, and the resampler's lead-in
 *     and lead-out, so no sample of the segment is interpolated against the
 *     edge of the cut — held past the source end with silence;
 *  2. resample to 48 kHz — that first whole second is sample 0 of the 48 kHz
 *     stream on both grids, so every later 48 kHz sample has an exact position.
 *     The cut is rebased on the WHOLE SECOND (`PTS-coarse/TB`), not on its
 *     first packet: a sound that starts after its file does (MKV/WebM, OBS and
 *     browser recordings, MPEG-TS, an MP4 whose edit list delays the sound)
 *     has no sample at that second, so `atrim` starts at its first packet, and
 *     `PTS-STARTPTS` would call that packet the second and put the segment late
 *     by the whole delay. `first_pts=0` has the resampler pad the head with
 *     silence up to the packet's true position instead; `min_comp=0` makes it
 *     pad ANY delay — `first_pts` alone defaults the threshold to 1 ms, which a
 *     delay must exceed, so a 1 ms start (MKV's timestamp unit) went unpadded.
 *     A delay that is not a whole number of the source's samples is padded to
 *     the source sample below it (the resampler inserts whole input samples),
 *     as the seconds-based `atrim` did. For a sound present at the second, the
 *     output is byte-identical to the rebase on its first packet;
 *  3. cut EXACTLY in 48 kHz samples: [(start − coarse)·48 000, + dur·48 000),
 *     held with silence as a backstop (the lead-out already covers it).
 * Every segment is therefore exactly dur·48 kHz samples of the source
 * resampled as one continuous stream: lag 0 per segment, seeked or not, and
 * for a lossless source every sample equal to that stream's (pinned 8.1.2,
 * 44.1 kHz WAV and AAC, cuts off the 10 ms grid: apply-edl-resample.e2e, which
 * also renders MKVs whose sound starts 500 ms and 1 ms after the picture).
 * Times are integer ms, so both sample numbers are exact integers.
 */
function exactResample(input: number, startMs: number, endMs: number, seekSec: number): string {
  const relMs = startMs - seekSec * 1000
  const relEndMs = endMs - seekSec * 1000
  const coarse = Math.max(0, Math.floor(relMs / 1000) - 1)
  const coarseEnd = Math.ceil(relEndMs / 1000) + 1
  const startSample = Math.round((relMs - coarse * 1000) * (RENDER_SAMPLE_RATE / 1000))
  const endSample = startSample + Math.round((endMs - startMs) * (RENDER_SAMPLE_RATE / 1000))
  return (
    `[${input}:a]apad,atrim=start=${coarse}:end=${coarseEnd},asetpts=PTS-${coarse}/TB,` +
    `aresample=${RENDER_SAMPLE_RATE}:first_pts=0:min_comp=0,apad,atrim=start_sample=${startSample}:end_sample=${endSample},asetpts=PTS-STARTPTS`
  )
}

/** How ONE contiguous slice of segments renders (see `buildSliceCommand`). */
export interface SliceOptions {
  readonly output: "video" | "audio"
  /** Keys the ENCODER: a proxy (review) render encodes fast at a lower
   *  quality; a final one at delivery quality — whatever the canvas size. (It
   *  used to key on `target.height <= 720`, so a FINAL render of 720p sources
   *  got the proxy encoder.) The canvas cap is `targetForQuality`'s job. It
   *  keys the SOUND too: a proxy's is the lighter mono mix (`aacArgs`,
   *  `PROXY_DOWNMIX`), lossless slices included. */
  readonly quality: "proxy" | "final"
  readonly target: { width: number; height: number }
  /** The canvas rate, 0.001-keyed (`pickTargetFps`); the grid reads it as a
   *  fraction (`frameRateOf`). */
  readonly fps: number
  /** This chunk's start position on the GLOBAL output timeline, in whole ms
   *  (Σ of prior chunks' `chunkOutputMs`). The cumulative frame grid (Track
   *  0.14) is laid from here so chunk seams sit on the same grid — a chunked
   *  render holds frameAtMs(total) frames end to end, not per chunk. */
  readonly chunkStartMs: number
  readonly masterAudioId: string | undefined
  readonly audioPresent: Map<string, boolean>
  /** The sample rate, in Hz, of each source's audio stream (`probeAudioSampleRate`).
   *  A source whose sound this slice reads at a measured integer rate OTHER
   *  than 48 kHz is resampled sample-exactly (`exactResample`, Track 0.18). A
   *  48 kHz source — or one whose rate is absent here — renders exactly the
   *  command it always did. */
  readonly audioSampleRate?: ReadonlyMap<string, number>
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
  /** What each segment's frame shows (the timeline's picture seam,
   *  `edl-picture.ts`). Default: the full-frame picture — Apply EDL's. */
  readonly picture?: EdlPictureBuilder
  /** D20's per-(source, speaker) framing (a Speaker View setting), handed to
   *  `resolveEdlSegmentSlots` so every slot reaches the picture builder with
   *  its region already resolved. */
  readonly speakerRegions?: ResolveEdlSlotsOptions["speakerRegions"]
  /** D20's resolver rung (Speaker View v3, phase 3): a per-(segment, slot)
   *  region, e.g. from a face track, below an explicit slot/segment region and
   *  above `speakerRegions`. Asked about the EDL's own segment — a chunk's
   *  split half is mapped back to it (`PlanSegment.splitOf`). Must be pure,
   *  like the picture builder: its regions reach the fragment the checkpoint
   *  key hashes. */
  readonly regionFor?: ResolveEdlSlotsOptions["regionFor"]
}

/** The ffmpeg xfade an `xfade:<id>` layout switch INTO `seg` names, or null
 *  when the segment carries no time-consuming switch. A switch id the catalog
 *  does not know is refused as deterministic — the same EDL fails the same
 *  way on every attempt. */
export function xfadeSwitchNameOf(seg: EdlSegment): string | null {
  const sw = seg.layout?.transition?.type
  if (typeof sw !== "string" || !speakerSwitchOverlaps(sw)) return null
  const id = sw.slice(sw.indexOf(":") + 1)
  let name: string | null = null
  try {
    name = resolveXfadeName(id)
  } catch {
    name = null
  }
  if (!name) {
    throw new DeterministicJobError(`segment "${seg.id}": switch "${sw}" names no crossfade this renderer knows`)
  }
  return name
}

/** The ffmpeg xfade transition at a boundary INTO `seg`: `fade` for a
 *  `crossfade` segment transition (Apply EDL's only one), the combine-videos
 *  transition an `xfade:<id>` layout switch names (`xfadeSwitchNameOf`). */
export function xfadeTransitionInto(seg: EdlSegment): string {
  const t = seg.transition
  if (t && t.type === "crossfade" && (t.durationMs ?? 0) > 0) return "fade"
  return xfadeSwitchNameOf(seg) ?? "fade"
}

/** Pre-flight (run before any source is downloaded): every `xfade:<id>`
 *  switch in the EDL names a transition this renderer knows. The slice only
 *  resolves a switch at the chunk that draws it, and not at all when the
 *  blend rounds under one frame (the join becomes a cut) or the render is
 *  sound-only — so an unknown id would otherwise surface hours in, or never.
 *  Apply EDL's validated EDLs carry no layout switch: a no-op for it. */
export function assertEdlSwitchesResolve(edl: Edl): void {
  for (const seg of edl.segments) xfadeSwitchNameOf(seg)
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
  /** What the slice's predicted peak memory is computed from — its canvas and
   *  segment count (`canvasPeakMemoryMiB`, with the thread counts the launch
   *  runs with: only `runSlice` knows them); undefined for a sound-only slice,
   *  which reserves the launcher's default estimate. Not part of the resume
   *  key — it changes when ffmpeg runs, not what it renders. */
  readonly memoryBasis: { readonly width: number; readonly height: number; readonly segments: number } | undefined
}

/**
 * Build the command that renders ONE contiguous slice of segments (internal
 * boundaries may be cut or crossfade) through a single filter_complex.
 * `audioPresent` maps a source id to whether its file carries an audio stream.
 */
export function buildSliceCommand(edl: Edl, segs: readonly PlanSegment[], opts: SliceOptions): SliceCommand {
  const { output, target, fps, chunkStartMs, masterAudioId, audioPresent, audioSampleRate, omitAudio, audioCodec = "aac" } = opts
  const picture = opts.picture ?? fullFramePicture
  const rate = frameRateOf(fps)
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
  // chunk: every boundary is `frameAtMs` of an exact integer-ms position on the
  // output timeline (`chunkOutputMs`'s sum), never a float product of seconds.
  // A chunk's plan, its gridHold, the next chunk's first frame and the
  // executor's totals (`pictureFramesOf`) are therefore one computation and
  // agree even at an exact half-frame tie — where two float orders of the same
  // sum round to opposite frames ((15.95 + 1.4)·30 = 520.4999…, 17 350 ms is
  // frame 520.5): a [10, 1] chunked render came out a frame short of its sound
  // (decided 2026-10-05: fix the seam). A cut's start IS the previous end (the
  // same integer), so the counts telescope.
  const intervals: Array<{ readonly startF: number; readonly endF: number; readonly endMs: number; readonly overlapMs: number; readonly leadFrames: number }> = []
  {
    let prefixMs = 0
    let prevEndF = frameAtMs(chunkStartMs, rate)
    segs.forEach((seg, i) => {
      const overlapMs = i > 0 ? boundaryOverlapMs(seg, segs[i - 1]) : 0
      const startMs = chunkStartMs + prefixMs - overlapMs
      const startF = overlapMs > 0 ? frameAtMs(startMs, rate) : prevEndF
      prefixMs += seg.outMs - seg.inMs - overlapMs
      const endMs = chunkStartMs + prefixMs
      const endF = frameAtMs(endMs, rate)
      // A split tail (`PlanSegment.splitLeadMs`) is read from its whole
      // segment's start, so its frames are that segment's frames from here on:
      // skip the ones its head, in the previous chunk, already rendered.
      const leadFrames = seg.splitLeadMs ? Math.max(0, startF - frameAtMs(startMs - seg.splitLeadMs, rate)) : 0
      intervals.push({ startF, endF, endMs, overlapMs, leadFrames })
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
    const chunkStartF = frameAtMs(chunkStartMs, rate)
    let accEndF = chunkStartF
    let started = false
    intervals.forEach(({ startF, endF, endMs, overlapMs }, i) => {
      const frames = Math.max(0, endF - startF)
      const covered = Math.max(0, accEndF - startF) // frames of this segment the picture already holds
      // A split head wholly inside the crossfade into it still blends — one pass
      // blends exactly those frames — when its segment goes on past them: its
      // tail (next chunk, `PlanSegment.splitTailMs`) holds a frame of its own on
      // the grid. `endMs` is the next chunk's start (one integer arithmetic).
      const tailMs = segs[i]!.splitTailMs ?? 0
      const blendsWhole = tailMs > 0 && covered === frames && frameAtMs(endMs + tailMs, rate) > endF
      if (started && overlapMs > 0 && covered >= 1 && (covered < frames || blendsWhole)) {
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

  // Each segment's picture slots (D20): its `layout.slots`, else the one
  // implicit slot of `seg.video` — which is every segment Apply EDL accepts.
  const { regionFor } = opts
  const resolveOpts = (seg: PlanSegment): ResolveEdlSlotsOptions | undefined =>
    opts.speakerRegions || regionFor
      ? {
          ...(opts.speakerRegions ? { speakerRegions: opts.speakerRegions } : {}),
          // a split half asks about its whole segment (a chunk seam is not an edit)
          ...(regionFor
            ? {
                regionFor: (q: Parameters<typeof regionFor>[0]) => {
                  // pure, like `picture`: a throw fails the same way on every
                  // retry, so it must not be retried (each retry re-downloads
                  // every source before it reaches this chunk again)
                  try {
                    return regionFor({ ...q, segment: seg.splitOf ?? seg })
                  } catch (e) {
                    throw new DeterministicJobError(
                      `region for segment "${seg.id}": ${e instanceof Error ? e.message : String(e)}`,
                      { cause: e },
                    )
                  }
                },
              }
            : {}),
        }
      : undefined
  const slotsOf = (seg: PlanSegment) => {
    const slots = resolveEdlSegmentSlots(edl, seg, resolveOpts(seg))
    if (slots.length === 0) throw new DeterministicJobError(`segment "${seg.id}" has no picture source for a video render`)
    return slots
  }

  // Where a segment reads one picture source, on that source's own clock
  // (master − offsetMs).
  const pictureReadOf = (seg: PlanSegment, sourceId: string) => {
    const vs = edl.sources.find((s) => s.id === sourceId)
    if (!vs) throw new Error(`segment "${seg.id}" shows unknown source "${sourceId}"`)
    // max(0): unreachable in a render — assertSegmentsWithinSources refuses a
    // pre-origin read first; kept so a direct builder call never asks for
    // negative source time. A split tail reads from its whole segment's start
    // (`splitLeadMs` earlier) so its picture keeps that segment's frame phase.
    const startMs = Math.max(0, seg.inMs - (seg.splitLeadMs ?? 0) - offsetOf(vs))
    const endMs = Math.max(startMs, seg.outMs - offsetOf(vs))
    return { id: vs.id, start: secs(startMs), end: secs(endMs), startMs, endMs }
  }
  const audioReadOf = (seg: EdlSegment) => {
    const aId = audioSourceId(edl, seg, masterAudioId)
    const aSrc = aId ? edl.sources.find((s) => s.id === aId) : undefined
    if (!aSrc || !audioPresent.get(aSrc.id)) return undefined
    const startMs = Math.max(0, seg.inMs - offsetOf(aSrc))
    const endMs = Math.max(startMs, seg.outMs - offsetOf(aSrc))
    return { id: aSrc.id, start: secs(startMs), end: secs(endMs), startMs, endMs }
  }
  // The sources whose sound this slice reads and must resample exactly
  // (`exactResample`). A picture-only chunk reads none, so its command is
  // unchanged whatever its sources' rates.
  const exactAudio = new Set<string>()
  if (emitAudio) {
    for (const seg of segs) {
      const a = audioReadOf(seg)
      if (a && needsExactResample(audioSampleRate?.get(a.id))) exactAudio.add(a.id)
    }
  }

  // INPUT SEEK. `trim`/`atrim` run AFTER the decoder, so without a seek a slice
  // whose window sits at t=T decodes every source from 0 just to discard it:
  // with chunks capped at 30 segments, the last chunk of an hour-long 1080p edit
  // took 1,475 s on 2 cores against its 1,200 s kill budget (pinned 8.1.2). Each
  // input is instead seeked (`-ss` before `-i`, frame/sample-accurate — ffmpeg
  // decodes from the prior keyframe and discards up to the target) to its
  // EARLIEST read in this slice minus INPUT_SEEK_MARGIN_SEC, and every trim on it
  // is rebased by that offset. Measured byte-identical to the unseeked render.
  // An input whose sound is not at 48 kHz seeks to a whole second instead
  // (`exactResample`).
  const minReadOf = new Map<string, number>()
  const noteRead = (id: string, t: number) => minReadOf.set(id, Math.min(minReadOf.get(id) ?? Infinity, t))
  segs.forEach((seg, i) => {
    const dropped = useGrid ? gridFrames[i] <= 0 : chunkHasXfade && xfPlan[i]!.join === "none"
    if (wantVideo && !dropped) {
      for (const slot of slotsOf(seg)) {
        const v = pictureReadOf(seg, slot.source)
        noteRead(v.id, v.start)
      }
    }
    if (emitAudio) {
      const a = audioReadOf(seg)
      if (a) noteRead(a.id, a.start)
    }
  })
  // An input whose sound is resampled exactly seeks to a WHOLE second — an
  // exact sample at any integer rate (Track 0.18); its picture reads, if any,
  // rebase on the same seek. Every other input keeps its millisecond seek.
  const seekOf = (id: string): number => {
    const at = (minReadOf.get(id) ?? 0) - INPUT_SEEK_MARGIN_SEC
    return exactAudio.has(id) ? Math.max(0, Math.floor(at)) : Math.max(0, Math.floor(at * 1000) / 1000)
  }

  // One segment's picture: each slot source held past its end (`tpad`
  // clone) and trimmed to the segment's window — a few frames past it, so
  // `fps` yields at least `nFrames` — then the picture builder's fragment,
  // then the conform that puts EXACTLY `nFrames` frames on the shared output
  // grid (no per-segment `fps` accumulation; Track 0.14). Every picture read
  // starts from the SOURCE held past its end: a window that reaches beyond the
  // camera's last frame — inside SOURCE_END_TOLERANCE_SEC, which the window
  // check accepts — reads a frozen last frame instead of coming up short. A
  // short segment would otherwise pull every later cut ahead of the single
  // continuous audio track (option B) for the rest of the render. (`:V` — a
  // real video stream, never embedded cover art; the same stream
  // `probeStreamEnds` measured.) A one-slot `chain` (the full-frame picture)
  // is inlined into its read: the exact graph Apply EDL has always rendered.
  const vLabelOf = (seg: PlanSegment, i: number, nFrames: number, vLabel: string): void => {
    const lead = intervals[i].leadFrames
    const conform = `fps=${fps},trim=start_frame=${lead}:end_frame=${lead + nFrames},setpts=PTS-STARTPTS,format=yuv420p,setsar=1`
    const reads = slotsOf(seg).map((slot) => {
      const v = pictureReadOf(seg, slot.source)
      const seek = seekOf(v.id)
      const readEnd = v.end - seek + APPLY_EDL_GRID_READ_GUARD_FRAMES / fps
      return {
        slot,
        sourceSpan: { startMs: v.startMs, endMs: v.endMs },
        read: `[${addInput(v.id)}:V]tpad=stop_mode=clone:stop=-1,trim=start=${(v.start - seek).toFixed(6)}:end=${readEnd.toFixed(6)},setpts=PTS-STARTPTS`,
      }
    })
    const scope = `p${i}`
    const ctx: EdlPictureContext = {
      segment: seg,
      index: i,
      slots: reads.map(({ slot, sourceSpan }, j): EdlPictureSlot => ({ ...slot, label: `[${scope}s${j}]`, sourceSpan })),
      canvas: { width: target.width, height: target.height },
      fps,
      quality: opts.quality,
      durationSec: secs(seg.outMs - seg.inMs),
      leadSec: secs(seg.splitLeadMs ?? 0),
      frames: nFrames,
      startFrame: intervals[i].startF,
      leadFrames: lead,
      output: `[${scope}o]`,
      scope: `${scope}_`,
    }
    // The builder is pure (the seam's contract): whatever it refuses, or
    // draws wrong, it refuses or draws the same way on every attempt — a
    // retry would only re-download every source to fail at this slice again.
    let fragment: ReturnType<EdlPictureBuilder>
    try {
      fragment = picture(ctx)
    } catch (e) {
      throw new DeterministicJobError(`picture for segment "${seg.id}": ${e instanceof Error ? e.message : String(e)}`, { cause: e })
    }
    const problem = pictureFragmentError(fragment, ctx)
    if (problem) throw new DeterministicJobError(`picture for segment "${seg.id}": ${problem}`)
    if ("chain" in fragment) {
      filters.push(`${reads[0]!.read},${fragment.chain},${conform}${vLabel}`)
      return
    }
    reads.forEach(({ read }, j) => filters.push(`${read}[${scope}s${j}]`))
    filters.push(fragment.graph)
    filters.push(`${ctx.output}${conform}${vLabel}`)
  }

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
      // nFrames === 0 (grid) / join "none" (xfade) is a segment that adds no
      // picture: a sub-half-frame cut, or one wholly inside the crossfade into
      // it. It is skipped from the chain, while its audio atrim below still
      // plays and the next segment's frames absorb the rounding — the total
      // stays on grid. An xfade chunk keeps exactly the segment's grid frames
      // (Track 0.16), read past the window like the grid path.
      // Every picture source joins the input list in segment order, even one
      // whose segment adds no frame (it has always been an input).
      for (const slot of slotsOf(seg)) addInput(pictureReadOf(seg, slot.source).id)
      const nFrames = useGrid ? gridFrames[i] : xfPlan[i]!.join === "none" ? 0 : xfPlan[i]!.frames
      if (nFrames > 0) {
        vLabel = `[v${i}]`
        vLabelOf(seg, i, nFrames, vLabel)
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
      if (a && exactAudio.has(a.id)) {
        filters.push(
          `${exactResample(addInput(a.id), a.startMs, a.endMs, seekOf(a.id))},` +
            `aformat=sample_rates=48000:channel_layouts=stereo${aLabel}`,
        )
      } else if (a) {
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
    // A mono render (a proxy) averages the joined stereo track here — before
    // the encode and before any lossless slice, so the join and the mux
    // encode exactly this mix.
    if (AUDIO_BY_QUALITY[opts.quality].channels === 1) {
      chainParts.push(`${audioOutLabel}${PROXY_DOWNMIX}[amono]`)
      audioOutLabel = "[amono]"
    }
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
        chainParts.push(`${vAcc}${label}xfade=transition=${xfadeTransitionInto(segs[i]!)}:duration=${(plan.xfFrames / fps).toFixed(6)}:offset=${(plan.offsetFrames / fps).toFixed(6)}${out}`)
      } else {
        chainParts.push(`${vAcc}${label}concat=n=2:v=1:a=0,setpts=N/FRAME_RATE/TB,fps=${fps}${out}`)
      }
      vAcc = out
    }
    chainParts.push(`${vAcc!}null[vxf]`)
    const gridN = Math.max(1, frameAtMs(chunkStartMs + chunkOutputMs(segs), rate) - frameAtMs(chunkStartMs, rate))
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
    if (emitAudio) outputArgs.push(...aacArgs(opts.quality))
    else outputArgs.push("-an")
    outputArgs.push("-movflags", "+faststart")
  } else if (audioCodec === "pcm") {
    // RF64 keeps a multi-hour f32 slice past WAV's 4 GiB header limit.
    const channels = String(AUDIO_BY_QUALITY[opts.quality].channels)
    outputArgs.push("-map", audioOutLabel!, "-c:a", "pcm_f32le", "-ar", "48000", "-ac", channels, "-rf64", "auto")
  } else {
    outputArgs.push("-map", audioOutLabel!, ...aacArgs(opts.quality))
  }

  // Explicit longer timeout: the default 10-min per-spawn would kill a long
  // chunk. The handler's liveness budget (`applyEdlRenderBudgetMs`) is summed
  // from this same per-chunk figure, so "hung" means one thing to both.
  return {
    inputIds, needsSilence, filterGraph: fullFilter, outputArgs, inputSeekSec,
    timeoutMs: chunkRenderTimeoutMs(edl, segs, { video: wantVideo, audio: emitAudio }, { width: target.width, height: target.height, fps }),
    // Every slot is its own decoded branch of the graph (#1860's model counts
    // branches): one per segment for Apply EDL.
    memoryBasis: wantVideo
      ? { width: target.width, height: target.height, segments: segs.reduce((n, seg) => n + Math.max(1, slotsOf(seg).length), 0) }
      : undefined,
  }
}
