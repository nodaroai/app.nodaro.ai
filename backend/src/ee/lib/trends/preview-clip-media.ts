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
 * The cut (`previewClipArgs`): `-ss` BEFORE `-i` (an input seek: ffmpeg seeks
 * to the keyframe before `start` and decodes up to it, so the first frame out
 * is the one AT `start`), re-encoded (never a stream copy, which can only cut
 * on a keyframe) to H.264 / yuv420p at a near-lossless constant quality, with
 * the first sound track as AAC, faststart. NO scaling and NO `-r`: the clip
 * keeps the source's size and frame rate, so its frame count stays aligned
 * with the face mask's cut (`faceMask`), made with the IDENTICAL arguments
 * from the trend's approved stored mask (its whole-source masked clip). A
 * mask cut whose frame count differs from the clip's is a real fault (the
 * mask and the source were asserted aligned at approval): thrown, never
 * papered over.
 *
 * Pattern: media.ts `makeDisplayCopy` (a temp dir, `downloadFile` within the
 * trend video limit, `runFfmpeg` admitted at the clip's canvas, probe, upload,
 * cleanup); `TrendMediaError("media_unreadable")` for a clip ffmpeg cannot
 * cut or measure, a killed or unadmitted launch thrown as it is
 * (`isTransientMediaFailure`), and nothing stored before every cut is made
 * and checked.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { downloadFile, probeVideoFrameCount, probeVideoSource, runFfmpeg } from "../../../providers/video/ffmpeg-utils.js"
import { uploadFileWithKeyToR2 } from "../../../lib/storage.js"
import { reencodePeakMemoryMiB } from "../../../providers/video/video-file-stages.js"
import { TREND_MEDIA_MAX_BYTES, TrendMediaError, isTransientMediaFailure, sha256OfFile, trendMediaKey } from "./media.js"
import { PREVIEW_CLIP_RECIPE, previewClipDurationSec, previewClipState, withoutPreviewClip } from "./preview-clip.js"
import { storedFaceMaskFor } from "./face-mask.js"
import type { TrendPreviewClip, TrendVersionData } from "./types.js"

/** Seconds as ffmpeg takes them: millisecond precision is finer than any frame. */
const sec = (s: number) => s.toFixed(3)

/**
 * The ffmpeg arguments that cut `durationSec` of `input` from `startSec` into
 * `out`, frame-accurately (an input seek, then a re-encode). Pure; the same
 * for the source clip and its face mask, so their frames align. Bump
 * `PREVIEW_CLIP_RECIPE` (preview-clip.ts) when these change.
 */
export function previewClipArgs(input: string, startSec: number, durationSec: number, out: string): string[] {
  return [
    "-y",
    "-ss", sec(startSec),
    "-i", input,
    "-t", sec(durationSec),
    // The picture and, when there is one, the sound: never a data or subtitle track.
    "-map", "0:v:0", "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    out,
  ]
}

export interface MakePreviewClipArgs {
  /** The source clip's hidden URL (`source.videoUrl`): recorded as `sourceVideoUrl`. */
  sourceUrl: string
  /** Where the window starts (`previewStart`): recorded as `startSec`. */
  startSec: number
  /** How long to cut (`previewClipDurationSec`). */
  durationSec: number
  /** The trend's approved stored face mask (its whole-source masked clip), cut with the same arguments. */
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
  args: Pick<MakePreviewClipArgs, "startSec" | "durationSec">,
  canvas: { width: number; height: number } | undefined,
  what: string,
): Promise<{ frames: number; width: number; height: number; durationSec: number }> {
  try {
    await runFfmpeg(previewClipArgs(input, args.startSec, args.durationSec, out), undefined, { peakMemoryMiB: reencodePeakMemoryMiB(canvas) })
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
 * Cut the preview input clip of trend `trendId` from `sourceUrl` at
 * `startSec` for `durationSec` (and the face mask's matching cut, when
 * `faceMask` is given), upload both under `trends/<trendId>/` and return the
 * record to store on the draft (`TrendPreviewClip`: the clip's URL, size,
 * length, frame count and SHA-256, what it was cut from, and `madeAt`).
 *
 * Throws `TrendMediaError` (`download_failed`, `media_unreadable`) before
 * anything is stored when a file cannot be fetched, cut or measured, or when
 * the mask's cut does not have the clip's frame count; a launch the platform
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
    // The re-encode is admitted at the clip's own canvas; unreadable here, at the default (4K).
    const canvas = await probeVideoSource(source).then((p) => ({ width: p.width, height: p.height }), (e: unknown) => {
      if (isTransientMediaFailure(e)) throw e
      return undefined
    })
    const made = await cut(source, clip, args, canvas, "the source clip")

    let maskMade: { frames: number } | undefined
    if (args.faceMask) {
      await fetchVideo(args.faceMask.url, mask)
      maskMade = await cut(mask, maskClip, args, canvas, "the face mask")
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
