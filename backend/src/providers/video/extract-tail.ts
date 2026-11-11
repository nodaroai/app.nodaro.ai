import { getVideoStreamDuration, probeMediaDuration, runFfmpeg } from "./ffmpeg-utils.js"

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
 */
export async function extractTailToFile(
  inputPath: string,
  seconds: number,
  opts: { measureFrom?: "container" | "picture" } = {},
): Promise<string> {
  const duration = opts.measureFrom === "picture" ? await getVideoStreamDuration(inputPath) : await probeMediaDuration(inputPath)
  const start = Math.max(0, duration - seconds)
  const out = `${inputPath}.tail.mp4`
  await runFfmpeg([
    "-ss", start.toFixed(3), "-i", inputPath, "-t", seconds.toFixed(3),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "20",
    "-c:a", "aac", "-movflags", "+faststart", "-y", out,
  ])
  return out
}
