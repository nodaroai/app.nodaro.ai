/**
 * The one upload that may exceed the data category's 50 MB: a Speaker Frames
 * face-track file a connected self-host re-hosts to nodaro.ai for a relayed
 * Speaker View render (decided 2026-10-10: a 64 MiB limit — the track-set cap,
 * `SPEAKER_TRACKS_MAX_BYTES` — for this file type only; other uploads stay at
 * 50 MB). The upload names its purpose (`purpose=speaker-tracks`, a multipart
 * field before the file), and the bytes must BE a face-track set: a named
 * purpose alone never lifts the limit for other JSON.
 */
import { SPEAKER_TRACKS_MAX_BYTES, SPEAKER_TRACKS_VERSION } from "@nodaro/shared/edl"

/** The multipart `purpose` a re-hosted face-track file is uploaded with. */
export const SPEAKER_TRACKS_UPLOAD_PURPOSE = "speaker-tracks"

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** Whether `buffer` is a face-track set (the stored body, with its boxes): its
 *  version, and every source a list of tracks that each carry boxes. */
export function isSpeakerTrackSetBody(buffer: Buffer): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(buffer.toString("utf8"))
  } catch {
    return false
  }
  if (!isObj(parsed) || parsed.version !== SPEAKER_TRACKS_VERSION || !Array.isArray(parsed.sources) || parsed.sources.length === 0) return false
  return parsed.sources.every(
    (s) => isObj(s) && typeof s.sourceId === "string" && Array.isArray(s.tracks) && s.tracks.every((t) => isObj(t) && Array.isArray(t.boxes)),
  )
}

/**
 * The size limit that replaces the category's for this upload, or undefined
 * when the category's own limit applies: only for a JSON upload that names
 * the face-track purpose, is over the category's limit, within the track-set
 * cap, and is a face-track set (parsed only then).
 */
export function speakerTrackUploadLimit(input: {
  readonly purpose: string | null | undefined
  readonly mime: string
  readonly buffer: Buffer
  readonly categoryLimit: number
}): number | undefined {
  if (input.purpose !== SPEAKER_TRACKS_UPLOAD_PURPOSE || input.mime !== "application/json") return undefined
  const size = input.buffer.length
  if (size <= input.categoryLimit || size > SPEAKER_TRACKS_MAX_BYTES) return undefined
  return isSpeakerTrackSetBody(input.buffer) ? SPEAKER_TRACKS_MAX_BYTES : undefined
}
