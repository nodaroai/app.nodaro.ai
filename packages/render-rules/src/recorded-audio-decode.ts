/**
 * How far past the length its upload recorded a recording's sound can decode
 * (decided 2026-11-14). An upload records its file's CONTAINER length
 * (ffprobe's format duration); an AAC track decodes in whole frames of
 * {@link AAC_FRAME_SAMPLES} samples, so it plays up to one frame past that —
 * measured on the production-pinned ffmpeg 8.1.2: an M4A whose container reads
 * 5.000 s decodes to 5.0155 s at 44.1 kHz, 5.0133 s at 48 kHz and 5.0347 s at
 * 24 kHz, and an MP4's AAC track the same. A WAV, and an MP3 whose header
 * states its length, decode to their record.
 *
 * Not bounded by this: a header-less VBR MP3, whose recorded length is
 * ffprobe's estimate from its bitrate (it can decode to minutes more), and a
 * raw ADTS `.aac`, which states no length either. Their quote reads the
 * record; the run charges what it decodes.
 *
 * Every Lip Sync model priced by its audio's length holds the DECODED audio,
 * so its quote reads a recording at the length plus this, less the 0.05 s each
 * hold forgives (`decodedAudioLength`, the measured walk): an AAC upload of
 * exactly 5 s at 16 kHz is quoted at the 6 s OmniHuman 2.0 charges, a 15 s one
 * at the 30 s tier a tiered model holds. Every other step reads the recorded
 * length.
 */

/** The samples in one AAC frame. */
export const AAC_FRAME_SAMPLES = 1024

/**
 * The lowest sampling rate an AAC stream has (7.35 kHz): a frame at it is the
 * longest, the one an AAC recording whose rate was not recorded is read with.
 */
export const AAC_LOWEST_SAMPLE_RATE_HZ = 7350

/** The audio recordings, whose upload records the SOUND's codec and rate (`metadata.codec`, `metadata.sampleRate`). */
const AUDIO_RECORDING_TYPES: ReadonlySet<string> = new Set(["upload-audio", "reference-audio"])

/** The video recordings: a recorded codec is the picture's, so the sound is read by its container. */
const VIDEO_RECORDING_TYPES: ReadonlySet<string> = new Set(["upload-video", "youtube-video"])

/** The containers an AAC track comes in: M4A, MP4 (and its QuickTime / M4V kin) and a raw AAC stream. */
const AAC_CONTAINER_EXTENSION = /\.(m4a|mp4|m4v|mov|aac)$/i
const AAC_CONTAINER_MIME = /^(audio\/(mp4|m4a|x-m4a|aac|aacp|x-aac)|video\/(mp4|quicktime|x-m4v))$/i

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined)

/** The path of a link (or a file name), without its query or fragment. */
function pathOf(ref: string): string {
  try {
    return new URL(ref).pathname
  } catch {
    return ref.split(/[?#]/)[0] ?? ref
  }
}

/**
 * Whether the recording's file is an AAC container: its file type when that
 * names an audio or video format, else the link (or name) it is stored under.
 */
function inAacContainer(data: Record<string, unknown>, meta: Record<string, unknown>): boolean {
  const mime = str(data.mimeType)
  if (mime !== undefined && AAC_CONTAINER_MIME.test(mime)) return true
  if (mime !== undefined && /^(audio|video)\//i.test(mime)) return false
  const ref = [meta.mediaUrl, data.url, data.r2Url, data.extractedAudioUrl, data.filename].map(str).find((r) => r !== undefined)
  return ref !== undefined && AAC_CONTAINER_EXTENSION.test(pathOf(ref))
}

/**
 * The seconds a recording's sound can decode past the length recorded for it:
 * one AAC frame (`1024 / sampleRate` — the recorded rate, else
 * {@link AAC_LOWEST_SAMPLE_RATE_HZ}) for an AAC recording — its recorded codec
 * is AAC, or, with no audio codec recorded, its file is an AAC container
 * (M4A, MP4, AAC) — and 0 for anything else (an MP3, a WAV, a codec recorded
 * as another, a container that is not one, a node that is no recording).
 */
export function recordingDecodeOverhangSec(origin: { readonly type?: string | null; readonly data?: unknown }): number {
  const type = origin.type ?? ""
  if (!AUDIO_RECORDING_TYPES.has(type) && !VIDEO_RECORDING_TYPES.has(type)) return 0
  const data = (origin.data ?? {}) as Record<string, unknown>
  const meta = (data.metadata && typeof data.metadata === "object" ? data.metadata : {}) as Record<string, unknown>
  // A video's recorded codec is its picture's: its sound's codec is not known.
  const codec = AUDIO_RECORDING_TYPES.has(type) ? str(meta.codec)?.toLowerCase() : undefined
  const aac = codec !== undefined && codec !== "unknown" ? codec.startsWith("aac") : inAacContainer(data, meta)
  if (!aac) return 0
  const rate = typeof meta.sampleRate === "number" && Number.isFinite(meta.sampleRate) && meta.sampleRate > 0 && AUDIO_RECORDING_TYPES.has(type)
    ? meta.sampleRate
    : AAC_LOWEST_SAMPLE_RATE_HZ
  return AAC_FRAME_SAMPLES / rate
}
