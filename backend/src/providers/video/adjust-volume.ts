import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

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

    if (isVideo) {
      // Video input: copy video stream unchanged, only modify audio
      await runFfmpeg([
        "-y",
        "-i", inputPath,
        "-c:v", "copy",
        "-af", audioFilters.join(","),
        outputPath,
      ])
    } else {
      // Audio-only input: existing behavior
      await runFfmpeg([
        "-y",
        "-i", inputPath,
        "-af", audioFilters.join(","),
        outputPath,
      ])
    }

    console.log(`[adjustVolume] Output: ${outputPath}`)
    return { outputPath, inputType: isVideo ? "video" : "audio" }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
