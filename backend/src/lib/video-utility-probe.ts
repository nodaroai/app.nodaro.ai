import { parseMatroskaDurationTag, readProbeSource, scanPacketEnds, type GuardedProbe, type ProbeSourceOptions } from "../providers/video/ffmpeg-utils.js"
import { parseFrameRate } from "../providers/video/frame-rate.js"
import { videoTrackLengthFrom, videoTrackPricedSec } from "./video-track-length.js"

/** A DURATION tag as the header the track reading takes. */
const tagOf = (value: unknown): { readonly tagSec?: number } => {
  const tagSec = parseMatroskaDurationTag(value)
  return tagSec !== undefined ? { tagSec } : {}
}

/**
 * How long a clip given to Trim Video, Loop Video or Combine Videos is: the
 * one reading the charge measures a clip by before it reserves and the
 * render's check re-measures the downloaded file by, so the two can never
 * read a file differently.
 *
 * The length is the one the node's worker reads (`videoUtilityClipReading`):
 * Trim and Loop the container's (ffprobe's `format.duration`), else the video
 * stream's; Combine Videos the video stream's, else the container's — it
 * joins clips at their video streams' ends, which the container can overshoot
 * by the sound a generated clip carries past its last frame.
 *
 * A file whose header carries no length at all (a WebM a browser recorded, or
 * one written to a pipe) is read from its packets by `scanPacketEnds`, the
 * streamed scan the render's own window check reads: the end of the latest
 * video packet (its timestamp plus its duration; a stream with no timestamps
 * on any packet by its decode times), packets the demuxer discards left out,
 * less the file's start time. Demuxed, never decoded, and streamed line by
 * line, so a recording of any length is read: only time bounds it
 * (`packetTimeoutMs`). Without it, such a file would be refused, though
 * Trim's time mode, Loop's repeat and Combine Videos render it.
 *
 * The same header read gives the video stream's frame rate (`r_frame_rate`,
 * parsed as the Trim and Combine Videos workers parse it — `parseFrameRate`),
 * the rate a frame trim is cut at (decided 2026-11-14); a rate that cannot be
 * read is left unknown ({@link ClipReading}).
 */

/** Which of a clip's header lengths a node's worker reads first (the other is the fallback). */
export type ClipLengthReading = "container" | "video-stream"

/** A clip with no video stream, or no length any reading can find: never charged, never rendered. */
export class ClipUnreadableError extends Error {
  constructor(reason: string) {
    super(`clip unreadable: ${reason}`)
    this.name = "ClipUnreadableError"
  }
}

const positiveSec = (v: unknown): number | undefined => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : Number.NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

const finiteSec = (v: unknown): number | undefined => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : Number.NaN
  return Number.isFinite(n) ? n : undefined
}

/** A pass's time: its own bound, cut to what is left of the deadline; a deadline already past fails as timed out. */
function withinDeadline(boundMs: number | undefined, deadlineAt: number | undefined): number | undefined {
  if (deadlineAt === undefined) return boundMs
  const left = deadlineAt - Date.now()
  if (left <= 0) throw Object.assign(new Error("clip reading: out of time"), { timedOut: true })
  return boundMs === undefined ? left : Math.min(boundMs, left)
}

export interface ClipLengthOptions {
  /** How long the header read may take (default ffprobe's own ceiling). */
  readonly timeoutMs?: number
  /** How long the packet scan of a file with no length in its header may take (default the scan's own ceiling). */
  readonly packetTimeoutMs?: number
  /** Which header length to read first (default the container's). */
  readonly reading?: ClipLengthReading
  /**
   * When the whole reading must end (epoch ms): each pass gets at most what is
   * left of it, and a pass with nothing left fails at once as timed out.
   */
  readonly deadlineAt?: number
  /** Stop reading when this aborts (a request whose client went away). */
  readonly signal?: AbortSignal
  /** The caller already passed `src` through `assertSafeProbeSource` and it was allowed (one DNS lookup, not two). */
  readonly sourceChecked?: boolean
  /** `src` is a local copy of a user's file (the own-storage fallback): read with the container rule a link gets. */
  readonly userFile?: boolean
}

/** What one read of a clip gives: its length, and its video stream's frame rate when it has a readable one. */
export interface ClipReading {
  readonly sec: number
  readonly fps?: number
}

/** A clip's length in seconds ({@link probeClipReading}'s, without its rate). */
export async function probeClipLengthSec(src: string, opts: ClipLengthOptions = {}): Promise<number> {
  return (await probeClipReading(src, opts)).sec
}

/**
 * A clip's length in seconds (see the module note), read first from the
 * container or the video stream (`reading`, default the container), and its
 * video stream's frame rate when it has a readable one. `src` is
 * a local path or an http(s) link, read through the probe guard
 * (`readProbeSource`): a link must pass the link guard, which throws first —
 * unless the caller already checked it (`sourceChecked`) — and every hop
 * ffprobe makes is checked again; a file of this install's own storage the
 * guard refuses by its address is read from a capped download. A read that
 * timed out rejects with `timedOut: true` (retryable), one stopped by
 * `signal` with `aborted: true`; a clip with no video stream or no readable
 * length rejects with {@link ClipUnreadableError}; a file ffprobe cannot open
 * at all rejects with ffprobe's error.
 */
export async function probeClipReading(src: string, opts: ClipLengthOptions = {}): Promise<ClipReading> {
  return readProbeSource(src, (input, probe) => readStream(input, probe, opts, "video"), probeSourceOptions(opts))
}

/**
 * A recording's SOUND length in seconds, by the same reading
 * {@link probeClipLengthSec} gives a video: the container's length, else the
 * first audio stream's, and for a file whose header carries neither (a WebM or
 * an Ogg a browser recorded) the end of that stream's last packet, from the
 * streamed packet scan — under the same guard and the same bounds
 * (`timeoutMs`, `packetTimeoutMs`, `deadlineAt`, `signal`). A file with no
 * audio stream, or no length any reading finds, rejects with
 * {@link ClipUnreadableError}.
 */
export async function probeSoundLengthSec(src: string, opts: Omit<ClipLengthOptions, "reading"> = {}): Promise<number> {
  return readProbeSource(src, async (input, probe) => (await readStream(input, probe, opts, "audio")).sec, probeSourceOptions(opts))
}

function probeSourceOptions(opts: ClipLengthOptions): ProbeSourceOptions {
  return {
    ...(opts.sourceChecked ? { sourceChecked: true } : {}),
    ...(opts.userFile ? { userFile: true } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.deadlineAt !== undefined ? { downloadTimeoutMs: opts.deadlineAt - Date.now() } : {}),
  }
}

/** One stream's length (and, for a video stream, its frame rate) from the header, else from its packets. */
async function readStream(src: string, probe: GuardedProbe, opts: ClipLengthOptions, kind: "video" | "audio"): Promise<ClipReading> {
  const headerMs = withinDeadline(opts.timeoutMs, opts.deadlineAt)
  // A video stream's frame rate rides the same header read (`r_frame_rate`); a sound has none.
  const streamEntries = kind === "video" ? "stream=index,codec_type,duration,r_frame_rate" : "stream=index,codec_type,duration"
  // The video stream's reading also asks for its DURATION tag: a Matroska / WebM file states its picture's length only there.
  const tagEntries = kind === "video" && opts.reading === "video-stream" ? ":stream_tags=DURATION" : ""
  const out = await probe.run(
    ["-v", "error", ...probe.inputArgs, "-select_streams", kind === "video" ? "v:0" : "a:0", "-show_entries", `${streamEntries}${tagEntries}:format=duration,start_time`, "-of", "json", src],
    { ...(headerMs !== undefined ? { timeoutMs: headerMs } : {}), ...(opts.signal ? { signal: opts.signal } : {}) },
  ).catch((err: unknown) => {
    throw opts.signal?.aborted ? Object.assign(new Error("clip reading aborted"), { aborted: true }) : err
  })
  let header: { streams?: Array<{ index?: unknown; duration?: unknown; r_frame_rate?: unknown; tags?: { DURATION?: unknown } }>; format?: { duration?: unknown; start_time?: unknown } }
  try {
    header = JSON.parse(out)
  } catch {
    throw new ClipUnreadableError("unparseable probe")
  }
  const stream = Array.isArray(header.streams) ? header.streams[0] : undefined
  if (!stream) throw new ClipUnreadableError(kind === "video" ? "no video stream" : "no audio stream")
  const fps = kind === "video" ? parseFrameRate(stream.r_frame_rate) : undefined
  const withRate = (length: number): ClipReading => (fps === undefined ? { sec: length } : { sec: length, fps })
  const container = positiveSec(header.format?.duration)
  const streamSec = positiveSec(stream.duration)
  if (opts.reading === "video-stream" && container !== undefined) {
    // The picture's own length: the stream's, its tag, its packets — only when all fail, the container less the
    // fallback's allowance (`videoTrackLengthFrom`). A file with no length anywhere is scanned below, as before.
    const index = typeof stream.index === "number" && Number.isInteger(stream.index) ? stream.index : undefined
    const track = await videoTrackLengthFrom(
      { ...(streamSec !== undefined ? { streamSec } : {}), ...tagOf(stream.tags?.DURATION), ...(index !== undefined ? { streamIndex: index } : {}), startTimeSec: finiteSec(header.format?.start_time) ?? 0, containerSec: container },
      (i) => {
        const packetMs = withinDeadline(opts.packetTimeoutMs, opts.deadlineAt)
        return scanPacketEnds(src, i, { probe, ...(packetMs !== undefined ? { timeoutMs: packetMs } : {}), ...(opts.signal ? { signal: opts.signal } : {}) })
      },
      opts.signal,
    )
    if (track) return withRate(videoTrackPricedSec(track))
  }
  const sec = opts.reading === "video-stream" ? (streamSec ?? container) : (container ?? streamSec)
  if (sec !== undefined) return withRate(sec)
  if (typeof stream.index !== "number" || !Number.isInteger(stream.index)) throw new ClipUnreadableError("no stream index")
  const packetMs = withinDeadline(opts.packetTimeoutMs, opts.deadlineAt)
  const { maxPtsEnd, maxDtsEnd } = await scanPacketEnds(src, stream.index, {
    probe,
    ...(packetMs !== undefined ? { timeoutMs: packetMs } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
  const end = maxPtsEnd ?? maxDtsEnd
  const length = end === undefined ? undefined : end - (finiteSec(header.format?.start_time) ?? 0)
  if (length === undefined || !(length > 0)) throw new ClipUnreadableError("no length")
  return withRate(length)
}
