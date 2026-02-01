import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface TrimVideoOptions {
  readonly videoUrl: string
  readonly startTime: number
  readonly endTime?: number
}

export async function trimVideo(options: TrimVideoOptions): Promise<string> {
  const { videoUrl, startTime, endTime } = options
  const workDir = await createWorkDir("trim-video")

  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")

    console.log(`[trimVideo] Downloading video`)
    await downloadFile(videoUrl, inputPath)

    const args = ["-y", "-i", inputPath, "-ss", String(startTime)]
    if (endTime !== undefined) {
      args.push("-to", String(endTime))
    }
    args.push("-c", "copy", outputPath)

    await runFfmpeg(args)

    console.log(`[trimVideo] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
