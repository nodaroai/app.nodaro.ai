// @reads-none reads only temp files: the source clip (and face mask) it downloads and the cuts it makes of them
/**
 * Making a trend's preview input clip (`TrendPreviewClip`, types.ts): the
 * source clip's 4 s preview window (plus up to `PREVIEW_CLIP_TAIL_SECONDS` of
 * real footage) cut ONCE, frame-accurately, into its own file under
 * `trends/<id>/`, so every preview run of a published version edits exactly
 * the same bytes and the admin can see what those bytes are. The pure rules
 * (when a stored clip is current, how long the cut is) live in
 * preview-clip.ts; `ensurePreviewClip` below is what every admin write that
 * can move the window calls (the draft save, an upscale or crop put in, a face
 * mask approved or cleared, and publish, which self-heals).
 *
 * The cut (`previewClipArgs`) is by FRAME INDEX, never by time: the source
 * is probed for its frame rate and frame count, the window becomes
 * `frameCount` frames from frame `startFrame` (`previewClipFrames`,
 * preview-clip.ts), and the file is decoded from its start through
 * `trim=start_frame:end_frame` (no seek: a clip is 30 s at most, so decoding
 * the frames before the window costs a few seconds and the frame numbering
 * stays exact), the sound alongside through `atrim` at the same moment.
 * Re-encoded (never a stream copy, which can only cut on a keyframe) to
 * H.264 / yuv420p at a near-lossless constant quality, the first sound track
 * as AAC, faststart, every frame kept as it is decoded (`-fps_mode
 * passthrough`: nothing dropped or doubled to fill a rate). NO scaling and
 * NO `-r`: the clip keeps the source's size and rate. The face mask's cut
 * (`faceMask`), made from the trend's approved stored mask (its whole-source
 * masked clip, asserted frame for frame aligned with the source at
 * approval), takes the SAME frames by the same numbers, picture only. A cut
 * by time could not promise that: the mask is another encoder's file, in
 * another time base, so a window edge near a frame boundary fell on
 * different frames of the two (119 against 120). The clip must have exactly
 * `frameCount` frames, and a mask cut whose frame count differs from the
 * clip's is a real fault (the mask no longer matches the source): thrown,
 * never papered over.
 *
 * Pattern: media.ts `makeDisplayCopy` (a temp dir, `downloadFile` within the
 * trend video limit, `runFfmpeg` admitted at the clip's canvas, probe, upload,
 * cleanup), except that the source's probe is required here (its rate and
 * frames are the cut's numbers); `TrendMediaError("media_unreadable")` for a
 * clip ffmpeg cannot measure or cut, a killed or unadmitted launch thrown as
 * it is (`isTransientMediaFailure`), and nothing stored before every cut is
 * made and checked.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { downloadFile, probeVideoFrameCount, probeVideoSource, runFfmpeg, runFfprobe } from "../../../providers/video/ffmpeg-utils.js"
import { uploadFileWithKeyToR2 } from "../../../lib/storage.js"
import { reencodePeakMemoryMiB } from "../../../providers/video/video-file-stages.js"
import { TREND_MEDIA_MAX_BYTES, TrendMediaError, isTransientMediaFailure, sha256OfFile, trendMediaKey } from "./media.js"
import { PREVIEW_CLIP_RECIPE, previewClipDurationSec, previewClipFrames, previewClipState, withoutPreviewClip, type PreviewClipFrames } from "./preview-clip.js"
import { storedFaceMaskFor } from "./face-mask.js"
import type { TrendPreviewClip, TrendVersionData } from "./types.js"

/** Seconds for a filter's option: to the microsecond, finer than any frame or sample. */
const sec = (s: number) => s.toFixed(6)

/** One cut, by frame index (`previewClipFrames`), and the sound's matching stretch when it is cut too. */
export interface PreviewClipCut {
  startFrame: number
  frameCount: number
  /**
   * The sound from the same moment as frame `startFrame`, for as long as the
   * frames last: `startSec` on ffmpeg's timeline of the input (where frame
   * `startFrame` falls, `previewCutAudio`). Absent: no sound (`-an`).
   */
  audio?: { startSec: number; durationSec: number }
}

/**
 * The ffmpeg arguments that cut `cut.frameCount` frames of `input` from frame
 * `cut.startFrame` into `out` (no seek, a trim by frame number, then a
 * re-encode), with the sound's stretch when `cut.audio` is given. Pure; the
 * picture's arguments are the same for the source clip and its face mask, so
 * their frames align. Bump `PREVIEW_CLIP_RECIPE` (preview-clip.ts) when these
 * change.
 */
export function previewClipArgs(input: string, cut: PreviewClipCut, out: string): string[] {
  const { startFrame, frameCount, audio } = cut
  return [
    "-y",
    "-i", input,
    // The picture and, when asked, the first sound track: never a data or subtitle track.
    "-map", "0:v:0",
    ...(audio ? ["-map", "0:a:0"] : ["-an"]),
    "-vf", `trim=start_frame=${startFrame}:end_frame=${startFrame + frameCount},setpts=PTS-STARTPTS`,
    ...(audio ? ["-af", `atrim=start=${sec(audio.startSec)}:duration=${sec(audio.durationSec)},asetpts=PTS-STARTPTS`] : []),
    // Every frame the trim passes is written as it is: none dropped or doubled to fill a rate.
    "-fps_mode", "passthrough",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16",
    "-pix_fmt", "yuv420p",
    ...(audio ? ["-c:a", "aac", "-b:a", "192k"] : []),
    "-movflags", "+faststart",
    out,
  ]
}

/** What the cut needs to know of the source, from one ffprobe: where its picture starts on ffmpeg's timeline, and whether it has sound. */
export interface PreviewCutTimeline {
  /** The first video stream's start, less the file's (ffmpeg's CLI moves the file's start to 0); 0 when either is unknown. */
  videoOffsetSec: number
  hasAudio: boolean
}

/** Pure: ffprobe's JSON (`stream=codec_type,start_time:format=start_time`) → the timeline. Throws on JSON that is not one. */
export function parseCutTimeline(json: string): PreviewCutTimeline {
  const parsed = JSON.parse(json) as { streams?: Array<{ codec_type?: unknown; start_time?: unknown }>; format?: { start_time?: unknown } }
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : []
  const video = streams.find((s) => s?.codec_type === "video")
  if (!video) throw new Error("No video stream")
  const videoStart = Number(video.start_time)
  const fileStart = Number(parsed?.format?.start_time)
  const offset = Number.isFinite(videoStart) && Number.isFinite(fileStart) ? videoStart - fileStart : 0
  return { videoOffsetSec: offset > 0 ? offset : 0, hasAudio: streams.some((s) => s?.codec_type === "audio") }
}

/**
 * The sound's stretch for `frames` of a source at `fps`: from where frame
 * `startFrame` falls on ffmpeg's timeline (its picture's offset plus
 * `startFrame / fps`), for `frameCount / fps`. Pure.
 */
export function previewCutAudio(frames: PreviewClipFrames, fps: number, videoOffsetSec: number): { startSec: number; durationSec: number } {
  return { startSec: videoOffsetSec + frames.startFrame / fps, durationSec: frames.frameCount / fps }
}

/**
 * The rate the window is counted in: the source's constant rate, else (a
 * variable-rate clip) its frames over its video's length, so a start in
 * seconds still lands near its frame. Undefined when neither is known.
 */
export function cutFrameRate(probe: { fps?: number; durationSeconds: number; videoDurationSeconds?: number }, sourceFrames: number): number | undefined {
  if (probe.fps !== undefined && Number.isFinite(probe.fps) && probe.fps > 0) return probe.fps
  const length = probe.videoDurationSeconds ?? probe.durationSeconds
  const rate = sourceFrames / length
  return Number.isFinite(rate) && rate > 0 ? rate : undefined
}

export interface MakePreviewClipArgs {
  /** The source clip's hidden URL (`source.videoUrl`): recorded as `sourceVideoUrl`. */
  sourceUrl: string
  /** Where the window starts (`previewStart`): recorded as `startSec`. */
  startSec: number
  /** How long to cut (`previewClipDurationSec`): counted in the source's frames (`previewClipFrames`). */
  durationSec: number
  /** The trend's approved stored face mask (its whole-source masked clip), cut at the same frames. */
  faceMask?: { url: string }
}

/** Download `url` to `file` within the trend video limit; `TrendMediaError("download_failed")` otherwise. */
async function fetchVideo(url: string, file: string): Promise<void> {
  try {
    await downloadFile(url, file, { maxBytes: TREND_MEDIA_MAX_BYTES.video })
  } catch (e) {
    // A fixed sentence: the download's own message names the file's address and the response it got, which is logged, never answered.
    throw new TrendMediaError("download_failed", "Could not fetch the stored clip to cut the preview's input from it.", { cause: e })
  }
}

/** One cut (`previewClipArgs`) of the local `input`, admitted at `canvas`, measured: its frame count, size and length. */
async function cut(
  input: string,
  out: string,
  plan: PreviewClipCut,
  canvas: { width: number; height: number },
  what: string,
): Promise<{ frames: number; width: number; height: number; durationSec: number }> {
  try {
    await runFfmpeg(previewClipArgs(input, plan, out), undefined, { peakMemoryMiB: reencodePeakMemoryMiB(canvas) })
    const probe = await probeVideoSource(out)
    const frames = await probeVideoFrameCount(out)
    return { frames, width: probe.width, height: probe.height, durationSec: probe.durationSeconds }
  } catch (e) {
    // A killed or unadmitted launch says nothing about the clip: thrown as it is.
    if (isTransientMediaFailure(e)) throw e
    throw new TrendMediaError("media_unreadable", `Could not cut the preview's input clip from ${what}.`, { cause: e })
  }
}

/**
 * What the source's cut is: its canvas (the re-encode's admission), its
 * frames by index (`previewClipFrames`, counted at `cutFrameRate`) and the
 * sound's matching stretch. A source that cannot be measured, or whose window
 * holds no frame, is `media_unreadable`; a stopped probe is thrown as it is.
 */
async function planSourceCut(
  source: string,
  args: Pick<MakePreviewClipArgs, "startSec" | "durationSec">,
): Promise<{ canvas: { width: number; height: number }; frames: PreviewClipFrames; plan: PreviewClipCut }> {
  let measured: { probe: Awaited<ReturnType<typeof probeVideoSource>>; sourceFrames: number; timeline: PreviewCutTimeline }
  try {
    const probe = await probeVideoSource(source)
    const sourceFrames = await probeVideoFrameCount(source)
    const timeline = parseCutTimeline(
      await runFfprobe(["-v", "error", "-show_entries", "stream=codec_type,start_time:format=start_time", "-of", "json", source]),
    )
    measured = { probe, sourceFrames, timeline }
  } catch (e) {
    if (isTransientMediaFailure(e)) throw e
    throw new TrendMediaError("media_unreadable", "Could not read the source clip's frames to cut the preview's input from it.", { cause: e })
  }
  const { probe, sourceFrames, timeline } = measured
  const fps = cutFrameRate(probe, sourceFrames)
  const frames = fps === undefined ? null : previewClipFrames(args.startSec, args.durationSec, fps, sourceFrames)
  if (fps === undefined || !frames) {
    throw new TrendMediaError(
      "media_unreadable",
      `The preview window (${args.startSec.toFixed(3)} s for ${args.durationSec.toFixed(3)} s) holds no frame of the source clip (${sourceFrames} frames).`,
    )
  }
  return {
    canvas: { width: probe.width, height: probe.height },
    frames,
    plan: { ...frames, ...(timeline.hasAudio ? { audio: previewCutAudio(frames, fps, timeline.videoOffsetSec) } : {}) },
  }
}

/**
 * Cut the preview input clip of trend `trendId` from `sourceUrl` at
 * `startSec` for `durationSec` (and the face mask's matching cut, when
 * `faceMask` is given), upload both under `trends/<trendId>/` and return the
 * record to store on the draft (`TrendPreviewClip`: the clip's URL, size,
 * length, frame count and SHA-256, what it was cut from, and `madeAt`).
 *
 * Throws `TrendMediaError` (`download_failed`, `media_unreadable`) before
 * anything is stored when a file cannot be fetched, measured or cut, when the
 * window holds no frame of the source, when the clip's cut does not have the
 * frames asked for, or when the mask's cut does not have the clip's; a launch the platform
 * killed or could not admit, and a storage failure, are thrown as they are.
 */
export async function makePreviewClip(trendId: string, args: MakePreviewClipArgs): Promise<TrendPreviewClip> {
  const dir = await mkdtemp(join(tmpdir(), "trend-preview-clip-"))
  const source = join(dir, "source")
  const clip = join(dir, "clip.mp4")
  const mask = join(dir, "mask")
  const maskClip = join(dir, "mask-clip.mp4")
  try {
    await fetchVideo(args.sourceUrl, source)
    const { canvas, frames, plan } = await planSourceCut(source, args)
    const made = await cut(source, clip, plan, canvas, "the source clip")
    if (made.frames !== frames.frameCount) {
      throw new TrendMediaError(
        "media_unreadable",
        `The preview clip's cut has ${made.frames} frames, ${frames.frameCount} were asked for (from frame ${frames.startFrame}).`,
      )
    }

    let maskMade: { frames: number } | undefined
    if (args.faceMask) {
      await fetchVideo(args.faceMask.url, mask)
      // The same frames, by the same numbers, picture only (the mask's own timestamps are never read).
      maskMade = await cut(mask, maskClip, { startFrame: frames.startFrame, frameCount: frames.frameCount }, canvas, "the face mask")
      if (maskMade.frames !== made.frames) {
        throw new TrendMediaError(
          "media_unreadable",
          `The face mask's cut has ${maskMade.frames} frames, the preview clip ${made.frames}: the mask no longer matches the source clip. Make the face mask again.`,
        )
      }
    }

    // Hashed before the upload: the hash names the exact bytes stored.
    const sha256 = await sha256OfFile(clip)
    const maskSha256 = maskMade ? await sha256OfFile(maskClip) : undefined
    const videoUrl = await uploadFileWithKeyToR2(clip, trendMediaKey(trendId, "mp4"), "video/mp4")
    const maskUrl = maskMade ? await uploadFileWithKeyToR2(maskClip, trendMediaKey(trendId, "mp4"), "video/mp4") : undefined
    return {
      videoUrl,
      durationSec: made.durationSec,
      width: made.width,
      height: made.height,
      frames: made.frames,
      sha256,
      sourceVideoUrl: args.sourceUrl,
      startSec: args.startSec,
      recipe: PREVIEW_CLIP_RECIPE,
      ...(maskMade && maskUrl && maskSha256 && args.faceMask
        ? { faceMask: { url: maskUrl, frames: maskMade.frames, sha256: maskSha256, sourceMaskUrl: args.faceMask.url } }
        : {}),
      madeAt: new Date().toISOString(),
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * `data` with its preview input clip as the draft needs it now
 * (`previewClipState`, preview-clip.ts):
 *   - `not_offered` (no preview, or no source): the stored clip, if any, dropped;
 *   - `current`: `data` as it is (nothing made);
 *   - `missing` / `out_of_date`: a new clip made (`makePreviewClip`) from the
 *     draft's source at its `previewStart`, with the trend's current stored
 *     face mask (`storedFaceMaskFor`) cut alongside when there is one, and
 *     put on the draft — unless `opts.reuse`, a clip made moments ago (a
 *     background write's earlier attempt, re-read after a lost race), is
 *     current for `data`: then it is put on instead of cutting again.
 * Pure but for the make; throws what `makePreviewClip` throws. The caller
 * saves the result (and answers a media failure as the media route does).
 */
export async function ensurePreviewClip(trendId: string, data: TrendVersionData, opts: { reuse?: TrendPreviewClip } = {}): Promise<TrendVersionData> {
  const state = previewClipState(data)
  if (state.kind === "not_offered") return withoutPreviewClip(data)
  if (state.kind === "current") return data
  if (opts.reuse && previewClipState({ ...data, previewClip: opts.reuse }).kind === "current") return { ...data, previewClip: opts.reuse }
  const source = data.source!
  const startSec = data.previewStart!
  const mask = storedFaceMaskFor(data)
  const previewClip = await makePreviewClip(trendId, {
    sourceUrl: source.videoUrl,
    startSec,
    durationSec: previewClipDurationSec(source.durationSec, startSec),
    ...(mask ? { faceMask: { url: mask.url } } : {}),
  })
  return { ...data, previewClip }
}
