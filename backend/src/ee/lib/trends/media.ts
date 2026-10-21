// @reads-none reads only the temp file it downloads (a trend's media on its way to storage)
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
 */
import { randomUUID } from "node:crypto"
import { mkdtemp, open, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { downloadFile, probeVideoSource } from "../../../providers/video/ffmpeg-utils.js"
import { uploadFileWithKeyToR2 } from "../../../lib/storage.js"
import { imageDimensionsOf } from "../../../lib/image-dimensions.js"

export type TrendMediaKind = "video" | "image"

export type TrendMediaErrorCode = "unsupported_media" | "download_failed" | "media_unreadable" | "clip_out_of_range"

export class TrendMediaError extends Error {
  constructor(
    readonly code: TrendMediaErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "TrendMediaError"
  }
}

export interface StoredTrendMedia {
  url: string
  kind: TrendMediaKind
  width?: number
  height?: number
  durationSec?: number
}

/** The most a trend file may weigh: a 30 s source clip, a result video, a picture. */
const MAX_BYTES: Record<TrendMediaKind, number> = { video: 500 * 1024 * 1024, image: 30 * 1024 * 1024 }

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

/**
 * Copy `sourceUrl` into the trend's storage. `expect` is what it must be; for
 * a video, `durationSec` (inclusive) bounds its length, checked BEFORE the
 * upload. Throws `TrendMediaError` for a file that cannot be fetched, is not
 * the expected kind, cannot be measured or is out of range.
 */
export async function copyToTrendStorage(
  trendId: string,
  sourceUrl: string,
  expect: TrendMediaKind,
  opts: { durationSec?: { min: number; max: number } } = {},
): Promise<StoredTrendMedia> {
  const dir = await mkdtemp(join(tmpdir(), "trend-media-"))
  const file = join(dir, "media")
  try {
    try {
      await downloadFile(sourceUrl, file, { maxBytes: MAX_BYTES[expect] })
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
      } catch {
        throw new TrendMediaError("media_unreadable", "Could not read the video's size and length.")
      }
      const range = opts.durationSec
      if (range && (probe.durationSeconds < range.min || probe.durationSeconds > range.max)) {
        throw new TrendMediaError(
          "clip_out_of_range",
          `The clip is ${probe.durationSeconds.toFixed(1)} s; it must be ${range.min}–${range.max} s.`,
        )
      }
      measured = { width: probe.width, height: probe.height, durationSec: probe.durationSeconds }
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
