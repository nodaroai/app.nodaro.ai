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

    console.log(`[trimVideo] Downloading video from ${videoUrl}`)
    await downloadFile(videoUrl, inputPath)

    // Use input seeking (-ss before -i) for faster seeking, then re-encode
    // to ensure both video and audio streams are properly included.
    // Note: When using input seeking, -t is duration from start point, not absolute time.
    const args = ["-y", "-ss", String(startTime), "-i", inputPath]

    if (endTime !== undefined) {
      // Calculate duration from startTime to endTime
      const duration = endTime - startTime
      args.push("-t", String(duration))
    }

    // Re-encode video and audio to ensure both streams are included
    // Using fast preset for reasonable speed, CRF 23 for good quality
    args.push(
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      outputPath
    )

    console.log(`[trimVideo] Running FFmpeg: ffmpeg ${args.join(" ")}`)
    await runFfmpeg(args)

    console.log(`[trimVideo] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
