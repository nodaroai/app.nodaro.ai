import sharp from "sharp"
import { runFfmpeg, BROWSER_SAFE_VIDEO_ARGS } from "../providers/video/ffmpeg-utils.js"

const WATERMARK_TEXT = "SceneNode.ai"

/**
 * Composite a semi-transparent "SceneNode.ai" text watermark
 * onto the bottom-right corner of an image buffer using sharp.
 */
export async function applyImageWatermark(buffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata()
  const width = metadata.width ?? 1024
  const height = metadata.height ?? 1024

  const fontSize = Math.max(16, Math.round(width * 0.025))
  const svg = `<svg width="${width}" height="${height}">
    <text
      x="${width - 20}"
      y="${height - 20}"
      text-anchor="end"
      font-family="sans-serif"
      font-size="${fontSize}"
      fill="rgba(255,255,255,0.5)"
    >${WATERMARK_TEXT}</text>
  </svg>`

  return sharp(buffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toBuffer()
}

/**
 * Burn a semi-transparent "SceneNode.ai" text watermark
 * into the bottom-right corner of a video using ffmpeg drawtext.
 */
export async function applyVideoWatermark(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  await runFfmpeg([
    "-y",
    "-i", inputPath,
    "-vf", `drawtext=text='${WATERMARK_TEXT}':fontsize=24:fontcolor=white@0.5:x=w-tw-20:y=h-th-20`,
    ...BROWSER_SAFE_VIDEO_ARGS,
    "-c:a", "aac", "-b:a", "128k",
    outputPath,
  ])
}
