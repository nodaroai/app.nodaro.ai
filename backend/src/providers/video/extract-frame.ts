import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface ExtractFrameOptions {
  readonly videoUrl: string
  readonly mode: "first" | "last" | "timestamp"
  readonly timestamp?: number
}

export async function extractFrame(options: ExtractFrameOptions): Promise<{ imagePath: string }> {
  const { videoUrl, mode, timestamp = 0 } = options
  const workDir = await createWorkDir("extract-frame")

  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "frame.jpg")

    console.log(`[extractFrame] Downloading video from ${videoUrl}`)
    await downloadFile(videoUrl, inputPath)

    const args: string[] = ["-y"]

    if (mode === "last") {
      args.push("-sseof", "-1", "-i", inputPath)
    } else if (mode === "timestamp") {
      args.push("-ss", String(timestamp), "-i", inputPath)
    } else {
      args.push("-i", inputPath)
    }

    args.push("-vframes", "1", "-q:v", "2", outputPath)

    console.log(`[extractFrame] Running FFmpeg: ffmpeg ${args.join(" ")}`)
    await runFfmpeg(args)

    console.log(`[extractFrame] Output: ${outputPath}`)
    return { imagePath: outputPath }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
