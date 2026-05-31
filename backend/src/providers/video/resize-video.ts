import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"
import { ASPECT_RATIO_DIMENSIONS } from "@nodaro/shared"

interface ResizeVideoOptions {
  readonly videoUrl: string
  readonly targetAspect: string
  readonly method: "crop" | "pad" | "stretch"
  readonly padColor?: string
}

export async function resizeVideo(options: ResizeVideoOptions): Promise<string> {
  const { videoUrl, targetAspect, method, padColor = "#000000" } = options
  const workDir = await createWorkDir("resize-video")

  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")

    console.log(`[resizeVideo] Downloading video`)
    await downloadFile(videoUrl, inputPath)

    const dim = ASPECT_RATIO_DIMENSIONS[targetAspect] ?? { width: 1920, height: 1080 }
    const color = padColor.replace("#", "0x")
    let vf: string

    if (method === "crop") {
      vf = `scale=${dim.width}:${dim.height}:force_original_aspect_ratio=increase,crop=${dim.width}:${dim.height}`
    } else if (method === "pad") {
      vf = `scale=${dim.width}:${dim.height}:force_original_aspect_ratio=decrease,pad=${dim.width}:${dim.height}:(ow-iw)/2:(oh-ih)/2:color=${color}`
    } else {
      vf = `scale=${dim.width}:${dim.height}`
    }

    await runFfmpeg([
      "-y",
      "-i", inputPath,
      "-vf", vf,
      "-c:a", "copy",
      outputPath,
    ])

    console.log(`[resizeVideo] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
