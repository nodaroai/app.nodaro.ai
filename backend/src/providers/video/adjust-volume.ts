import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface AdjustVolumeOptions {
  readonly audioUrl: string
  readonly volume?: number
  readonly normalize?: boolean
  readonly fadeIn?: number
  readonly fadeOut?: number
}

export async function adjustVolume(options: AdjustVolumeOptions): Promise<string> {
  const { audioUrl, volume = 100, normalize = false, fadeIn = 0, fadeOut = 0 } = options
  const workDir = await createWorkDir("adjust-volume")

  try {
    const ext = audioUrl.includes(".wav") ? "wav" : audioUrl.includes(".aac") ? "aac" : "mp3"
    const inputPath = join(workDir, `input.${ext}`)
    const outputPath = join(workDir, `output.${ext}`)

    console.log(`[adjustVolume] Downloading audio`)
    await downloadFile(audioUrl, inputPath)

    const filters: string[] = []
    filters.push(`volume=${volume / 100}`)
    if (normalize) {
      filters.push("loudnorm")
    }
    if (fadeIn > 0) {
      filters.push(`afade=t=in:d=${fadeIn}`)
    }
    if (fadeOut > 0) {
      filters.push(`afade=t=out:d=${fadeOut}`)
    }

    await runFfmpeg([
      "-y",
      "-i", inputPath,
      "-af", filters.join(","),
      outputPath,
    ])

    console.log(`[adjustVolume] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
