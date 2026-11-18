import { join } from "node:path"
import { downloadFile, runFfmpeg, runFfprobe, createWorkDir, cleanupWorkDir, getVideoDuration } from "./ffmpeg-utils.js"
import { mp3EncodeArgs, writesMp3ByDefault } from "./mp3-encode.js"

/** The levers of an adjust: volume in percent, loudness normalization, and the fades in seconds. */
export interface AdjustVolumeLevers {
  readonly volume?: number
  readonly normalize?: boolean
  readonly fadeIn?: number
  readonly fadeOut?: number
}

interface AdjustVolumeOptions extends AdjustVolumeLevers {
  readonly audioUrl?: string
  readonly videoUrl?: string
}

/**
 * The audio filters of an adjust, in order: the volume, the loudness
 * normalization, the fade-in from the start and the fade-out that ENDS at the
 * input's end. `durationSec` (the input's length) places the fade-out: it
 * starts at `durationSec - fadeOut` (at 0 when the fade is longer than the
 * input). Without a start ffmpeg runs a fade-out from 0 — the sound faded away
 * over the clip's FIRST seconds and silent after — so it is required whenever
 * `fadeOut` is above 0.
 */
export function adjustVolumeFilters(levers: AdjustVolumeLevers, durationSec?: number): string[] {
  const { volume = 100, normalize = false, fadeIn = 0, fadeOut = 0 } = levers
  const filters: string[] = [`volume=${volume / 100}`]
  if (normalize) filters.push("loudnorm")
  if (fadeIn > 0) filters.push(`afade=t=in:d=${fadeIn}`)
  if (fadeOut > 0) {
    if (durationSec === undefined || !Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error("Could not read the audio's length to place its fade-out")
    }
    const start = Math.max(0, durationSec - fadeOut)
    filters.push(`afade=t=out:st=${start.toFixed(3)}:d=${fadeOut}`)
  }
  return filters
}

/**
 * The length a fade-out ends at: the input's audio stream's own (a video's
 * sound can end before its picture), else the container's.
 */
async function audioLengthSec(inputPath: string): Promise<number> {
  try {
    const sec = parseFloat((await runFfprobe(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration", "-of", "csv=p=0", inputPath])).trim())
    if (Number.isFinite(sec) && sec > 0) return sec
  } catch {
    // No stream duration to read: the container's below.
  }
  return getVideoDuration(inputPath)
}

function getExtension(url: string, fallback: string): string {
  const match = url.match(/\.(\w{2,5})(?:\?|$)/)
  return match?.[1] ?? fallback
}

/**
 * The ffmpeg arguments that apply `audioFilters` and write `outputPath`, whose
 * extension (the input's own) picks the container and, with no codec named,
 * its audio encoder. A video keeps its picture (stream copy). A container whose
 * default audio is MP3 (`.mp3`, and the `.avi`/`.flv`/`.swf` video containers)
 * is an MP3 encode, built by mp3-encode.ts.
 */
export function adjustVolumeArgs(inputPath: string, outputPath: string, isVideo: boolean, audioFilters: readonly string[]): string[] {
  const audio = writesMp3ByDefault(outputPath) ? mp3EncodeArgs({ filters: audioFilters }) : ["-af", audioFilters.join(",")]
  return ["-y", "-i", inputPath, ...(isVideo ? ["-c:v", "copy"] : []), ...audio, outputPath]
}

export async function adjustVolume(options: AdjustVolumeOptions): Promise<{ outputPath: string; inputType: "video" | "audio" }> {
  const { audioUrl, videoUrl, volume = 100, normalize = false, fadeIn = 0, fadeOut = 0 } = options
  const isVideo = Boolean(videoUrl)
  const inputUrl = videoUrl ?? audioUrl
  if (!inputUrl) throw new Error("Either audioUrl or videoUrl is required")

  const workDir = await createWorkDir("adjust-volume")

  try {
    const ext = isVideo
      ? getExtension(inputUrl, "mp4")
      : getExtension(inputUrl, "mp3")
    const inputPath = join(workDir, `input.${ext}`)
    const outputPath = join(workDir, `output.${ext}`)

    console.log(`[adjustVolume] Downloading ${isVideo ? "video" : "audio"}`)
    await downloadFile(inputUrl, inputPath)

    // The input's length is read only when a fade-out has to end at it.
    const durationSec = fadeOut > 0 ? await audioLengthSec(inputPath) : undefined
    const audioFilters = adjustVolumeFilters({ volume, normalize, fadeIn, fadeOut }, durationSec)

    // A video keeps its picture unchanged; only the audio is modified.
    await runFfmpeg(adjustVolumeArgs(inputPath, outputPath, isVideo, audioFilters))

    console.log(`[adjustVolume] Output: ${outputPath}`)
    return { outputPath, inputType: isVideo ? "video" : "audio" }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
