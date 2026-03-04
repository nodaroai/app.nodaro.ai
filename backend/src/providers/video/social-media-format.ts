import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface SocialMediaFormatOptions {
  readonly mediaUrl: string
  readonly mediaType: "image" | "video"
  readonly width: number
  readonly height: number
  readonly method: "crop" | "pad" | "stretch"
  readonly padColor?: string
}

export async function socialMediaFormat(options: SocialMediaFormatOptions): Promise<string> {
  const { mediaUrl, mediaType, width, height, method, padColor = "#000000" } = options
  const workDir = await createWorkDir("social-media-format")

  try {
    const isImage = mediaType === "image"
    const inputExt = isImage ? "input.png" : "input.mp4"
    const outputExt = isImage ? "output.jpg" : "output.mp4"
    const inputPath = join(workDir, inputExt)
    const outputPath = join(workDir, outputExt)

    await downloadFile(mediaUrl, inputPath)

    const color = padColor.replace("#", "0x")
    let vf: string

    if (method === "crop") {
      vf = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
    } else if (method === "pad") {
      vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${color}`
    } else {
      vf = `scale=${width}:${height}`
    }

    if (isImage) {
      await runFfmpeg([
        "-y",
        "-i", inputPath,
        "-vf", vf,
        "-q:v", "2",
        outputPath,
      ])
    } else {
      await runFfmpeg([
        "-y",
        "-i", inputPath,
        "-vf", vf,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        "-crf", "23",
        "-r", "30",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        outputPath,
      ])
    }

    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
