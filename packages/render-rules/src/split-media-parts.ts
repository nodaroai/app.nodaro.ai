/**
 * Split into Chunks (`split-media`): which parts a wire reads. The node makes
 * two lists of parts — its video parts on the `video` pip, its audio parts on
 * the `audio` pip — and both engines and the run estimate read them through
 * these functions, so a pip, a picked part and an Each wire mean the same
 * thing everywhere.
 *
 * Wires drawn before the node could fan out carry no `outputMode`, so they
 * stay on ONE part (the part `outputChunkIndex` names). A new wire drawn in
 * the editor starts in Each mode and runs the next node once per part.
 */

/** The part lists a Split into Chunks holds: a run's output, or its saved data. */
export interface SplitMediaPartLists {
  readonly videoUrls?: unknown
  readonly audioUrls?: unknown
}

/** The most parts one input may be split into; a run that would make more fails before it encodes. */
export const SPLIT_MEDIA_MAX_PARTS = 200

/**
 * The longest source a split takes, in seconds (decided 2026-10-13, like
 * Apply EDL's 3-hour output cap): a longer one fails before it encodes. It
 * bounds the job's declared budget, which is otherwise sized for the largest
 * source the part cap allows.
 */
export const SPLIT_MEDIA_MAX_SOURCE_SEC = 3 * 60 * 60

/**
 * The source length a run estimate assumes when nothing records the input's
 * length (a Video URL, a published app pricing the user's own upload), in
 * seconds (decided 2026-10-13: a typical length, not the part cap's ceiling,
 * which quoted 200 runs and refused low balances). The run is charged by the
 * parts it really makes.
 */
export const SPLIT_MEDIA_ASSUMED_SOURCE_SEC = 10 * 60

/** The minimum part length when a node sets none, in seconds (never more than the part length). */
export const SPLIT_MEDIA_DEFAULT_MIN_PART_SEC = 4

const urlsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : []

/** The pip a wire leaves from: `audio`, `video`, or none (legacy `*-out` spellings included). */
function pipOf(handle: string | null | undefined): "audio" | "video" | undefined {
  if (handle === "audio" || handle === "audio-out") return "audio"
  if (handle === "video" || handle === "video-out") return "video"
  return undefined
}

/**
 * The parts on a wire's pip: the video parts on `video`, the audio parts on
 * `audio`. A wire with no pip reads the video parts, else the audio parts.
 */
export function splitMediaParts(lists: SplitMediaPartLists, handle: string | null | undefined): string[] {
  const video = urlsOf(lists.videoUrls)
  const audio = urlsOf(lists.audioUrls)
  const pip = pipOf(handle)
  if (pip === "audio") return audio
  if (pip === "video") return video
  return video.length > 0 ? video : audio
}

/**
 * The one part a wire that does not fan out reads from `parts` (one pip's
 * parts): the part `chunkIndex` names (the node's "Output Chunk"), the first
 * when it names none, the last when it names one past the end.
 */
export function splitMediaPartAt(parts: readonly string[], chunkIndex: unknown): string | undefined {
  if (parts.length === 0) return undefined
  const i = typeof chunkIndex === "number" && Number.isInteger(chunkIndex) && chunkIndex > 0 ? chunkIndex : 0
  return parts[Math.min(i, parts.length - 1)]
}

/** {@link splitMediaPartAt} on a wire's pip of the node's part lists. */
export function splitMediaPickedPart(
  lists: SplitMediaPartLists,
  handle: string | null | undefined,
  chunkIndex: unknown,
): string | undefined {
  return splitMediaPartAt(splitMediaParts(lists, handle), chunkIndex)
}

/** The minimum part length a node's settings mean, in seconds: its own, else the default, never above the part length. */
export function splitMediaMinPartSec(chunkSec: number, minPartSec: unknown): number {
  const own = typeof minPartSec === "number" && Number.isFinite(minPartSec) && minPartSec >= 0 ? minPartSec : SPLIT_MEDIA_DEFAULT_MIN_PART_SEC
  return Math.min(own, chunkSec)
}

/**
 * The longest a part can lose to rounding down to a whole frame: one frame at
 * 23 fps, longer than one frame at any common rate (23.976 and up).
 */
const FRAME_ROUNDING_SEC = 1 / 23

/**
 * How many parts a source of `lengthSec` is split into, at most, at parts of at
 * most `chunkSec`, for a run estimate. A run cuts on whole frames, so a part
 * can be up to a frame shorter than `chunkSec` (299 frames for 10 s at 29.97
 * fps) and a source near a multiple of the part length then makes one more
 * part (60 s at 29.97 fps: 7, not 6); the count allows for that rounding, so
 * it is never below the parts the run makes, and is at most one above. The
 * minimum part length never changes the count (a short leftover is evened out
 * with the parts before it, not made a part of its own). Capped at
 * {@link SPLIT_MEDIA_MAX_PARTS} (a run past the cap fails). Once the node has
 * run, its parts are counted instead.
 */
export function splitMediaPartCount(lengthSec: number, chunkSec: number): number {
  if (!(lengthSec > 0) || !(chunkSec > 0)) return 1
  const shortestPart = chunkSec > FRAME_ROUNDING_SEC * 2 ? chunkSec - FRAME_ROUNDING_SEC : chunkSec
  return Math.max(1, Math.min(SPLIT_MEDIA_MAX_PARTS, Math.ceil(lengthSec / shortestPart)))
}
