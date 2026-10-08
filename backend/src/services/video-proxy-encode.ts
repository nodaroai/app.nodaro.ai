/**
 * The VIDEO proxy's encode (P3.2): a local source file in, a picture-only,
 * display-oriented, square-pixel H.264 proxy out — and the span map that is
 * its clock (`media-proxy-span-map.ts`).
 *
 * HOW: one ffmpeg per span, each seeking on the INPUT side (`-ss`/`-t` before
 * `-i`), so a clip pack that keeps 8 minutes of a 90-minute episode decodes 8
 * minutes, not 90; then a stream-copy join. One encode per span is also what
 * makes the map honest — each segment's own frame count says exactly which
 * proxy frames came from which span, which a single joined timeline could not.
 *
 * The sample grid: ffmpeg rebases a segment's timestamps to its `-ss` point,
 * so `fps=…:round=up` samples on multiples of 1 / fps from the span's start
 * and each sample shows the source frame ON SCREEN then (the last one that
 * started at or before it) — a VFR hole shows the frame before it, at the time
 * the map says. Measured on real ffmpeg: within one source frame of the map,
 * where the default `round=near` sat half a sample late.
 *
 * The first sample is the first grid point at or after the first frame the
 * seek DECODES — no `start_time=0`, which back-fills every grid point before
 * that frame with copies of it: an MPEG-TS seek that lands on a keyframe
 * 0.9 s late, a span starting inside a VFR hole, or a picture that starts
 * after the container's zero would each label a later picture with earlier
 * source times. The cost: a span whose start falls between source frames (the
 * frame on screen at the start sits just before it, and the seek drops it)
 * samples from start + one period.
 *
 * The output is clipped to the span with `trim` (half-open, `[start, end)`):
 * the input `-t` bounds only the READ, and the fps filter holds a last frame
 * across a VFR hole that follows the span, or past a late seek landing — so
 * without it a row ran past its span and overlapped the next one.
 *
 * Every launch goes through `runFfmpeg`: the FIFO slots, the memory admission
 * (#1860) with a real prediction — the decode of the SOURCE canvas dominates,
 * not the small output — and the CPU-quota thread counts the launcher places
 * (#1841), which is why no argv here names its own.
 */
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { probeVideoFramePtsMs as framePtsMs, runFfmpeg, runFfprobe } from "../providers/video/ffmpeg-utils.js"
import {
  MEDIA_PROXY_FFMPEG_TIMEOUT_MS,
  proxySpanEncodeTimeoutMs,
  proxySpanProbeTimeoutMs,
} from "../providers/video/ffmpeg-timeouts.js"
import { audioPeakMemoryMiB, canvasPeakMemoryMiB } from "../providers/video/ffmpeg-memory-model.js"
import { ffmpegEffectiveThreads } from "../providers/video/ffmpeg-threads.js"
import { DeterministicJobError } from "../lib/deterministic-job-error.js"
import { buildSpanMap, type EncodedProxySegment, type ProxySpan, type ProxySpanMap } from "./media-proxy-span-map.js"

/** A VIDEO proxy was asked of a source with no picture (an audio-only file).
 *  Deterministic: a retry re-downloads the same file to the same answer. */
export class MediaHasNoVideoError extends DeterministicJobError {
  constructor() {
    super("the source has no video track")
    this.name = "MediaHasNoVideoError"
  }
}

export interface VideoProxyEncodeOptions {
  readonly fps: number
  /** Output height in px (even). A shorter source keeps its own height: never upscaled. */
  readonly height: number
  /** Normalized spans (`normalizeProxySpans`); undefined = the whole source. */
  readonly spans?: readonly ProxySpan[]
  /** Per-spawn ffmpeg timeout, overriding every spawn's own: a span's encode is
   *  otherwise bounded by its length (`proxySpanEncodeTimeoutMs`), the whole
   *  source and the join by `MEDIA_PROXY_FFMPEG_TIMEOUT_MS`. */
  readonly timeoutMs?: number
}

export interface EncodedVideoProxy {
  readonly outPath: string
  readonly spanMap: ProxySpanMap
  /** The proxy's frame, display-oriented with square pixels: what box fractions refer to. */
  readonly frame: { readonly w: number; readonly h: number }
  readonly frameCount: number
}

/** Same picture recipe for every segment, so the stream-copy join is valid. */
const ENCODE = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p"] as const

/** The source's picture size (the decode canvas the memory admission is
 *  predicted from). No length: a container's duration can be wrong, so the
 *  encode reads to the picture's real end and a span past it writes nothing. */
async function probeSource(src: string): Promise<{ width: number; height: number }> {
  const out = await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", src])
  const stream = (JSON.parse(out) as { streams?: Array<{ width?: number; height?: number }> }).streams?.[0]
  if (!stream || !(Number(stream.width) > 0) || !(Number(stream.height) > 0)) throw new MediaHasNoVideoError()
  return { width: Number(stream.width), height: Number(stream.height) }
}

async function frameSize(file: string): Promise<{ w: number; h: number }> {
  const out = await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", file])
  const s = (JSON.parse(out) as { streams?: Array<{ width?: number; height?: number }> }).streams?.[0]
  return { w: Number(s?.width ?? 0), h: Number(s?.height ?? 0) }
}

const seconds = (ms: number) => (ms / 1000).toFixed(3)

/** The picture chain: sample (clipped to the span, when there is one), square
 *  the pixels at the display aspect (rotation is already applied by ffmpeg's
 *  autorotate), then scale down — never up. */
function pictureFilter(fps: number, height: number, span: ProxySpan | undefined): string {
  return [
    `fps=fps=${fps}:round=up`,
    ...(span ? [`trim=end=${seconds(span.endMs - span.startMs)}`] : []),
    "scale=trunc(iw*sar/2)*2:ih",
    "setsar=1",
    `scale=-2:'min(${height},trunc(ih/2)*2)'`,
    "setsar=1",
  ].join(",")
}

/** The input-side cut: a seek and a length, or nothing for the whole source
 *  (read to the picture's real end). A span past that end writes no frames. */
const cutArgs = (span: ProxySpan | undefined): string[] =>
  span ? ["-ss", seconds(span.startMs), "-t", seconds(span.endMs - span.startMs)] : []

export async function encodeVideoProxy(src: string, workDir: string, opts: VideoProxyEncodeOptions): Promise<EncodedVideoProxy> {
  const source = await probeSource(src)
  const spans: ReadonlyArray<ProxySpan | undefined> = opts.spans ?? [undefined]

  const timeoutMs = opts.timeoutMs ?? MEDIA_PROXY_FFMPEG_TIMEOUT_MS
  const encodePeak = canvasPeakMemoryMiB({ width: source.width, height: source.height }, 1, ffmpegEffectiveThreads())

  const segments: Array<EncodedProxySegment & { readonly path: string }> = []
  for (const [i, span] of spans.entries()) {
    const path = join(workDir, `seg-${String(i).padStart(4, "0")}.mp4`)
    // A span is bounded by its own length; the whole source (length unknown) by the proxy's ceiling.
    const spanMs = span ? span.endMs - span.startMs : undefined
    await runFfmpeg(
      ["-y", ...cutArgs(span), "-i", src, "-an", "-vf", pictureFilter(opts.fps, opts.height, span), ...ENCODE, path],
      opts.timeoutMs ?? (spanMs === undefined ? timeoutMs : proxySpanEncodeTimeoutMs(spanMs)),
      { peakMemoryMiB: encodePeak },
    )
    const pts = spanMs === undefined ? await framePtsMs(path) : await framePtsMs(path, proxySpanProbeTimeoutMs(spanMs))
    segments.push({ path, seekMs: span?.startMs ?? 0, framePtsMs: pts })
  }

  const written = segments.filter((s) => s.framePtsMs.length > 0)
  if (written.length === 0) throw new DeterministicJobError("the requested spans hold no video frames (all past the picture's end?)")

  const list = join(workDir, "segments.txt")
  await fs.writeFile(list, written.map((s) => `file '${s.path}'\n`).join(""))
  const outPath = join(workDir, "proxy.mp4")
  // A stream copy decodes and encodes no picture: the model's fixed term.
  await runFfmpeg(
    ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", outPath],
    timeoutMs,
    { peakMemoryMiB: audioPeakMemoryMiB() },
  )

  const spanMap = buildSpanMap(written, await framePtsMs(outPath), opts.fps)
  const frameCount = spanMap.reduce((n, r) => n + r.frameCount, 0)
  return { outPath, spanMap, frame: await frameSize(outPath), frameCount }
}
