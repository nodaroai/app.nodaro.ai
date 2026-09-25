import sharp from "sharp"
import { OVERLAY_PIXEL_LIMIT } from "../image/overlay-contract.js"

/**
 * Video Overlay's ONE raster step between a downloaded layer image and ffmpeg
 * (decision D1). Decode once — page 0 only, so an animated WebP / APNG
 * contributes its first frame — apply the EXIF orientation physically (JPEG
 * AND WebP; the ffmpeg pin auto-orients only JPEG), resize to exactly the size
 * the layer is drawn at on the output canvas, and write a flat 8-bit sRGB RGBA
 * PNG. ffmpeg then reads one small input kind: it never re-decodes a large
 * source per frame (the `-loop 1` CPU/memory bomb), never sees an animation,
 * never sees an orientation tag. `contain`: the drawn rect already has the
 * image's aspect, so `fill` is exact; `cover`: the drawn rect is the box, the
 * image is scaled to cover it and centre-cropped.
 */
export async function prefitVideoOverlayLayer(
  src: string,
  dest: string,
  size: { readonly width: number; readonly height: number },
  fit: "contain" | "cover",
): Promise<{ width: number; height: number }> {
  const info = await sharp(src, { limitInputPixels: OVERLAY_PIXEL_LIMIT })
    .rotate()
    .resize(size.width, size.height, fit === "cover" ? { fit: "cover", position: "centre" } : { fit: "fill" })
    .toColourspace("srgb")
    .ensureAlpha()
    .png()
    .toFile(dest)
  return { width: info.width, height: info.height }
}
