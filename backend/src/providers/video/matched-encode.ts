/**
 * One picture encode for every re-encode that must keep the source's quality
 * (the house rule for a re-encode: never a fixed constant-quality preset on
 * someone's media):
 *
 * - H.264 at the source's own picture bitrate, in two passes when the caller
 *   runs them (one pass aims low on a short clip);
 * - its pixel format where 8-bit H.264 can hold it (a 4:4:4 MOV stays 4:4:4),
 *   else 4:2:0, and its colour tags;
 * - every frame as it reaches the encoder (`-fps_mode passthrough`): none
 *   dropped, duplicated or retimed;
 * - a visually lossless constant quality (`MATCHED_FALLBACK_CRF`) only when
 *   the probe cannot read the bitrate.
 *
 * The reference-video re-encode (`providers/kie/reference-video-reencode.ts`)
 * runs its copies through it, with the provider's size limit on top.
 */
import { runFfprobe } from "./ffmpeg-utils.js"
import { constantFrameRate, parseFrameRate } from "./frame-rate.js"

/** The constant quality the picture is encoded at when its bitrate is unknown (visually lossless). */
export const MATCHED_FALLBACK_CRF = "14"

/** Pixel formats an 8-bit libx264 keeps as they are; any other is encoded as yuv420p. */
const KEPT_PIX_FMTS = new Set(["yuv420p", "yuv422p", "yuv444p"])

/** What the probe read of a local clip (`probeMatched`). Absent = not reported. */
export interface MatchedProbe {
  width?: number
  height?: number
  /** The picture's codec as ffprobe names it ("h264", "hevc", "vp9", "av1", "prores"…). */
  videoCodec?: string
  pixFmt?: string
  /** Bits per second of the picture alone. */
  videoBitRate?: number
  /** Bits per second of the sound (every track). */
  audioBitRate?: number
  /** The first sound track's codec. */
  audioCodec?: string
  /** The container's length (it can run past the picture: the sound's overhang). */
  durationSec?: number
  /** The picture stream's own length; absent when the stream states none (a Matroska/WebM stream). */
  videoDurationSec?: number
  /** Where the picture stream starts (`start_time`, seconds; zero or below too); absent when unread. */
  videoStartSec?: number
  /** Where the first sound track starts, the same way. With `videoStartSec`, how far apart they begin. */
  audioStartSec?: number
  /**
   * The picture's constant frame rate (`constantFrameRate`) exactly as ffprobe
   * reported it ("30000/1001"): the average whenever it reads, else the nominal
   * rate. Absent when it has none (a variable frame rate) or reports none.
   */
  fpsRational?: string
  /**
   * The picture's nominal rate (`r_frame_rate`) exactly as ffprobe reported it,
   * whenever it parses, apart from `fpsRational` (the average when it reads):
   * the grid a clip whose average is off it (a millisecond timescale, a phone
   * clip that slows) was shot on.
   */
  nominalFpsRational?: string
  /** The file is QuickTime (major brand `qt`), not MP4. */
  quickTime?: boolean
  colorSpace?: string
  colorPrimaries?: string
  colorTransfer?: string
  colorRange?: string
}

/**
 * The bitrate the picture is encoded at: `targetBitRate`, else the probe's
 * own, in whole bits per second; undefined when neither is a positive one
 * (the constant-quality fallback).
 */
function matchedBitRate(probe: MatchedProbe, opts: { targetBitRate?: number }): number | undefined {
  const v = opts.targetBitRate ?? probe.videoBitRate
  const r = v === undefined ? Number.NaN : Math.round(v)
  return r > 0 ? r : undefined
}

/**
 * Whether `matchedPictureArgs(probe, opts)` encodes at a bitrate, and so
 * takes two passes when the caller runs them, rather than at the
 * constant-quality fallback (one pass). The same rule the arguments follow.
 */
export function matchedHasBitRate(probe: MatchedProbe, opts: { targetBitRate?: number } = {}): boolean {
  return matchedBitRate(probe, opts) !== undefined
}

/**
 * The picture encode, as the module header sets out. `targetBitRate`: the
 * bitrate to encode at, when it is not the probe's own (a size limit brought
 * it down); `maxBitRate`: a ceiling for the constant-quality fallback; `pass`:
 * one of two passes, which share `log` (only with a bitrate, as
 * `matchedHasBitRate` tells; a constant quality is one pass).
 */
export function matchedPictureArgs(
  probe: MatchedProbe,
  opts: { targetBitRate?: number; maxBitRate?: number; pass?: { n: 1 | 2; log: string } } = {},
): string[] {
  const pix = probe.pixFmt === "yuvj420p" ? "yuv420p" : probe.pixFmt
  const pixFmt = pix && KEPT_PIX_FMTS.has(pix) ? pix : "yuv420p"
  const tag = (flag: string, v: string | undefined) => (v && v !== "unknown" ? [flag, v] : [])
  const rate = matchedBitRate(probe, opts)
  const max = opts.maxBitRate
  const { pass } = opts
  const quality = rate !== undefined
    ? ["-b:v", String(rate), ...(pass ? ["-pass", String(pass.n), "-passlogfile", pass.log] : [])]
    : ["-crf", MATCHED_FALLBACK_CRF, ...(max !== undefined ? ["-maxrate", String(max), "-bufsize", String(max * 2)] : [])]
  return [
    // Every frame as it is: no frame dropped, duplicated or retimed.
    "-fps_mode", "passthrough",
    "-c:v", "libx264",
    "-preset", "medium",
    ...quality,
    "-pix_fmt", pixFmt,
    ...tag("-colorspace", probe.colorSpace),
    ...tag("-color_primaries", probe.colorPrimaries),
    ...tag("-color_trc", probe.colorTransfer),
    ...tag("-color_range", probe.colorRange),
  ]
}

const num = (v: unknown): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}
const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)
/** A stream's `start_time`: any finite number of seconds, zero and below included. */
const startOf = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN
  return Number.isFinite(n) ? n : undefined
}

/**
 * Read ffprobe's JSON (`probeMatched`'s arguments). The picture's bitrate is
 * the stream's own, else the container's less the sound's (a stream in some
 * containers reports none). Never throws: what it cannot read is left out,
 * and nothing is read without a picture stream.
 */
export function parseMatchedProbe(json: string): MatchedProbe {
  let parsed: { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> }
  try {
    parsed = JSON.parse(json) as typeof parsed
  } catch {
    return {}
  }
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : []
  const v = streams.find((s) => s.codec_type === "video")
  if (!v) return {}
  const audio = streams.filter((s) => s.codec_type === "audio")
  const audioBitRate = audio.reduce((n, a) => n + (num(a.bit_rate) ?? 0), 0) || undefined
  const audioCodec = text(audio[0]?.codec_name)
  const formatRate = num(parsed.format?.bit_rate)
  const videoBitRate = num(v.bit_rate) ?? (formatRate && formatRate > (audioBitRate ?? 0) ? formatRate - (audioBitRate ?? 0) : undefined)
  const brand = text((parsed.format?.tags as Record<string, unknown> | undefined)?.major_brand)?.trim()
  const width = num(v.width)
  const height = num(v.height)
  const durationSec = num(parsed.format?.duration)
  const videoDurationSec = num(v.duration)
  const videoStartSec = startOf(v.start_time)
  const audioStartSec = startOf(audio[0]?.start_time)
  const avg = parseFrameRate(v.avg_frame_rate)
  const fps = constantFrameRate(avg, parseFrameRate(v.r_frame_rate))
  // `constantFrameRate` answers with the average whenever it reads, else the nominal rate.
  const fpsRational = fps !== undefined ? text(avg !== undefined ? v.avg_frame_rate : v.r_frame_rate)?.trim() : undefined
  const nominalFpsRational = parseFrameRate(v.r_frame_rate) !== undefined ? text(v.r_frame_rate)?.trim() : undefined
  return {
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(text(v.codec_name) ? { videoCodec: text(v.codec_name) } : {}),
    ...(text(v.pix_fmt) ? { pixFmt: text(v.pix_fmt) } : {}),
    ...(videoBitRate ? { videoBitRate } : {}),
    ...(audioBitRate ? { audioBitRate } : {}),
    ...(audioCodec ? { audioCodec } : {}),
    ...(durationSec ? { durationSec } : {}),
    ...(videoDurationSec ? { videoDurationSec } : {}),
    ...(videoStartSec !== undefined ? { videoStartSec } : {}),
    ...(audioStartSec !== undefined ? { audioStartSec } : {}),
    ...(fps && fpsRational ? { fpsRational } : {}),
    ...(nominalFpsRational ? { nominalFpsRational } : {}),
    ...(brand !== undefined ? { quickTime: brand === "qt" } : {}),
    ...(text(v.color_space) ? { colorSpace: text(v.color_space) } : {}),
    ...(text(v.color_primaries) ? { colorPrimaries: text(v.color_primaries) } : {}),
    ...(text(v.color_transfer) ? { colorTransfer: text(v.color_transfer) } : {}),
    ...(text(v.color_range) ? { colorRange: text(v.color_range) } : {}),
  }
}

/**
 * Probe the local `file`, throwing ffprobe's own failure as it is (a timeout
 * keeps its `timedOut` flag): for a caller that must tell a probe that failed
 * from a file with no picture (`extensionPictureSeconds`). `probeMatched`
 * reads the same.
 */
export async function probeMatchedOrThrow(file: string): Promise<MatchedProbe> {
  return parseMatchedProbe(await runFfprobe([
    "-v", "error",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,pix_fmt,bit_rate,r_frame_rate,avg_frame_rate,duration,start_time,color_space,color_primaries,color_transfer,color_range:format=bit_rate,duration:format_tags=major_brand",
    "-of", "json",
    file,
  ]))
}

/** Probe the local `file`. Never throws: an unreadable probe is an empty one (constant quality). */
export async function probeMatched(file: string): Promise<MatchedProbe> {
  try {
    return await probeMatchedOrThrow(file)
  } catch {
    return {}
  }
}
