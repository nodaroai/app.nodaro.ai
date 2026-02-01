import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface AddAudioOptions {
  readonly videoUrl: string
  readonly audioUrl: string
  readonly voiceoverVolume?: number
  readonly backgroundVolume?: number
  readonly keepOriginalAudio?: boolean
}

export async function addAudio(options: AddAudioOptions): Promise<string> {
  const { videoUrl, audioUrl, voiceoverVolume = 100, backgroundVolume = 100, keepOriginalAudio = false } = options
  const workDir = await createWorkDir("add-audio")

  try {
    const videoPath = join(workDir, "input.mp4")
    const audioPath = join(workDir, "audio.mp3")
    const outputPath = join(workDir, "output.mp4")

    console.log("[addAudio] Downloading video and audio")
    await downloadFile(videoUrl, videoPath)
    await downloadFile(audioUrl, audioPath)

    const vol = voiceoverVolume / 100
    const bgVol = backgroundVolume / 100

    if (keepOriginalAudio) {
      await runFfmpeg([
        "-y",
        "-i", videoPath,
        "-i", audioPath,
        "-filter_complex",
        `[0:a]volume=${bgVol}[orig];[1:a]volume=${vol}[new];[orig][new]amix=inputs=2:duration=longest[aout]`,
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
        outputPath,
      ]).catch(async () => {
        // Fallback: video may not have audio, just add the new audio
        await runFfmpeg([
          "-y",
          "-i", videoPath,
          "-i", audioPath,
          "-filter_complex",
          `[1:a]volume=${vol}[aout]`,
          "-map", "0:v",
          "-map", "[aout]",
          "-c:v", "copy",
          "-c:a", "aac",
          "-shortest",
          outputPath,
        ])
      })
    } else {
      await runFfmpeg([
        "-y",
        "-i", videoPath,
        "-i", audioPath,
        "-filter_complex",
        `[1:a]volume=${vol}[aout]`,
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        outputPath,
      ])
    }

    console.log(`[addAudio] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
