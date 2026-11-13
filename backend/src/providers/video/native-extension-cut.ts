/**
 * The new part of a native extension (PixVerse V6 Extend): the provider takes
 * the whole source and returns the whole clip — the source, re-rendered at the
 * provider's own quality, then the new seconds. Only the new seconds are kept:
 * this cuts them out, from the source's picture length to the end, as a local
 * file the extend stitch (`extend-stitch.ts`) joins to the user's own source,
 * so the user's footage in the result is never the provider's re-render.
 *
 * - **By time, not by frame count.** The provider may return the clip at
 *   another frame rate than the source's (it re-renders it), so the source's
 *   frame count says nothing about where its part ends in the provider's clip.
 *   The cut starts at the source's picture length in seconds (measured as the
 *   stitch measures a picture, `pictureSecondsOf`), counted from where the
 *   clip's picture starts (`nativeExtensionCutStartSec`).
 * - **Frame-accurate and lossless.** Re-encoded, never stream-copied (a copy
 *   starts on the keyframe before the cut, so it would carry part of the
 *   source's re-render): the picture as lossless H.264 (`-qp 0`), every frame
 *   as it is (`-fps_mode passthrough`), and its sound (when the run has sound)
 *   as 24-bit PCM, in a MOV.
 *   The stitch then encodes it once, at the source's quality, so the cut costs
 *   the new seconds no quality of their own.
 * - **Even sides.** A picture with an odd width or height loses its last
 *   column and/or row, as H.264 4:2:0 needs (the stitch covers and crops it
 *   to the source's frame anyway); an even one is passed through as it is.
 * - **Silent when the sound is off.** With the run's sound switch off the cut
 *   keeps no sound at all, whatever the provider's clip carries, so the new
 *   seconds are silent by construction: the stitch pads a side with no sound
 *   with silence of its picture's length.
 */
import { join } from "node:path"
import { runFfmpeg } from "./ffmpeg-utils.js"
import type { MatchedProbe } from "./matched-encode.js"

/** An odd-size picture rounded down to even from its top left; an even one is unchanged. */
const EVEN_SIDES = "crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0"

/**
 * How far into the clip's timeline its picture starts, in seconds: its own
 * start less the earliest stream's (ffmpeg's timeline, which an input seek
 * counts on, starts with the earliest stream). 0 when a start is unread, or
 * when the picture starts first.
 */
export function pictureStartOffsetSec(probe: MatchedProbe): number {
  const video = probe.videoStartSec
  if (video === undefined) return 0
  const earliest = probe.audioStartSec === undefined ? video : Math.min(video, probe.audioStartSec)
  return Math.max(0, video - earliest)
}

/**
 * Where the new part starts on the provider's clip's timeline: after the first
 * `sourcePictureSec` seconds of its picture, counted from where that picture
 * starts (`pictureStartOffsetSec` of the clip's probe).
 */
export function nativeExtensionCutStartSec(probe: MatchedProbe, sourcePictureSec: number): number {
  return pictureStartOffsetSec(probe) + sourcePictureSec
}

/**
 * The cut's ffmpeg arguments (pure): `input` from `startSec` on its timeline to
 * its end, into `output`; its sound only when `sound` is on (`-an` otherwise).
 */
export function nativeExtensionCutArgs(input: string, startSec: number, output: string, opts: { sound: boolean }): string[] {
  return [
    "-y",
    "-ss", Math.max(0, startSec).toFixed(3), "-i", input,
    "-map", "0:v:0", ...(opts.sound ? ["-map", "0:a:0?"] : ["-an"]),
    "-map_metadata", "-1", "-map_chapters", "-1",
    "-vf", EVEN_SIDES,
    "-fps_mode", "passthrough",
    "-c:v", "libx264", "-preset", "veryfast", "-qp", "0",
    ...(opts.sound ? ["-c:a", "pcm_s24le"] : []),
    output,
  ]
}

/**
 * Cut the new part of the provider's clip at `input` (local): from `startSec`
 * on its timeline (`nativeExtensionCutStartSec`) to its end, with its sound
 * only when the run's `sound` is on, written to `workDir/native-extension.mov`
 * (the caller removes the folder). Throws when ffmpeg fails.
 */
export async function cutNativeExtension(input: string, startSec: number, workDir: string, opts: { sound: boolean }): Promise<string> {
  const output = join(workDir, "native-extension.mov")
  await runFfmpeg(nativeExtensionCutArgs(input, startSec, output, opts))
  return output
}
