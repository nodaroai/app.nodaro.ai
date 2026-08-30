/**
 * NoVideoStreamError — "the media handed to a VIDEO step carries no video
 * stream". Thrown by `mergeVideoAudio` (providers/video) BEFORE ffmpeg runs.
 *
 * WHY THIS EXISTS (incident 2026-08-30, voice-changer-pro):
 * An audio-only M4A uploaded as `.mp4` (served `video/mp4`) was wired into a
 * video input. Every slot-driven layer believed the container — the upload
 * validator (client MIME), the node's mode selection (`if (videoUrl)`), the
 * merge (`-map 0:v`) — and the truth surfaced only as a swallowed ffmpeg
 * stderr + a generic "FFmpeg merge failed", AFTER the paid provider pass and
 * after three blind retries re-paid it. The streams are the only honest
 * signal; this error is how a stream-level refusal travels.
 *
 * NOT a PostProcessingError (see lib/post-processing-error.ts): it is an
 * INPUT defect, not a post-delivery failure. Provider-delivered videos
 * (i2v/t2v results) always carry a video stream, so they cannot raise it;
 * the nodes that CAN reach it with a paid result in hand (voice-changer,
 * voice-changer-pro) probe the source first and demote to audio mode instead
 * of merging. What remains is the standalone merge node fed a bad input —
 * which must refund. `mergeVideoAudio` therefore re-throws this error
 * UN-TAGGED past its post-processing wrapper.
 *
 * WHY A MARKER PROPERTY (`noVideoStream`), mirroring `postProcessing`:
 * the error crosses the private-plugin toolkit boundary (plugins cannot
 * `instanceof` an app class) and may be wrapped once as a `cause`.
 * `isNoVideoStreamError` checks the marker on the error AND on its cause.
 *
 * This module has NO imports by design (same rule as post-processing-error).
 */

export const NO_VIDEO_STREAM_MESSAGE =
  "The video input has no video stream (it is an audio-only file). Connect it to an audio input instead, or use a clip that contains video."

export class NoVideoStreamError extends Error {
  /** Stable discriminator that survives prototype loss across boundaries. */
  readonly noVideoStream = true as const

  constructor(message: string = NO_VIDEO_STREAM_MESSAGE) {
    super(message)
    this.name = "NoVideoStreamError"
    Object.setPrototypeOf(this, NoVideoStreamError.prototype)
  }
}

function carriesMarker(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    (value as { noVideoStream?: unknown }).noVideoStream === true
}

/**
 * True iff `err` is (or directly wraps, via `cause`) a NoVideoStreamError.
 * Marker-based on purpose — see the class comment.
 */
export function isNoVideoStreamError(err: unknown): boolean {
  if (carriesMarker(err)) return true
  if (typeof err === "object" && err !== null) {
    return carriesMarker((err as { cause?: unknown }).cause)
  }
  return false
}
