/**
 * A picture over a step's pixel cap is scaled down to fit it, not refused.
 *
 * Several steps decode a picture under a pixel cap (`limitInputPixels`) that
 * guards memory and decompression bombs: face detection (50 MP), Image
 * Overlay and video overlays (8192 x 8192). Models now return pictures near
 * or past them (Kling Image 4.0's 8K is about 67 MP), so a step's cap would
 * refuse one of the platform's own results. Such a picture is decoded ONCE,
 * under a higher ceiling ({@link DOWNSCALE_INPUT_PIXEL_CEILING}), scaled
 * (upright, by its EXIF orientation) to the largest size within the step's
 * cap, and handed on; the step then decodes it under its own cap as before.
 * A picture past the ceiling is still refused by the step, as a bomb.
 */
import sharp from "sharp"

/**
 * The most pixels decoded in order to scale a picture down: above the
 * largest picture any model returns (Kling Image 4.0 at 8K, about 67 MP at
 * every shape it renders, computed from the measured 10880 x 6144 at 16:9),
 * with room to spare, and below sharp's own default cap.
 */
export const DOWNSCALE_INPUT_PIXEL_CEILING = 100_000_000

/** The size within `maxPixels` (area) and `maxEdge` (each side), the shape kept, never enlarged. */
export function sizeWithinPixels(width: number, height: number, maxPixels: number, maxEdge = Number.POSITIVE_INFINITY): { width: number; height: number } {
  if (width * height <= maxPixels && Math.max(width, height) <= maxEdge) return { width, height }
  const scale = Math.min(Math.sqrt(maxPixels / (width * height)), maxEdge / Math.max(width, height), 1)
  let w = Math.max(1, Math.floor(width * scale))
  let h = Math.max(1, Math.floor(height * scale))
  while (w * h > maxPixels) {
    if (w >= h) w--
    else h--
  }
  return { width: w, height: h }
}

/**
 * `bytes` as is when the picture is within `maxPixels` and `maxEdge` (or cannot be read: the
 * step's own decode answers that); else the picture scaled down to fit, as a
 * PNG when it has an alpha channel and a JPEG (quality 95) otherwise.
 */
export async function fitImageUnderPixels(bytes: Buffer, maxPixels: number, maxEdge = Number.POSITIVE_INFINITY): Promise<Buffer> {
  let meta: sharp.Metadata
  try {
    meta = await sharp(bytes, { limitInputPixels: DOWNSCALE_INPUT_PIXEL_CEILING }).metadata()
  } catch {
    return bytes
  }
  const width = meta.autoOrient?.width ?? meta.width
  const height = meta.autoOrient?.height ?? meta.height
  // An animated picture (several frames) is left exactly as it is: a scale
  // down would keep one frame. Its caller's own limits apply to it as before.
  // The library counts no frames for an animated PNG: its `acTL` chunk does.
  if (!width || !height || meta.format === "svg" || (meta.pages ?? 1) > 1 || isAnimatedPng(bytes)) return bytes
  if (width * height <= maxPixels && Math.max(width, height) <= maxEdge) return bytes
  const size = sizeWithinPixels(width, height, maxPixels, maxEdge)
  const pipeline = sharp(bytes, { limitInputPixels: DOWNSCALE_INPUT_PIXEL_CEILING })
    .rotate()
    .resize(size.width, size.height, { fit: "fill" })
  return meta.hasAlpha ? pipeline.png().toBuffer() : pipeline.jpeg({ quality: 95 }).toBuffer()
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * True for an animated PNG: a PNG whose chunks, before its first image data
 * (`IDAT`), carry an animation control chunk (`acTL`). Read chunk by chunk,
 * so bytes inside compressed data are never mistaken for one.
 */
export function isAnimatedPng(bytes: Buffer): boolean {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return false
  let at = 8
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString("latin1", at + 4, at + 8)
    if (type === "acTL") return true
    if (type === "IDAT" || type === "IEND") return false
    at += 12 + length
  }
  return false
}
