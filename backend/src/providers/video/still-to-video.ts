/**
 * Still to Video — one still image + one audio track → MP4, local FFmpeg
 * only. No provider, no GPU, zero credits.
 *
 * The output duration IS the audio's duration: there is no duration option
 * anywhere in this pipeline. It's resolved here via ffprobe, converted to a
 * frame count (zoompan's `d` is frames, not seconds — see still-segment.ts),
 * and `-shortest` trims the ceil'd video tail to the audio exactly.
 *
 * The per-image segment math (geometry, zoompan expressions, intensity
 * mapping, frame math) lives in still-segment.ts — shared with the future
 * slideshow node, which reuses it verbatim.
 */
import { join } from "node:path"
import {
  createWorkDir,
  cleanupWorkDir,
  downloadFile,
  runFfprobe,
  runFfmpegWithProgress,
  probeMediaDuration,
} from "./ffmpeg-utils.js"
import {
  buildStillToVideoArgs,
  computeFrameCount,
  type StillMotion,
  type StillResolution,
  type StillAspectRatio,
  type StillFit,
  computeTargetDimensions,
} from "./still-segment.js"

export interface StillToVideoOptions {
  readonly imageUrl: string
  readonly audioUrl: string
  readonly motion: StillMotion
  readonly intensity: number
  readonly resolution: StillResolution
  readonly aspectRatio: StillAspectRatio
  readonly fps: number
  readonly fit: StillFit
  readonly padColor: string
  /** Streamed while encoding: (framesDone, framesTotal). */
  readonly onProgress?: (frame: number, totalFrames: number) => void
}

export interface StillToVideoResult {
  readonly outputPath: string
  /** The resolved audio duration — the output's duration by construction. */
  readonly durationSeconds: number
  readonly frames: number
}

/** Probe a local image's pixel dimensions. (probeVideoSource requires a
 *  duration and throws on stills, so images get their own narrow probe.) */
async function probeImageDimensions(path: string): Promise<{ width: number; height: number }> {
  const output = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0",
    path,
  ])
  const parts = output.trim().split(",").map((p) => parseInt(p.trim(), 10))
  const [width, height] = parts
  if (!width || !height || Number.isNaN(width) || Number.isNaN(height)) {
    throw new Error(`still-to-video: could not read image dimensions ("${output.trim()}")`)
  }
  return { width, height }
}

export async function stillToVideo(options: StillToVideoOptions): Promise<StillToVideoResult> {
  const workDir = await createWorkDir("still-to-video")

  try {
    const imagePath = join(workDir, "input-image.png")
    const audioPath = join(workDir, "input-audio.mp3")
    const outputPath = join(workDir, "output.mp4")

    console.log("[stillToVideo] Downloading image + audio")
    await downloadFile(options.imageUrl, imagePath)
    await downloadFile(options.audioUrl, audioPath)

    // The audio sets the length — resolved via ffprobe, no duration field.
    const durationSeconds = await probeMediaDuration(audioPath)
    const frames = computeFrameCount(durationSeconds, options.fps)
    const source = await probeImageDimensions(imagePath)
    const { width, height } = computeTargetDimensions(options.resolution, options.aspectRatio)

    console.log(
      `[stillToVideo] motion=${options.motion} ${width}x${height}@${options.fps} ` +
        `fit=${options.fit} audio=${durationSeconds.toFixed(2)}s → ${frames} frames`,
    )

    const args = buildStillToVideoArgs({
      imagePath,
      audioPath,
      outputPath,
      motion: options.motion,
      intensity: options.intensity,
      width,
      height,
      fps: options.fps,
      frames,
      fit: options.fit,
      padColor: options.padColor,
      sourceWidth: source.width,
      sourceHeight: source.height,
    })

    await runFfmpegWithProgress(args, (frame) => {
      options.onProgress?.(Math.min(frame, frames), frames)
    })

    return { outputPath, durationSeconds, frames }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
