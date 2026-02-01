import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface ExtractAudioOptions {
  readonly videoUrl: string
  readonly audioFormat?: "mp3" | "wav" | "aac"
  readonly outputSilentVideo?: boolean
}

interface ExtractAudioResult {
  readonly audioPath: string
  readonly silentVideoPath?: string
}

export async function extractAudio(options: ExtractAudioOptions): Promise<ExtractAudioResult> {
  const { videoUrl, audioFormat = "mp3", outputSilentVideo = false } = options
  const workDir = await createWorkDir("extract-audio")

  try {
    const videoPath = join(workDir, "input.mp4")
    console.log("[extractAudio] Downloading video")
    await downloadFile(videoUrl, videoPath)

    const codecMap = { mp3: "libmp3lame", wav: "pcm_s16le", aac: "aac" } as const
    const audioPath = join(workDir, `output.${audioFormat}`)

    await runFfmpeg([
      "-y",
      "-i", videoPath,
      "-vn",
      "-acodec", codecMap[audioFormat],
      audioPath,
    ])

    let silentVideoPath: string | undefined
    if (outputSilentVideo) {
      silentVideoPath = join(workDir, "silent.mp4")
      await runFfmpeg([
        "-y",
        "-i", videoPath,
        "-an",
        "-c:v", "copy",
        silentVideoPath,
      ])
    }

    console.log(`[extractAudio] Output: ${audioPath}`)
    return { audioPath, silentVideoPath }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
