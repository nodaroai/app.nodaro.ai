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
 */
import { randomUUID } from "node:crypto"
import { mkdtemp, open, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BROWSER_SAFE_VIDEO_ARGS, downloadFile, probeVideoSource, runFfmpeg, withFfmpegSlot } from "../../../providers/video/ffmpeg-utils.js"
import { uploadBufferToR2, uploadFileWithKeyToR2 } from "../../../lib/storage.js"
import { imageDimensionsOf } from "../../../lib/image-dimensions.js"
import { reencodePeakMemoryMiB } from "../../../providers/video/video-file-stages.js"
import { thumbnailFromLocalVideo } from "../../../utils/thumbnail.js"
import type { TrendSourceDisplay } from "./types.js"

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
  /** The video's display copy, when it was asked for (`display: true`). */
  display?: TrendSourceDisplay
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
  opts: { durationSec?: { min: number; max: number }; display?: boolean } = {},
): Promise<StoredTrendMedia> {
  const dir = await mkdtemp(join(tmpdir(), "trend-media-"))
  const file = join(dir, "media")
  try {
    try {
      await downloadFile(sourceUrl, file, { maxBytes: TREND_MEDIA_MAX_BYTES[expect] })
    } catch (e) {
      throw new TrendMediaError("download_failed", `Could not fetch the file: ${e instanceof Error ? e.message : String(e)}`)
    }

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
      measured = { width: probe.width, height: probe.height, durationSec: probe.durationSeconds }
      if (opts.display) measured.display = await makeDisplayCopy(trendId, file, { canvas: { width: probe.width, height: probe.height } })
    } else {
      const dims = await imageDimensionsOf(file)
      if (dims) measured = { width: dims.width, height: dims.height }
    }

    const url = await uploadFileWithKeyToR2(file, trendMediaKey(trendId, sniffed.ext), sniffed.contentType)
    return { url, kind: expect, ...measured }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
