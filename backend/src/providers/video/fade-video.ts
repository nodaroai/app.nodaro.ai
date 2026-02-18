import { join } from "node:path"
import { downloadFile, runFfmpeg, getVideoDuration, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface FadeVideoOptions {
  readonly videoUrl: string
  readonly fadeIn: boolean
  readonly fadeInDuration: number
  readonly fadeOut: boolean
  readonly fadeOutDuration: number
  readonly color: "black" | "white"
}

export async function fadeVideo(options: FadeVideoOptions): Promise<string> {
  const { videoUrl, fadeIn, fadeInDuration, fadeOut, fadeOutDuration, color } = options
  const workDir = await createWorkDir("fade-video")

  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")

    console.log(`[fadeVideo] Downloading video from ${videoUrl}`)
    await downloadFile(videoUrl, inputPath)

    // Get video duration for fade out start point
    const duration = await getVideoDuration(inputPath)

    // Build video filter chain
    const vfParts: string[] = []
    if (fadeIn) {
      vfParts.push(`fade=t=in:st=0:d=${fadeInDuration}:color=${color}`)
    }
    if (fadeOut) {
      const fadeOutStart = Math.max(0, duration - fadeOutDuration)
      vfParts.push(`fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDuration}:color=${color}`)
    }

    // Build audio filter chain
    const afParts: string[] = []
    if (fadeIn) {
      afParts.push(`afade=t=in:st=0:d=${fadeInDuration}`)
    }
    if (fadeOut) {
      const fadeOutStart = Math.max(0, duration - fadeOutDuration)
      afParts.push(`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDuration}`)
    }

    const args = ["-y", "-i", inputPath]
    if (vfParts.length > 0) args.push("-vf", vfParts.join(","))
    if (afParts.length > 0) args.push("-af", afParts.join(","))
    args.push("-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", outputPath)

    console.log(`[fadeVideo] Running FFmpeg: ffmpeg ${args.join(" ")}`)

    // Fallback: if audio filter fails (no audio track), retry without -af
    await runFfmpeg(args).catch(async () => {
      console.log(`[fadeVideo] Retrying without audio filters (input may lack audio)`)
      const fallbackArgs = ["-y", "-i", inputPath]
      if (vfParts.length > 0) fallbackArgs.push("-vf", vfParts.join(","))
      fallbackArgs.push("-c:v", "libx264", "-preset", "fast", "-crf", "23", "-an", outputPath)
      await runFfmpeg(fallbackArgs)
    })

    console.log(`[fadeVideo] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
