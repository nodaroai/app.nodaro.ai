/**
 * The audio a separation splits, when its source link may be a VIDEO.
 *
 * Both splitters (Audio Separation, and Suno Separate on its "any audio by
 * URL" lane with its fallback) take a link to a video as their source and
 * split the video's sound: the sound is taken out here, before the split, at
 * no extra charge. The run is priced as the split alone.
 *
 * What the file IS decides it, never its name: the link is classified by the
 * repo's one stream probe (`classifyMediaSource`, read through the probe
 * guard), and only a file with a real picture stream is converted. An embedded
 * cover picture (an MP3 with album art) is no picture, and an audio-only
 * MP4/WebM is audio. An audio file is returned as it came, with nothing
 * downloaded, re-encoded or stored, so every audio run sends the very link it
 * sent before.
 *
 * A video is downloaded under the big-media limits and a byte cap
 * ({@link SEPARABLE_VIDEO_MAX_BYTES}), and its sound written as an MP3 by the
 * one extractor the platform has (`extractAudioTrack`, the Extract Audio
 * node's own arguments). Those name no stream, so ffmpeg takes its default
 * audio stream: the one with the most channels, the first of them on a tie.
 * The MP3 is stored in the running job's scratch folder, which the video
 * worker empties when the job ends.
 *
 * Refusals that are the same on every attempt are final (failed and refunded
 * at once), each with a sentence the person can act on: a video without sound
 * ({@link NoAudioToSeparateError}), a picture or GIF ({@link NotSeparableMediaError}),
 * a video over the byte cap ({@link VideoTooLargeToSeparateError}).
 *
 * A probe that cannot run (a timeout, a refused link, a file ffprobe cannot
 * read) leaves the link as it came (`classifyMediaSource` fails open): the
 * split then judges the file exactly as it did before this step existed, so
 * no audio run can newly fail here.
 */
import { extractAudioTrack, NoAudioTrackError } from "../video/extract-audio-track.js"
import { classifyMediaSource } from "../video/media-source.js"
import {
  BIG_MEDIA_DOWNLOAD_LIMITS,
  cleanupWorkDir,
  isDownloadByteCapError,
  probeMediaFormatAndDuration,
} from "../video/ffmpeg-utils.js"
import { uploadJobScratchFile } from "../../lib/job-scratch.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"

/** How long the probe of a source link may take before it counts as unreadable. */
export const SEPARABLE_AUDIO_PROBE_TIMEOUT_MS = 60_000

/** The largest video downloaded to take its sound out (the cap Audio Isolation downloads a source under). */
export const SEPARABLE_VIDEO_MAX_BYTES = 500 * 1024 * 1024

/** The video sent to a separation has no sound in it. Final: the same video fails again. */
export class NoAudioToSeparateError extends DeterministicJobError {
  constructor(options?: { cause?: unknown }) {
    super("This video has no sound to separate. Use a clip with audio in it, or connect the audio itself.", options)
    this.name = "NoAudioToSeparateError"
  }
}

/** The link sent to a separation is a picture or a GIF: neither audio nor a video with sound. Final. */
export class NotSeparableMediaError extends DeterministicJobError {
  constructor(options?: { cause?: unknown }) {
    super("This file is an image, not audio or a video. Connect a song, a recording, or a video with sound.", options)
    this.name = "NotSeparableMediaError"
  }
}

/** The video is over {@link SEPARABLE_VIDEO_MAX_BYTES}. Final: the same file is refused again. */
export class VideoTooLargeToSeparateError extends DeterministicJobError {
  constructor(options?: { cause?: unknown }) {
    super(
      `This video is larger than ${SEPARABLE_VIDEO_MAX_BYTES / (1024 * 1024)} MB. ` +
        "Trim it, or connect its audio instead (an Extract Audio node, or an MP3 or M4A of it).",
      options,
    )
    this.name = "VideoTooLargeToSeparateError"
  }
}

/** ffprobe's demuxers for still pictures and GIFs: `image2`, `image2pipe`, every `*_pipe` (png_pipe, jpeg_pipe, webp_pipe, …), `gif`, `apng`. */
export function isImageFormat(formatNames: readonly string[]): boolean {
  return formatNames.some((n) => n === "image2" || n === "image2pipe" || n === "gif" || n === "apng" || n.endsWith("_pipe"))
}

/** A picture stream with no sound: a picture or a GIF, or else a silent video. A probe that fails says video. */
async function silentPictureError(url: string): Promise<DeterministicJobError> {
  try {
    const { formatNames } = await probeMediaFormatAndDuration(url)
    if (formatNames && isImageFormat(formatNames)) return new NotSeparableMediaError()
  } catch {
    // The stream probe already read it: the plain silent-video sentence stands.
  }
  return new NoAudioToSeparateError()
}

/**
 * The link a separation sends for the source at `url`: `url` itself unless it
 * holds a picture stream, else an MP3 of its sound in the scratch folder of
 * `jobId`. Throws a final, refunded error for a picture, a silent video or a
 * video over the byte cap.
 */
export async function toSeparableAudio(url: string, jobId: string): Promise<string> {
  const source = await classifyMediaSource(url, "audio", { timeoutMs: SEPARABLE_AUDIO_PROBE_TIMEOUT_MS })
  if (!source.hasVideo) return url
  if (!source.hasAudio) throw await silentPictureError(url)

  let extracted: Awaited<ReturnType<typeof extractAudioTrack>>
  try {
    extracted = await extractAudioTrack(url, { download: { limits: BIG_MEDIA_DOWNLOAD_LIMITS, maxBytes: SEPARABLE_VIDEO_MAX_BYTES } })
  } catch (err) {
    if (isDownloadByteCapError(err)) throw new VideoTooLargeToSeparateError({ cause: err })
    // The downloaded copy is the judge: a probe can see a sound stream the file does not really carry.
    if (err instanceof NoAudioTrackError) throw new NoAudioToSeparateError({ cause: err })
    throw err
  }
  try {
    const audioUrl = await uploadJobScratchFile(extracted.audioPath, "separate-audio", "mp3", "audio/mpeg", jobId)
    console.log(`[separable-audio] ${jobId}: video source, its sound extracted for the split`)
    return audioUrl
  } finally {
    await cleanupWorkDir(extracted.workDir)
  }
}
