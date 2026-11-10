import sharp from "sharp"
import { runFfmpeg, BROWSER_SAFE_VIDEO_ARGS } from "../providers/video/ffmpeg-utils.js"

import { runFfmpegCancellable } from "../providers/video/ffmpeg-cancellable.js"

export const WATERMARK_TEXT = "Nodaro.ai"

/**
 * Composite a semi-transparent "Nodaro.ai" text watermark
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
 * The same watermark on EVERY frame of an animated GIF, which stays an
 * animated GIF: its frames, their timing and its loop are kept. sharp reads an
 * animation as its frames stacked one under another, so the mark is drawn for
 * one frame and tiled down the stack.
 */
export async function applyAnimatedGifWatermark(buffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(buffer, { animated: true }).metadata()
  const width = metadata.width ?? 512
  const frameHeight = metadata.pageHeight ?? metadata.height ?? 512
  const fontSize = Math.max(16, Math.round(width * 0.025))
  const mark = `<svg width="${width}" height="${frameHeight}">
    <text
      x="${width - 20}"
      y="${frameHeight - 20}"
      text-anchor="end"
      font-family="sans-serif"
      font-size="${fontSize}"
      fill="rgba(255,255,255,0.5)"
    >${WATERMARK_TEXT}</text>
  </svg>`
  return sharp(buffer, { animated: true })
    .composite([{ input: Buffer.from(mark), tile: true, gravity: "northwest" }])
    .gif({
      ...(metadata.loop !== undefined && { loop: metadata.loop }),
      ...(metadata.delay !== undefined && { delay: metadata.delay }),
    })
    .toBuffer()
}

/**
 * Burn a semi-transparent "Nodaro.ai" text watermark
 * into the bottom-right corner of a video using ffmpeg drawtext.
 */
export async function applyVideoWatermark(
  inputPath: string,
  outputPath: string,
  options?: { signal?: AbortSignal },
): Promise<void> {
  const args = [
    "-y",
    "-i", inputPath,
    "-vf", `drawtext=text='${WATERMARK_TEXT}':fontsize=24:fontcolor=white@0.5:x=w-tw-20:y=h-th-20`,
    ...BROWSER_SAFE_VIDEO_ARGS,
    "-c:a", "aac", "-b:a", "128k",
    outputPath,
  ]
  if (options?.signal) await runFfmpegCancellable(args, options.signal)
  else await runFfmpeg(args)
}
