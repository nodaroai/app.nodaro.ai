// @reads-none reads only temp files: the one it downloads (a trend's media on its way to storage) and the display copy it makes
/**
 * Trend media: every clip and picture a trend uses lives in the catalog's own
 * storage, under `trends/<trendId>/<uuid>.<ext>` — the admin's source clip and
 * reference pictures, and a promoted example's video, poster and per-slot
 * pictures (an example never points at a job's own files, so a
 * deleted job never breaks a trend). The bucket is public; the key is never
 * returned by a public route.
 *
 * A copy downloads the file (SSRF-guarded), names it by its BYTES (never by
 * the URL's extension), measures it there — so what is measured is exactly
 * what is stored — and uploads it under the trend's key. It is the catalog's
 * storage, not the admin's: no user quota is charged.
 *
 * The source clip also gets a DISPLAY copy (`makeDisplayCopy`): a browser-safe
 * re-encode and a poster, each a new file of its own, which the trend's page
 * shows as the original. Runs keep editing the uploaded clip.
 *
 * An admin's upscale of the source clip or of an example (`storeUpscaledVideo`)
 * is resized to 1080p here and stored the same way, and so is an admin's
 * crop of the source clip to 16:9 or 9:16 (`storeCroppedSource`).
 */
import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdtemp, open, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  BROWSER_SAFE_VIDEO_ARGS,
  COMBINE_DELIVERY_CRF,
  downloadFile,
  hasAudioStream,
  probeVideoSource,
  probeVideoStream,
  runFfmpeg,
  runFfprobe,
  withFfmpegSlot,
} from "../../../providers/video/ffmpeg-utils.js"
import { uploadBufferToR2, uploadFileWithKeyToR2 } from "../../../lib/storage.js"
import { imageDimensionsOf } from "../../../lib/image-dimensions.js"
import { reencodePeakMemoryMiB } from "../../../providers/video/video-file-stages.js"
import { thumbnailFromLocalVideo } from "../../../utils/thumbnail.js"
import type { TrendCropAspect, TrendSourceDisplay } from "./types.js"
import { cropEncodeArgs, cropFilter, cropTargetSize, sourceBitRate, type SourceVideoStream } from "./crop.js"
import { UPSCALE_SHORT_SIDE, upscaleTargetSize } from "./upscale.js"

export type TrendMediaKind = "video" | "image"

export type TrendMediaErrorCode = "unsupported_media" | "download_failed" | "media_unreadable" | "clip_out_of_range"

export class TrendMediaError extends Error {
  constructor(
    readonly code: TrendMediaErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = "TrendMediaError"
  }
}

/**
 * A failure of the box, not of the file: an ffmpeg / ffprobe the platform
 * killed (its time budget, the slot's backstop, the stall watchdog: the
 * `killed` / `timedOut` flags every launch failure carries) or a memory
 * admission it could not reach. The same clip may well pass on a retry, so it
 * is never reported as an unreadable file.
 */
export function isTransientMediaFailure(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const flags = e as { killed?: unknown; timedOut?: unknown }
  return flags.killed === true || flags.timedOut === true || e.message.startsWith("ledger client unavailable")
}

export interface StoredTrendMedia {
  url: string
  kind: TrendMediaKind
  width?: number
  height?: number
  durationSec?: number
  /** A constant-rate video's frame rate (its video stream's), when the probe reads one. */
  fps?: number
  /** The video's display copy, when it was asked for (`display: true`). */
  display?: TrendSourceDisplay
  /** SHA-256 (hex) of the stored file, a video's only: what a full run's `sourceAsset` names. */
  sha256?: string
}

/** SHA-256 (hex) of the local file at `path`, streamed (a source clip can weigh hundreds of MB). */
export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

/** The most a trend file may weigh: a 30 s source clip, a result video, a picture. */
export const TREND_MEDIA_MAX_BYTES: Record<TrendMediaKind, number> = { video: 500 * 1024 * 1024, image: 30 * 1024 * 1024 }

interface Sniffed { kind: TrendMediaKind; ext: string; contentType: string }

/** What a file is, from its first bytes: the formats trends store, else null. */
export function sniffMedia(head: Buffer): Sniffed | null {
  const ascii = (from: number, to: number) => head.subarray(from, to).toString("latin1")
  if (head.length >= 8 && head.readUInt32BE(0) === 0x89504e47) return { kind: "image", ext: "png", contentType: "image/png" }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: "image", ext: "jpg", contentType: "image/jpeg" }
  if (head.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { kind: "image", ext: "webp", contentType: "image/webp" }
  if (head.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return { kind: "image", ext: "gif", contentType: "image/gif" }
  if (head.length >= 12 && ascii(4, 8) === "ftyp") {
    return ascii(8, 12) === "qt  "
      ? { kind: "video", ext: "mov", contentType: "video/quicktime" }
      : { kind: "video", ext: "mp4", contentType: "video/mp4" }
  }
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return { kind: "video", ext: "webm", contentType: "video/webm" }
  return null
}

/** A new key for one of a trend's files. */
export function trendMediaKey(trendId: string, ext: string): string {
  return `trends/${trendId}/${randomUUID()}.${ext}`
}

async function readHead(path: string, bytes = 16): Promise<Buffer> {
  const fh = await open(path, "r")
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await fh.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

/** The poster's hold on an ffmpeg slot: one frame, well under a minute. */
const POSTER_SLOT = { timeoutMs: 60_000, label: "trend display poster" } as const

/**
 * The source clip's display copy (trends "show the original", S7): the local
 * video at `localVideoPath` re-encoded to H.264 / yuv420p / AAC with
 * faststart, ALWAYS (even an upload that is already H.264 gets a new file, so
 * the uploaded clip's URL is never the one shown), uploaded under
 * `trends/<trendId>/<uuid>.mp4`, plus its first frame as a PNG poster. Width,
 * height and length are probed from the COPY: ffmpeg applies a rotation tag
 * as it decodes, so a portrait phone clip reads portrait.
 *
 * The re-encode is `runFfmpeg` (it holds its own ffmpeg slot), admitted
 * against a full re-encode's predicted memory at `canvas`, the clip's probed
 * size (unknown: predicted at 4K); the poster, which spawns ffmpeg without a
 * slot, borrows one through `withFfmpegSlot`.
 * The input file is only read. Throws `TrendMediaError("media_unreadable")`
 * (the ffmpeg / ffprobe failure as its `cause`) when the clip cannot be
 * re-encoded, measured or postered, before anything is stored. A launch the
 * platform killed or could not admit (`isTransientMediaFailure`) and a
 * storage failure are thrown as they are.
 */
export async function makeDisplayCopy(
  trendId: string,
  localVideoPath: string,
  opts: { canvas?: { width: number; height: number } } = {},
): Promise<TrendSourceDisplay> {
  const dir = await mkdtemp(join(tmpdir(), "trend-display-"))
  const out = join(dir, "display.mp4")
  try {
    let probe: Awaited<ReturnType<typeof probeVideoSource>>
    let poster: Buffer
    try {
      await runFfmpeg([
        "-y", "-i", localVideoPath,
        // The picture and, when there is one, the sound: never a data or subtitle track.
        "-map", "0:v:0", "-map", "0:a:0?",
        // yuv420p needs even sides; a phone clip can have an odd one.
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        ...BROWSER_SAFE_VIDEO_ARGS,
        "-c:a", "aac", "-b:a", "128k",
        out,
      ], undefined, { peakMemoryMiB: reencodePeakMemoryMiB(opts.canvas) })
      probe = await probeVideoSource(out)
      poster = await withFfmpegSlot(() => thumbnailFromLocalVideo(out), POSTER_SLOT)
    } catch (e) {
      // A killed or unadmitted launch says nothing about the clip: thrown as it is.
      if (isTransientMediaFailure(e)) throw e
      throw new TrendMediaError("media_unreadable", "Could not make a playable copy of the video.", { cause: e })
    }
    const videoUrl = await uploadFileWithKeyToR2(out, trendMediaKey(trendId, "mp4"), "video/mp4")
    const posterUrl = await uploadBufferToR2(poster, trendMediaKey(trendId, "png"), "image/png")
    return { videoUrl, posterUrl, width: probe.width, height: probe.height, durationSec: probe.durationSeconds }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** A trend's source clip: 4–30 s. */
export const TREND_SOURCE_SECONDS = { min: 4, max: 30 } as const

/**
 * Copy `sourceUrl` into the trend's storage. `expect` is what it must be; for
 * a video, `durationSec` (inclusive) bounds its length, checked BEFORE the
 * upload, and `display: true` also makes its display copy (`makeDisplayCopy`:
 * the source clip only, never an example's video), before the clip itself is
 * stored. Throws `TrendMediaError` for a file that cannot be fetched, is not
 * the expected kind, cannot be measured, is out of range or (with `display`)
 * cannot be re-encoded.
 */
export async function copyToTrendStorage(
  trendId: string,
  sourceUrl: string,
  expect: TrendMediaKind,
  opts: StoreOptions = {},
): Promise<StoredTrendMedia> {
  const dir = await mkdtemp(join(tmpdir(), "trend-media-"))
  const file = join(dir, "media")
  try {
    await fetchTo(sourceUrl, file, expect)
    return await storeLocalTrendMedia(trendId, file, expect, opts)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export interface StoreOptions {
  durationSec?: { min: number; max: number }
  display?: boolean
}

/** Download `url` to `file`, within the kind's size; `TrendMediaError("download_failed")` otherwise. */
async function fetchTo(url: string, file: string, kind: TrendMediaKind): Promise<void> {
  try {
    await downloadFile(url, file, { maxBytes: TREND_MEDIA_MAX_BYTES[kind] })
  } catch (e) {
    throw new TrendMediaError("download_failed", `Could not fetch the file: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Store the local `file` in the trend's storage, as `copyToTrendStorage`
 * stores a downloaded one (the same checks, measures and display copy): what
 * a new source clip goes through, however it was made. The file is only read.
 */
export async function storeLocalTrendMedia(
  trendId: string,
  file: string,
  expect: TrendMediaKind,
  opts: StoreOptions = {},
): Promise<StoredTrendMedia> {
  const sniffed = sniffMedia(await readHead(file))
  if (!sniffed || sniffed.kind !== expect) {
    throw new TrendMediaError(
      "unsupported_media",
      expect === "video" ? "Not a video this platform stores (MP4, MOV or WebM)." : "Not a picture this platform stores (PNG, JPEG, WebP or GIF).",
    )
  }

  let measured: Omit<StoredTrendMedia, "url" | "kind"> = {}
  if (expect === "video") {
    let probe: Awaited<ReturnType<typeof probeVideoSource>>
    try {
      probe = await probeVideoSource(file)
    } catch (e) {
      if (isTransientMediaFailure(e)) throw e
      throw new TrendMediaError("media_unreadable", "Could not read the video's size and length.", { cause: e })
    }
    const range = opts.durationSec
    if (range && (probe.durationSeconds < range.min || probe.durationSeconds > range.max)) {
      throw new TrendMediaError(
        "clip_out_of_range",
        `The clip is ${probe.durationSeconds.toFixed(1)} s; it must be ${range.min}–${range.max} s.`,
      )
    }
    measured = { width: probe.width, height: probe.height, durationSec: probe.durationSeconds, ...(probe.fps ? { fps: probe.fps } : {}) }
    if (opts.display) measured.display = await makeDisplayCopy(trendId, file, { canvas: { width: probe.width, height: probe.height } })
    // Hashed as it is stored (the same bytes), for the provenance a run records (`sourceAsset`).
    measured.sha256 = await sha256OfFile(file)
  } else {
    const dims = await imageDimensionsOf(file)
    if (dims) measured = { width: dims.width, height: dims.height }
  }

  const url = await uploadFileWithKeyToR2(file, trendMediaKey(trendId, sniffed.ext), sniffed.contentType)
  return { url, kind: expect, ...measured }
}

/** A video upscaled to 1080p and stored in the trend's storage, measured there. */
export interface StoredUpscale {
  url: string
  width: number
  height: number
  durationSec: number
  /** An example's fresh poster (its first frame). */
  posterUrl?: string
  /** The source clip's fresh display copy. */
  display?: TrendSourceDisplay
  /** SHA-256 (hex) of the stored file. */
  sha256?: string
}

/** The ffmpeg arguments that resize `input` to `size` (short side 1080), the sound taken from `soundFrom`. */
export function upscaleResizeArgs(input: string, soundFrom: string, size: { width: number; height: number }, maxSec: number, audio: "copy" | "aac", out: string): string[] {
  const short = Math.min(size.width, size.height)
  const long = Math.max(size.width, size.height)
  // Picked by the DECODED frame's orientation, not the probed one: ffmpeg applies a
  // rotation tag as it decodes, so a rotated clip's frame is the other way up.
  const w = `'if(lte(iw,ih),${short},${long})'`
  const h = `'if(lte(iw,ih),${long},${short})'`
  return [
    "-y", "-i", input, "-i", soundFrom,
    // The upscaled picture, and the sound of the clip it was made from: Topaz may drop it.
    "-map", "0:v:0", "-map", "1:a:0?",
    "-vf", `scale=${w}:${h}:flags=lanczos,setsar=1`,
    // Never longer than the clip it replaces (a source clip has a 30 s ceiling).
    "-t", maxSec.toFixed(3),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", COMBINE_DELIVERY_CRF, "-movflags", "+faststart",
    ...(audio === "copy" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"]),
    out,
  ]
}

/** How far past the original's length an upscale may run and still be stored as it is (about a frame). */
const UPSCALE_LENGTH_SLACK_SEC = 0.05

/**
 * Whether an ffmpeg failure is the MP4 refusing to carry the copied SOUND
 * (stream #1: the picture is #0) as it is — the one failure the AAC re-encode
 * cures. Anything else is not retried.
 */
export function isAudioCopyFailure(e: unknown): boolean {
  return e instanceof Error && /Could not find tag for codec \S+ in stream #1\b/.test(e.message)
}

const sameWayRound = (a: { width: number; height: number }, b: { width: number; height: number }) =>
  a.width === a.height || b.width === b.height || a.width > a.height === b.width > b.height

/**
 * Whether Topaz's output can be stored as it is, with no re-encode: exactly
 * 1080 on its short side with even sides, the same way round as the original
 * is shown (when that is known), no longer than the original, browser-safe
 * H.264 / yuv420p, and carrying sound whenever the original has some.
 */
async function storableAsIs(
  up: string,
  original: string,
  probe: { width: number; height: number; durationSeconds: number },
  args: { durationSec: number; shownAs?: { width: number; height: number } },
): Promise<boolean> {
  if (Math.min(probe.width, probe.height) !== UPSCALE_SHORT_SIDE || probe.width % 2 !== 0 || probe.height % 2 !== 0) return false
  if (args.shownAs && !sameWayRound(args.shownAs, probe)) return false
  if (probe.durationSeconds > args.durationSec + UPSCALE_LENGTH_SLACK_SEC) return false
  try {
    const stream = await probeVideoStream(up)
    if (stream.codec !== "h264" || stream.pixFmt !== "yuv420p") return false
    return (await hasAudioStream(up)) || !(await hasAudioStream(original))
  } catch (e) {
    if (isTransientMediaFailure(e)) throw e
    // Unreadable as it is: the resize reads it again, and refuses it if it must.
    return false
  }
}

/**
 * Store a Topaz upscale (`upscaledUrl`, asked for at 1080p) of `originalUrl`
 * as 1080p. When Topaz's output already is exactly that (`storableAsIs`) it
 * is stored as it is; otherwise it is resized so its short side is exactly
 * `UPSCALE_SHORT_SIDE` (aspect kept, even sides; `upscaleTargetSize`), no
 * longer than `durationSec`, with the ORIGINAL's sound copied (re-encoded to
 * AAC only when the MP4 cannot hold it as it is). Then:
 *   - `asSource`: stored exactly as a new source clip is (`storeLocalTrendMedia`
 *     with the source's length range and a new display copy);
 *   - otherwise (an example): stored with a fresh poster, its first frame.
 * `shownAs` is the original's size as it is SHOWN (a rotation applied: the
 * source's display copy, an example's own size), when known: an upscale that
 * comes out the other way round (Topaz dropping a phone clip's rotation tag)
 * is refused rather than stored sideways.
 * Throws `TrendMediaError` for a file that cannot be fetched or resized, or
 * that does not come out at 1080p the right way round, before anything is
 * stored; a launch the platform killed or could not admit, and a storage
 * failure, are thrown as they are.
 */
export async function storeUpscaledVideo(
  trendId: string,
  args: { upscaledUrl: string; originalUrl: string; durationSec: number; asSource: boolean; shownAs?: { width: number; height: number } },
): Promise<StoredUpscale> {
  const dir = await mkdtemp(join(tmpdir(), "trend-upscale-"))
  const up = join(dir, "upscaled")
  const original = join(dir, "original")
  const resized = join(dir, "1080p.mp4")
  try {
    await fetchTo(args.upscaledUrl, up, "video")
    await fetchTo(args.originalUrl, original, "video")
    let probe: Awaited<ReturnType<typeof probeVideoSource>>
    try {
      probe = await probeVideoSource(up)
    } catch (e) {
      if (isTransientMediaFailure(e)) throw e
      throw new TrendMediaError("media_unreadable", "Could not read the upscaled video's size.", { cause: e })
    }

    let out = up
    let made: { width: number; height: number; durationSeconds: number } = probe
    if (!(await storableAsIs(up, original, probe, args))) {
      out = resized
      const size = upscaleTargetSize(probe.width, probe.height)
      // Admitted at the larger of the two canvases: the decode of the upscale, or the encode at 1080p.
      const canvas = probe.width * probe.height >= size.width * size.height ? { width: probe.width, height: probe.height } : size
      const launch = { peakMemoryMiB: reencodePeakMemoryMiB(canvas) }
      try {
        try {
          await runFfmpeg(upscaleResizeArgs(up, original, size, args.durationSec, "copy", out), undefined, launch)
        } catch (e) {
          // Only a sound the MP4 cannot carry as it is (ADPCM from a MOV, say) is encoded to AAC instead.
          if (!isAudioCopyFailure(e)) throw e
          await runFfmpeg(upscaleResizeArgs(up, original, size, args.durationSec, "aac", out), undefined, launch)
        }
      } catch (e) {
        if (isTransientMediaFailure(e)) throw e
        throw new TrendMediaError("media_unreadable", "Could not resize the upscaled video to 1080p.", { cause: e })
      }
      // Checked before anything is stored. The resize applied any rotation, so its size is the shown one.
      try {
        made = await probeVideoSource(out)
      } catch (e) {
        if (isTransientMediaFailure(e)) throw e
        throw new TrendMediaError("media_unreadable", "Could not read the resized video's size.", { cause: e })
      }
    }
    if (Math.min(made.width, made.height) !== UPSCALE_SHORT_SIDE) {
      throw new TrendMediaError("media_unreadable", `The upscaled video came out at ${made.width}×${made.height}, not 1080p.`)
    }
    const shown = args.shownAs
    if (shown && !sameWayRound(shown, made)) {
      throw new TrendMediaError(
        "media_unreadable",
        `The upscaled video came out ${made.width > made.height ? "landscape" : "portrait"} (${made.width}×${made.height}), but the original is shown ${shown.width > shown.height ? "landscape" : "portrait"}: the upscale lost its rotation.`,
      )
    }

    let posterUrl: string | undefined
    if (!args.asSource) {
      let poster: Buffer
      try {
        poster = await withFfmpegSlot(() => thumbnailFromLocalVideo(out), POSTER_SLOT)
      } catch (e) {
        if (isTransientMediaFailure(e)) throw e
        throw new TrendMediaError("media_unreadable", "Could not make a poster of the upscaled video.", { cause: e })
      }
      posterUrl = await uploadBufferToR2(poster, trendMediaKey(trendId, "png"), "image/png")
    }
    const stored = await storeLocalTrendMedia(
      trendId,
      out,
      "video",
      args.asSource ? { durationSec: TREND_SOURCE_SECONDS, display: true } : {},
    )
    const { width = made.width, height = made.height, durationSec = made.durationSeconds } = stored
    return {
      url: stored.url,
      width,
      height,
      durationSec,
      ...(posterUrl ? { posterUrl } : {}),
      ...(stored.display ? { display: stored.display } : {}),
      ...(stored.sha256 ? { sha256: stored.sha256 } : {}),
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * The ffmpeg arguments that crop `input` to `aspect` at `position` into
 * `out` (`cropFilter`: on the DECODED frame, so a phone clip is cropped as it
 * is shown), the picture encoded to keep the original's quality
 * (`cropEncodeArgs` of its own stream). The first picture and the first sound
 * track only; the sound copied, or re-encoded to AAC when the MP4 cannot hold
 * it as it is.
 */
export function cropVideoArgs(
  input: string,
  crop: { aspect: TrendCropAspect; position: number },
  stream: SourceVideoStream,
  audio: "copy" | "aac",
  out: string,
  passLog?: string,
): string[] {
  return [
    "-y", "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-map_metadata", "-1", "-map_chapters", "-1",
    "-vf", `${cropFilter(crop.aspect, crop.position)},setsar=1`,
    ...cropEncodeArgs(stream, passLog && sourceBitRate(stream) ? { n: 2, log: passLog } : undefined),
    "-movflags", "+faststart",
    ...(audio === "copy" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"]),
    out,
  ]
}

/** The first of the two passes (`cropEncodeArgs`): the picture only, measured into `passLog`, nothing written. */
export function cropFirstPassArgs(input: string, crop: { aspect: TrendCropAspect; position: number }, stream: SourceVideoStream, passLog: string): string[] {
  return [
    "-y", "-i", input,
    "-map", "0:v:0", "-an",
    "-vf", `${cropFilter(crop.aspect, crop.position)},setsar=1`,
    ...cropEncodeArgs(stream, { n: 1, log: passLog }),
    "-f", "null", "-",
  ]
}

const num = (v: unknown): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}
const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)

/**
 * The picture stream of the local `file` as `cropEncodeArgs` reads it. Its
 * bitrate is the stream's own, else the container's less the sound's (a
 * WebM / MKV stream reports none). Never throws: what it cannot read is left
 * out, and the crop then encodes at a visually lossless constant quality.
 */
export async function probeSourceVideoStream(file: string): Promise<SourceVideoStream> {
  try {
    const out = await runFfprobe([
      "-v", "error",
      "-show_entries", "stream=codec_type,codec_name,pix_fmt,bit_rate,color_space,color_primaries,color_transfer,color_range:format=bit_rate",
      "-of", "json",
      file,
    ])
    const parsed = JSON.parse(out) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> }
    const streams = parsed.streams ?? []
    const v = streams.find((x) => x.codec_type === "video")
    if (!v) return {}
    const audioRate = streams.filter((x) => x.codec_type === "audio").reduce((n, a) => n + (num(a.bit_rate) ?? 0), 0)
    const formatRate = num(parsed.format?.bit_rate)
    const bitRate = num(v.bit_rate) ?? (formatRate && formatRate > audioRate ? formatRate - audioRate : undefined)
    return {
      ...(text(v.codec_name) ? { codec: text(v.codec_name) } : {}),
      ...(text(v.pix_fmt) ? { pixFmt: text(v.pix_fmt) } : {}),
      ...(bitRate ? { bitRate } : {}),
      ...(text(v.color_space) ? { colorSpace: text(v.color_space) } : {}),
      ...(text(v.color_primaries) ? { colorPrimaries: text(v.color_primaries) } : {}),
      ...(text(v.color_transfer) ? { colorTransfer: text(v.color_transfer) } : {}),
      ...(text(v.color_range) ? { colorRange: text(v.color_range) } : {}),
    }
  } catch (e) {
    if (isTransientMediaFailure(e)) throw e
    return {}
  }
}

/** A source clip cropped and stored in the trend's storage, measured there. */
export interface StoredCrop {
  url: string
  width: number
  height: number
  durationSec: number
  display?: TrendSourceDisplay
  /** SHA-256 (hex) of the stored file. */
  sha256?: string
}

/**
 * Crop the source clip `sourceUrl` to `aspect` at `position`
 * (`cropVideoArgs`, keeping the original's quality) and store it exactly as a
 * new source clip is (`storeLocalTrendMedia` with the source's length range
 * and a new display copy). The crop is checked to have come out at the size
 * expected (`cropTargetSize` of the clip as decoded) before anything is
 * stored. Throws `TrendMediaError` for a file that cannot be fetched, read or
 * cropped, or that does not come out as expected; a launch the platform
 * killed or could not admit, and a storage failure, are thrown as they are.
 */
export async function storeCroppedSource(
  trendId: string,
  args: { sourceUrl: string; aspect: TrendCropAspect; position: number },
): Promise<StoredCrop> {
  const dir = await mkdtemp(join(tmpdir(), "trend-crop-"))
  const original = join(dir, "original")
  const cropped = join(dir, "cropped.mp4")
  try {
    await fetchTo(args.sourceUrl, original, "video")
    let probe: Awaited<ReturnType<typeof probeVideoSource>>
    try {
      probe = await probeVideoSource(original)
    } catch (e) {
      if (isTransientMediaFailure(e)) throw e
      throw new TrendMediaError("media_unreadable", "Could not read the source clip's size.", { cause: e })
    }
    const stream = await probeSourceVideoStream(original)
    // Admitted at the clip's own canvas: the decode is the larger side of the work.
    const launch = { peakMemoryMiB: reencodePeakMemoryMiB({ width: probe.width, height: probe.height }) }
    // At the original's bitrate, in two passes: the first measures the clip into `passLog`.
    const passLog = sourceBitRate(stream) ? join(dir, "pass") : undefined
    try {
      if (passLog) await runFfmpeg(cropFirstPassArgs(original, args, stream, passLog), undefined, launch)
      try {
        await runFfmpeg(cropVideoArgs(original, args, stream, "copy", cropped, passLog), undefined, launch)
      } catch (e) {
        if (!isAudioCopyFailure(e)) throw e
        await runFfmpeg(cropVideoArgs(original, args, stream, "aac", cropped, passLog), undefined, launch)
      }
    } catch (e) {
      if (isTransientMediaFailure(e)) throw e
      throw new TrendMediaError("media_unreadable", `Could not crop the source clip to ${args.aspect}.`, { cause: e })
    }
    let made: Awaited<ReturnType<typeof probeVideoSource>>
    try {
      made = await probeVideoSource(cropped)
    } catch (e) {
      if (isTransientMediaFailure(e)) throw e
      throw new TrendMediaError("media_unreadable", "Could not read the cropped clip's size.", { cause: e })
    }
    // The crop applied any rotation, so its size is the shown one: the decoded frame either way round.
    const expected = [cropTargetSize(probe.width, probe.height, args.aspect), cropTargetSize(probe.height, probe.width, args.aspect)]
    if (!expected.some((e) => e.width === made.width && e.height === made.height)) {
      throw new TrendMediaError("media_unreadable", `The cropped clip came out at ${made.width}×${made.height}, not ${args.aspect}.`)
    }
    const stored = await storeLocalTrendMedia(trendId, cropped, "video", { durationSec: TREND_SOURCE_SECONDS, display: true })
    const { width = made.width, height = made.height, durationSec = made.durationSeconds } = stored
    return { url: stored.url, width, height, durationSec, ...(stored.display ? { display: stored.display } : {}), ...(stored.sha256 ? { sha256: stored.sha256 } : {}) }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
