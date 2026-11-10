/**
 * A GIF or an SVG handed to an image model as an INPUT becomes a PNG first.
 *
 * GPT Image 2.6 can write an animated GIF or an SVG, and a canvas wires that
 * result into the next image node like any picture. Image models take still
 * rasters only (KIE's image-to-image: jpeg, png, webp; Replicate's models read
 * a raster), so a GIF is sent as its first frame and an SVG drawn. Done once,
 * here, for every image provider (the router's `generateImage` and
 * `editImage`), before the provider call, so a failure is a plain error and
 * the run is refunded.
 *
 * Which inputs: an http(s) address whose path ends in `.gif` or `.svg`, the
 * extensions the platform stores those outputs under. Its bytes decide: a
 * file that is not really a GIF or an SVG is sent as it is. Any other input is
 * not read at all, so no other run pays for this. (KIE's own input step,
 * `ensureImageForProvider`, still re-encodes a GIF or SVG it meets under
 * another name.)
 */
import sharp from "sharp"
import { fetchOwnMedia } from "./fetch-own-media.js"
import { uploadJobScratchBuffer } from "./job-scratch.js"
import { looksLikeSvg, sanitizeSvg } from "./svg-sanitize.js"

/** The shortest long side an SVG is drawn at, so a small viewBox is not sent as a thumbnail. */
export const SVG_INPUT_MIN_SIDE = 1024
/** The longest side an SVG is drawn at. */
export const SVG_INPUT_MAX_SIDE = 4096

/** True for an http(s) address whose path names a GIF or an SVG. */
export function namesGifOrSvg(url: unknown): url is string {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false
  try {
    return /\.(gif|svg)$/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/** The density (DPI) that draws an SVG of `longSide` user units at no less than the minimum side, no more than the maximum. */
function svgDensity(longSide: number | undefined): number {
  if (!longSide || longSide <= 0) return 72
  const side = Math.min(Math.max(longSide, SVG_INPUT_MIN_SIDE), SVG_INPUT_MAX_SIDE)
  return (72 * side) / longSide
}

/** A PNG of the GIF's first frame or of the drawn SVG; `undefined` when the bytes are neither. */
export async function stillPngOf(bytes: Buffer): Promise<Buffer | undefined> {
  if (looksLikeSvg(bytes)) {
    // Made safe first, whoever wrote it: nothing it names outside itself is ever fetched.
    const safe = Buffer.from(await sanitizeSvg(bytes), "utf8")
    const meta = await sharp(safe).metadata()
    const density = svgDensity(Math.max(meta.width ?? 0, meta.height ?? 0))
    return sharp(safe, { density }).png().toBuffer()
  }
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString("latin1", 0, 6))) {
    // sharp reads a GIF's first frame unless asked for every page.
    return sharp(bytes).png().toBuffer()
  }
  return undefined
}

/** One input as a still: the address itself, or a PNG of it in the running job's scratch folder. */
export async function stillInputImage(url: string): Promise<string> {
  if (!namesGifOrSvg(url)) return url
  const res = await fetchOwnMedia(url, { timeoutMs: 30_000 })
  if (!res.ok) throw new Error(`An input image (a GIF or an SVG) could not be downloaded: HTTP ${res.status}.`)
  const bytes = Buffer.from(await res.arrayBuffer())
  let still: Buffer | undefined
  try {
    still = await stillPngOf(bytes)
  } catch {
    throw new Error("An input image (a GIF or an SVG) could not be read.")
  }
  if (!still) return url
  // A provider input: the running job's scratch folder, emptied when the job ends.
  return uploadJobScratchBuffer(still, "still-input", "png", "image/png")
}

/** Every input as a still (see `stillInputImage`); `undefined` stays `undefined`. */
export async function stillInputImages(urls: readonly string[] | undefined): Promise<string[] | undefined> {
  if (!urls) return undefined
  if (!urls.some(namesGifOrSvg)) return [...urls]
  return Promise.all(urls.map((url) => stillInputImage(url)))
}
