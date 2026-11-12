/**
 * The length a caller's audio file STATES for its first audio track (decided
 * 2026-11-12) — read only to REFUSE a decode that comes up clearly short of it,
 * never to price: the price is always the decoded samples
 * (`decoded-audio-length.ts`). A file that states less than it plays is priced
 * on what it plays; one that states more than it decodes is refused, and a
 * refusal holds nothing. So a crafted header can only get its own file refused.
 *
 * Only containers whose stated length is EXACT — a sample count or a duration
 * the muxer writes from the samples it wrote — and only when ffmpeg did not
 * estimate it from the bitrate ("Estimating duration from bitrate" on stderr:
 * a stream-written or cut-off WAV, Wave64 or CAF, whose size field ffmpeg
 * replaces with the file's real size). Left out, as estimates: raw MP3 / ADTS
 * / AC-3 / DTS / LATM / AMR (a bitrate guess, or an MP3 Info header that
 * editing tools can leave stale), MPEG-TS and MPEG-PS (first and last
 * timestamps), AVI (often estimated), FLV (a metadata field any tool may
 * leave wrong).
 *
 * How each format's figure becomes the first audio track's length (decided
 * 2026-11-12):
 *  - Matroska/WebM: its Duration and per-track DURATION tag are END times, so
 *    the track's start is taken off (audio that starts 1 s in states 9 s and
 *    plays 8). A stream `duration` is never Matroska's own: ffprobe copies the
 *    file's in, start reset to 0, when its analysis reached none of the
 *    track's packets (audio starting 5 s or more after the video) — then the
 *    track's start and length are unknown, unless it is the file's only
 *    stream. And only a file its muxer FINISHED (its SeekHead names a Cues
 *    index, `matroska-index.ts`): a live recording, even one an app later
 *    gave a Duration, states no length its audio had.
 *  - ASF (WMA/WMV): every stream states the file's play time, so only the
 *    file's only stream can use it (audio shorter than its video, or late).
 *  - Ogg: the duration is the last granule's time — an end time for Opus and
 *    FLAC — so a positive start is taken off (a capture that began
 *    mid-stream), and Opus's pre-skip (`initial_padding`, 48 kHz samples) too,
 *    which the granule counts and the decoder drops. A Vorbis duration is
 *    already a span, so its start is taken off twice: harmless, it only
 *    understates. FLAC-in-Ogg that starts mid-stream reports a start of 0, so
 *    it states its end time and is refused (no sound way found to read it).
 *  - Everything else states a span. A track with no length of its own uses
 *    the file's only when it is the file's only stream — a video track can
 *    run longer than the audio.
 *
 * Read like the decode reads (the same protocol and container whitelist).
 */
import { runFfprobeCapture } from "./ffmpeg-utils.js"
import { matroskaNamesItsIndex } from "./matroska-index.js"

/** The demuxers (ffmpeg names) whose stated length is exact. */
export const DECLARED_LENGTH_FORMATS: ReadonlySet<string> = new Set([
  "matroska", "mov", "ogg", "flac", "wav", "w64", "aiff", "caf", "au", "wv", "tta", "ape", "mpc", "mpc8", "asf",
])

/**
 * …of those, the ones whose stated length is the WHOLE file's. Not Ogg: a
 * chained Ogg states only its last link's length, so a decode that stopped
 * after an earlier link can match it.
 */
export const WHOLE_FILE_LENGTH_FORMATS: ReadonlySet<string> = new Set([...DECLARED_LENGTH_FORMATS].filter((f) => f !== "ogg"))

/**
 * How much shorter than its stated length a decode may come up and still be
 * whole (decided 2026-11-12): encoder delay and padding, a codec's pre-skip, a
 * last frame's rounding. Measured on honest files of every format above, from
 * 0.1 s to 299 s: at most 0.075 s (WMA audio in a WMV), constant with length.
 */
export const DECLARED_LENGTH_TOLERANCE_SEC = 0.5

/** A probe reads headers and, for some formats, the file's last pages: seconds at most. */
const PROBE_TIMEOUT_MS = 30_000

export interface DeclaredAudioLength {
  /** The demuxer that read the file (ffmpeg's first name for it: "matroska", "mov", "aac"…). */
  readonly format: string
  /** The first audio track's exact stated length, in seconds; absent when the format states none exactly. */
  readonly seconds?: number
}

interface ProbeJson {
  readonly format?: { readonly format_name?: string; readonly duration?: string; readonly start_time?: string }
  readonly streams?: ReadonlyArray<{
    readonly codec_type?: string
    readonly codec_name?: string
    readonly initial_padding?: number | string
    readonly duration?: string
    readonly start_time?: string
    readonly tags?: Readonly<Record<string, string>>
  }>
}

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v === "N/A") return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** "HH:MM:SS.fraction" (Matroska's DURATION tag) in seconds. */
const clock = (v: string | undefined): number | undefined => {
  const m = v === undefined ? null : /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(v)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined
}

/** The ffprobe arguments: the format, and each stream's type, codec, pre-skip, length, start and DURATION tag. */
export function declaredLengthArgs(path: string, inputArgs: readonly string[]): string[] {
  return [
    "-v", "warning",
    ...inputArgs,
    "-show_entries",
    "format=format_name,duration,start_time:stream=codec_type,codec_name,initial_padding,duration,start_time:stream_tags=DURATION",
    "-of", "json",
    path,
  ]
}

const OPUS_RATE_HZ = 48_000

/** What `declaredLengthArgs`' probe says (see the module doc). Undefined when it is not ffprobe's JSON. */
export function parseDeclaredLength(stdout: string, stderr: string): DeclaredAudioLength | undefined {
  let j: ProbeJson
  try {
    j = JSON.parse(stdout) as ProbeJson
  } catch {
    return undefined
  }
  const format = (j.format?.format_name ?? "").split(",")[0] ?? ""
  if (!DECLARED_LENGTH_FORMATS.has(format) || /Estimating duration from bitrate/.test(stderr)) return { format }
  const streams = j.streams ?? []
  const audio = streams.find((s) => s.codec_type === "audio")
  if (!audio) return { format }
  const only = streams.length === 1
  /** An end time less a positive start: the span from where the track starts. */
  const span = (end: number | undefined, start: string | undefined) =>
    end === undefined ? undefined : end - Math.max(0, num(start) ?? 0)
  let seconds: number | undefined
  if (format === "matroska") {
    // A stream duration is ffprobe's copy of the file's (start reset): nothing is known of the track.
    if (num(audio.duration) !== undefined && !only) return { format }
    seconds = span(clock(audio.tags?.DURATION), audio.start_time) ?? (only ? span(num(j.format?.duration), j.format?.start_time) : undefined)
  } else if (format === "asf") {
    // Every stream states the file's play time.
    seconds = only ? num(audio.duration) : undefined
  } else if (format === "ogg") {
    seconds = span(num(audio.duration), audio.start_time)
    const preSkip = Number(audio.initial_padding ?? 0)
    if (seconds !== undefined && audio.codec_name === "opus" && Number.isFinite(preSkip)) seconds -= preSkip / OPUS_RATE_HZ
  } else {
    seconds = num(audio.duration) ?? (only ? num(j.format?.duration) : undefined)
  }
  return seconds !== undefined && seconds > 0 ? { format, seconds } : { format }
}

/**
 * The stated length of `path`'s first audio track, read through `inputArgs`
 * (the decode's own whitelist) — a Matroska file's only when its muxer
 * finished it (`matroskaNamesItsIndex`). Undefined when ffprobe cannot read
 * the file — the decode's other checks still apply; a probe that was STOPPED
 * (its time limit) rejects as it is, so a worker retries it.
 */
export async function probeDeclaredAudioLength(path: string, inputArgs: readonly string[]): Promise<DeclaredAudioLength | undefined> {
  let declared: DeclaredAudioLength | undefined
  try {
    const { stdout, stderr } = await runFfprobeCapture(declaredLengthArgs(path, inputArgs), { timeoutMs: PROBE_TIMEOUT_MS })
    declared = parseDeclaredLength(stdout, stderr)
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { killed?: unknown }).killed === true) throw err
    return undefined
  }
  if (declared?.format === "matroska" && declared.seconds !== undefined && !(await matroskaNamesItsIndex(path))) return { format: declared.format }
  return declared
}
