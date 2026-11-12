import { getVideoStreamDuration, probeMediaDuration, runFfmpeg, type FfmpegLaunchOptions } from "./ffmpeg-utils.js"

/**
 * The tail's ffmpeg arguments (pure): `seconds` of `inputPath` from `start`,
 * re-encoded (picture and sound), into `out`; the picture through
 * `pictureFilter` when one is given.
 */
export function extractTailArgs(inputPath: string, start: number, seconds: number, out: string, pictureFilter?: string): string[] {
  return [
    "-ss", start.toFixed(3), "-i", inputPath, "-t", seconds.toFixed(3),
    ...(pictureFilter ? ["-vf", pictureFilter] : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "20",
    "-c:a", "aac", "-movflags", "+faststart", "-y", out,
  ]
}

/**
 * Re-encode the last `seconds` of `inputPath` into a new local file.
 *
 * Always RE-ENCODES rather than stream-copying. `-t`/`-ss` combined with
 * `-c copy` cuts at the nearest keyframe, which for a tail-extraction (as
 * opposed to a full clip) can land BEFORE the requested start and emit a
 * segment that doesn't decode cleanly from its first frame — the same
 * keyframe-snap problem `trimLastFrames` re-encodes to avoid (see
 * `ffmpeg-utils.ts:404-431`). generate-video-pro uses the tail as the visual
 * seed for the next segment's image-to-video call, so it must decode from
 * frame 0.
 *
 * `-ss` before `-i` (input seeking) is used for speed; re-encoding (not
 * stream-copy) is what keeps the cut frame-accurate despite input seeking's
 * normal keyframe-rounding behavior.
 *
 * `measureFrom` picks the end the `seconds` count back from: the container's
 * (the default) or the picture's (`getVideoStreamDuration`). They differ when
 * the sound runs past the last frame, as it routinely does in a generated
 * clip; measured from the container, part of the tail is then sound with no
 * picture, and the tail holds less picture than asked. `"picture"` (local
 * files only) ends the tail on the last frame.
 *
 * `pictureFilter` runs the picture through a filter on its way (the extend's
 * conversion of an HDR source to SDR, or of a full-range one to limited
 * range, `extendTailPicture`); `launch` is the launch's memory prediction,
 * for a cut that needs more than the default.
 * Without them the tail is cut exactly as it always was.
 */
export async function extractTailToFile(
  inputPath: string,
  seconds: number,
  opts: { measureFrom?: "container" | "picture"; pictureFilter?: string; launch?: FfmpegLaunchOptions } = {},
): Promise<string> {
  const duration = opts.measureFrom === "picture" ? await getVideoStreamDuration(inputPath) : await probeMediaDuration(inputPath)
  const start = Math.max(0, duration - seconds)
  const out = `${inputPath}.tail.mp4`
  await runFfmpeg(extractTailArgs(inputPath, start, seconds, out, opts.pictureFilter), undefined, opts.launch)
  return out
}
