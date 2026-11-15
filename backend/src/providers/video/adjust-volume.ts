import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"
import { mp3EncodeArgs, writesMp3ByDefault } from "./mp3-encode.js"

interface AdjustVolumeOptions {
  readonly audioUrl?: string
  readonly videoUrl?: string
  readonly volume?: number
  readonly normalize?: boolean
  readonly fadeIn?: number
  readonly fadeOut?: number
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

    const audioFilters: string[] = []
    audioFilters.push(`volume=${volume / 100}`)
    if (normalize) {
      audioFilters.push("loudnorm")
    }
    if (fadeIn > 0) {
      audioFilters.push(`afade=t=in:d=${fadeIn}`)
    }
    if (fadeOut > 0) {
      audioFilters.push(`afade=t=out:d=${fadeOut}`)
    }

    // A video keeps its picture unchanged; only the audio is modified.
    await runFfmpeg(adjustVolumeArgs(inputPath, outputPath, isVideo, audioFilters))

    console.log(`[adjustVolume] Output: ${outputPath}`)
    return { outputPath, inputType: isVideo ? "video" : "audio" }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
