import sharp from "sharp"

/**
 * Whether a picture has at least one pixel that is not fully opaque. An alpha
 * channel alone is not transparency: a PNG saved with one, every pixel at 255,
 * is an opaque picture.
 */
export async function hasTransparentPixels(image: Buffer): Promise<boolean> {
  const pipeline = sharp(image)
  const meta = await pipeline.metadata()
  if (!meta.hasAlpha) return false
  const { channels } = await pipeline.stats()
  const alpha = channels[channels.length - 1]
  return alpha !== undefined && alpha.min < 255
}
