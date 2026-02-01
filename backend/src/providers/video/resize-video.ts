import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface ResizeVideoOptions {
  readonly videoUrl: string
  readonly targetAspect: string
  readonly method: "crop" | "pad" | "stretch"
  readonly padColor?: string
}

const ASPECT_DIMENSIONS: Record<string, { w: number; h: number }> = {
  "1:1": { w: 1080, h: 1080 },
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "4:5": { w: 1080, h: 1350 },
}

export async function resizeVideo(options: ResizeVideoOptions): Promise<string> {
  const { videoUrl, targetAspect, method, padColor = "#000000" } = options
  const workDir = await createWorkDir("resize-video")

  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")

    console.log(`[resizeVideo] Downloading video`)
    await downloadFile(videoUrl, inputPath)

    const dim = ASPECT_DIMENSIONS[targetAspect] ?? { w: 1920, h: 1080 }
    const color = padColor.replace("#", "0x")
    let vf: string

    if (method === "crop") {
      vf = `scale=${dim.w}:${dim.h}:force_original_aspect_ratio=increase,crop=${dim.w}:${dim.h}`
    } else if (method === "pad") {
      vf = `scale=${dim.w}:${dim.h}:force_original_aspect_ratio=decrease,pad=${dim.w}:${dim.h}:(ow-iw)/2:(oh-ih)/2:color=${color}`
    } else {
      vf = `scale=${dim.w}:${dim.h}`
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
