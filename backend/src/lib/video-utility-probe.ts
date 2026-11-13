import { assertSafeProbeSource, runFfprobe, scanPacketEnds } from "../providers/video/ffmpeg-utils.js"

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
 */

/** Which of a clip's header lengths a node's worker reads first (the other is the fallback). */
export type ClipLengthReading = "container" | "video-stream"

/** The transports a probe may open: a file, or an http(s) link — never a pivot to another protocol. */
const PROBE_PROTOCOLS = "file,http,https,tcp,tls"

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
  /** The caller already passed `src` through `assertSafeProbeSource` (one DNS lookup, not two). */
  readonly sourceChecked?: boolean
}

/**
 * A clip's length in seconds (see the module note), read first from the
 * container or the video stream (`reading`, default the container). `src` is
 * a local path or an http(s) link; a link must pass the probe's link guard
 * (`assertSafeProbeSource`), which throws first — unless the caller already
 * checked it (`sourceChecked`). A read that timed out
 * rejects with `timedOut: true` (retryable), one stopped by `signal` with
 * `aborted: true`; a clip with no video stream or no readable length rejects
 * with {@link ClipUnreadableError}; a file ffprobe cannot open at all rejects
 * with ffprobe's error.
 */
export async function probeClipLengthSec(src: string, opts: ClipLengthOptions = {}): Promise<number> {
  if (!opts.sourceChecked) await assertSafeProbeSource(src)
  const headerMs = withinDeadline(opts.timeoutMs, opts.deadlineAt)
  const out = await runFfprobe(
    ["-v", "error", "-protocol_whitelist", PROBE_PROTOCOLS, "-select_streams", "v:0", "-show_entries", "stream=index,codec_type,duration:format=duration,start_time", "-of", "json", src],
    { ...(headerMs !== undefined ? { timeoutMs: headerMs } : {}), ...(opts.signal ? { signal: opts.signal } : {}) },
  ).catch((err: unknown) => {
    throw opts.signal?.aborted ? Object.assign(new Error("clip reading aborted"), { aborted: true }) : err
  })
  let header: { streams?: Array<{ index?: unknown; duration?: unknown }>; format?: { duration?: unknown; start_time?: unknown } }
  try {
    header = JSON.parse(out)
  } catch {
    throw new ClipUnreadableError("unparseable probe")
  }
  const stream = Array.isArray(header.streams) ? header.streams[0] : undefined
  if (!stream) throw new ClipUnreadableError("no video stream")
  const container = positiveSec(header.format?.duration)
  const streamSec = positiveSec(stream.duration)
  const sec = opts.reading === "video-stream" ? (streamSec ?? container) : (container ?? streamSec)
  if (sec !== undefined) return sec
  if (typeof stream.index !== "number" || !Number.isInteger(stream.index)) throw new ClipUnreadableError("no stream index")
  const packetMs = withinDeadline(opts.packetTimeoutMs, opts.deadlineAt)
  const { maxPtsEnd, maxDtsEnd } = await scanPacketEnds(src, stream.index, {
    protocolWhitelist: PROBE_PROTOCOLS,
    ...(packetMs !== undefined ? { timeoutMs: packetMs } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
  const end = maxPtsEnd ?? maxDtsEnd
  const length = end === undefined ? undefined : end - (finiteSec(header.format?.start_time) ?? 0)
  if (length === undefined || !(length > 0)) throw new ClipUnreadableError("no length")
  return length
}
