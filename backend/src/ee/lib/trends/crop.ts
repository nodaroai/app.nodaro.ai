/**
 * Cropping a trend's source clip to 16:9 or 9:16 (pure; no I/O).
 *
 * A source clip wider than 16:9 (an ultra-wide 2568×1080, say) can be cut at
 * the sides to 16:9, and one taller than 9:16 cut at the top and bottom to
 * 9:16, the clip's height (16:9) or width (9:16) kept. The admin decides how
 * the cut is shared between the two sides (`position`; centered by default).
 * Only the crop that trims is offered: a clip already 16:9, 9:16 or in
 * between (4:3, 1:1) gets none.
 *
 * The shape is judged on the clip as SHOWN (the display copy: a phone clip's
 * rotation applied), the way ffmpeg crops it (it rotates before it crops).
 *
 * The crop keeps the original's quality (`cropEncodeArgs`): a crop changes
 * the pixels, so the picture is encoded again, in the original's codec family
 * at the original's bitrate, pixel format and colour tags; the sound is copied.
 */
import { TREND_CROP_DEFAULT_POSITION, trendCropAspectFor, trendCropTargetSize } from "@nodaro/render-rules"
import type { TrendCropAspect, TrendSourceCrop, TrendVersionData } from "./types.js"

export type { TrendCropAspect }

/**
 * How long a crop may run in the background before it is taken for dead (a
 * server restart) and may be started again. The download, the crop and the
 * store of a 30 s clip take minutes at most.
 */
export const CROP_STALE_MS = 15 * 60 * 1000

/**
 * The shape rules, shared with the trend builder (`@nodaro/render-rules`): the
 * crop a clip (as shown) is offered (16:9 when wider than 16:9, 9:16 when
 * taller than 9:16, else none), the size it comes out at, and the default
 * position (centered).
 */
export const cropAspectFor = trendCropAspectFor
export const cropTargetSize = trendCropTargetSize
export const DEFAULT_CROP_POSITION = TREND_CROP_DEFAULT_POSITION

/** The source clip's size as shown: its display copy's (rotation applied), else its own. */
export function shownSourceSize(source: TrendVersionData["source"]): { width: number; height: number } | null {
  if (!source) return null
  const width = source.display?.width ?? source.width
  const height = source.display?.height ?? source.height
  return width && height ? { width, height } : null
}

/** Whether `crop` is running now: started, not failed, and not yet stale. */
export function isCropping(crop: Pick<TrendSourceCrop, "startedAt" | "error"> | undefined, now = Date.now()): boolean {
  if (!crop || crop.error) return false
  const at = Date.parse(crop.startedAt)
  return Number.isFinite(at) && now - at < CROP_STALE_MS
}

/**
 * The source crop as the editor shows it: `current` = it was made from the
 * source the draft holds now; `running` = it is running (`stale`: it was
 * running past `CROP_STALE_MS` and may be started again); `error` = it failed.
 */
export interface PendingSourceCrop {
  aspect: TrendCropAspect
  position: number
  fromUrl: string
  startedAt: string
  current: boolean
  running: boolean
  stale: boolean
  error?: { code: string; message: string }
}

export function pendingSourceCrop(data: Pick<TrendVersionData, "source" | "sourceCrop">, now = Date.now()): PendingSourceCrop | null {
  const c = data.sourceCrop
  if (!c) return null
  const running = isCropping(c, now)
  return {
    aspect: c.aspect,
    position: c.position,
    fromUrl: c.fromUrl,
    startedAt: c.startedAt,
    current: data.source?.videoUrl === c.fromUrl,
    running,
    stale: !c.error && !running,
    ...(c.error ? { error: { code: c.error.code, message: c.error.message } } : {}),
  }
}

/** `data` without its source crop record (the key left out). */
export function withoutSourceCrop<T extends Pick<TrendVersionData, "sourceCrop">>(data: T): T {
  const { sourceCrop: _crop, ...rest } = data
  return rest as T
}

/** What the probe says about the original's picture (absent = not reported). */
export interface SourceVideoStream {
  codec?: string
  pixFmt?: string
  /** Bits per second of the picture alone. */
  bitRate?: number
  colorSpace?: string
  colorPrimaries?: string
  colorTransfer?: string
  colorRange?: string
}

/** Pixel formats kept as they are; any other is encoded as yuv420p. 10-bit is kept only on HEVC (an 8-bit-only libx264 build refuses it). */
const KEPT_PIX_FMTS_8BIT = new Set(["yuv420p", "yuv422p", "yuv444p"])
const KEPT_PIX_FMTS_10BIT_HEVC = new Set(["yuv420p10le", "yuv422p10le", "yuv444p10le"])
/** The picture is encoded at a constant quality this high when its bitrate is unknown (visually lossless). */
export const CROP_FALLBACK_CRF = "14"

/** The original's picture bitrate, when it is known: a crop encoded at it runs in two passes (`cropEncodeArgs`). */
export function sourceBitRate(stream: SourceVideoStream): number | undefined {
  return stream.bitRate && stream.bitRate > 0 ? Math.round(stream.bitRate) : undefined
}

/**
 * The picture encode of a crop that keeps the original's quality: the same
 * codec family (HEVC stays HEVC, tagged `hvc1` for players; anything else is
 * H.264), its pixel format where the encoder can keep it, its colour tags,
 * and the original's own bitrate — in two passes (`pass`), since one pass of
 * x264 aims low on a short clip (a 7.7 Mbit/s original came out 3.4) and two
 * hit it. The crop keeps fewer pixels at that rate, so each gets more bits
 * than in the original. A bitrate the probe could not read encodes in one pass
 * at a visually lossless constant quality instead (no `pass`).
 */
export function cropEncodeArgs(stream: SourceVideoStream, pass?: { n: 1 | 2; log: string }): string[] {
  const hevc = stream.codec === "hevc"
  const pix = stream.pixFmt === "yuvj420p" ? "yuv420p" : stream.pixFmt
  const pixFmt = pix && (KEPT_PIX_FMTS_8BIT.has(pix) || (hevc && KEPT_PIX_FMTS_10BIT_HEVC.has(pix))) ? pix : "yuv420p"
  const rate = sourceBitRate(stream)
  const tag = (flag: string, v: string | undefined) => (v && v !== "unknown" ? [flag, v] : [])
  const passArgs = !rate || !pass
    ? []
    : hevc
      ? ["-x265-params", `pass=${pass.n}:stats=${pass.log}`]
      : ["-pass", String(pass.n), "-passlogfile", pass.log]
  return [
    ...(hevc ? ["-c:v", "libx265", "-tag:v", "hvc1"] : ["-c:v", "libx264"]),
    "-preset", "medium",
    ...(rate ? ["-b:v", String(rate), ...passArgs] : ["-crf", CROP_FALLBACK_CRF]),
    "-pix_fmt", pixFmt,
    ...tag("-colorspace", stream.colorSpace),
    ...tag("-color_primaries", stream.colorPrimaries),
    ...tag("-color_trc", stream.colorTransfer),
    ...tag("-color_range", stream.colorRange),
  ]
}

/**
 * The ffmpeg `crop` filter for `aspect` at `position` (0–1 of the cut from
 * the left / top), on the DECODED frame: height kept for 16:9, width for
 * 9:16, every size and offset even.
 */
export function cropFilter(aspect: TrendCropAspect, position: number): string {
  const p = Math.min(1, Math.max(0, position))
  return aspect === "16:9"
    ? `crop=w='trunc(ih*16/9/2)*2':h='trunc(ih/2)*2':x='trunc((iw-ow)*${p}/2)*2':y=0`
    : `crop=w='trunc(iw/2)*2':h='trunc(iw*16/9/2)*2':x=0:y='trunc((ih-oh)*${p}/2)*2'`
}
