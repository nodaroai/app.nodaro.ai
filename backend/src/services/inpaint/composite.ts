import sharp from "sharp"
import { IMAGE_OUTPUT_FORMAT_EXT, IMAGE_OUTPUT_FORMAT_MIME } from "@nodaro/shared/models"
import { safeFetch } from "../../lib/safe-fetch.js"
import { uploadBufferToR2 } from "../../lib/storage.js"
import { uploadJobScratchBuffer } from "../../lib/job-scratch.js"
import { sniffImageFormat } from "../../lib/image-output-store.js"
import { inpaintCompositeKey } from "../../lib/job-output-keys.js"

const WHITE_THRESHOLD = 128

/** Tight bounding box of the white (edit) region. null if the mask is empty. */
export async function maskBoundingBox(maskBuffer: Buffer): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const { data, info } = await sharp(maskBuffer).greyscale().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] >= WHITE_THRESHOLD) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** Fetch a mask URL and return the bounding box of its white (edit) region. */
export async function maskBoundingBoxFromUrl(maskUrl: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const buf = await fetchBytes(maskUrl)
  return maskBoundingBox(buf)
}

/** The files a composite can be written as. */
export type CompositeFormat = "png" | "jpeg" | "webp"

/**
 * Feather-composite the provider RESULT onto the BASE, restricted to the white
 * region of MASK: out = base·(1−M') + result·M', M' = feathered mask as alpha.
 * White = edit (matches the painter + generate-mask convention). The result is
 * resized to the base, so the output is the base's size.
 *
 * Defaults (the Generate Image inpaint): the feather is centred on the mask's
 * edge, transparency is flattened, and the file is a PNG. Options:
 *  - `featherInward`: the soft edge lies inside the white area only, so every
 *    pixel the mask leaves black is the base's own;
 *  - `keepAlpha`: the base's and the result's transparency are kept (outside
 *    the mask the base's, inside it the result's);
 *  - `format`: the file written (JPEG and WebP at quality 95).
 */
export async function compositeMaskedRegion(opts: {
  base: Buffer
  result: Buffer
  mask: Buffer
  featherSigma?: number
  featherInward?: boolean
  keepAlpha?: boolean
  format?: CompositeFormat
}): Promise<Buffer> {
  const baseMeta = await sharp(opts.base).metadata()
  const W = baseMeta.width ?? 0
  const H = baseMeta.height ?? 0
  if (!W || !H) throw new Error("compositeMaskedRegion: base image has no dimensions")

  // Mask → single-channel alpha at base dims, feathered.
  const alpha = opts.featherInward
    ? await inwardFeatheredMask(opts.mask, W, H, opts.featherSigma ?? 0)
    : await centredFeatheredMask(opts.mask, W, H, opts.featherSigma)

  const keepsAlpha = opts.keepAlpha === true &&
    (baseMeta.hasAlpha === true || (await sharp(opts.result).metadata()).hasAlpha === true)
  const out = keepsAlpha
    ? await blendKeepingAlpha(opts.base, opts.result, alpha, W, H)
    // Base (opaque) ← result (alpha = mask) via "over".
    : sharp(opts.base)
        .resize(W, H, { fit: "fill" })
        .removeAlpha()
        .composite([{ input: await resultOpaque(opts.result, alpha, W, H), blend: "over" }])
  const format = opts.format ?? "png"
  if (format === "jpeg") return (keepsAlpha ? out.flatten({ background: "#ffffff" }) : out).jpeg({ quality: 95 }).toBuffer()
  if (format === "webp") return out.webp({ quality: 95 }).toBuffer()
  return out.png().toBuffer()
}

/** The mask's grey level at W×H, feathered by a blur centred on its edge. */
async function centredFeatheredMask(mask: Buffer, W: number, H: number, featherSigma: number | undefined): Promise<Buffer> {
  let maskPipe = sharp(mask).resize(W, H, { fit: "fill" }).greyscale()
  if (featherSigma && featherSigma > 0) maskPipe = maskPipe.blur(featherSigma)
  return maskPipe.raw().toBuffer() // W*H bytes, 1 channel
}

/**
 * The grey level at or below which a mask pixel is black (kept): a mask saved
 * as a JPEG carries a little noise in its black, which would otherwise let a
 * trace of the result through where nothing was painted.
 */
const MASK_BLACK_FLOOR = 3

/**
 * The mask's grey level at W×H (its alpha ignored), with a soft edge that lies
 * INSIDE the painted area: each pixel is scaled down by how much of the black
 * area a blur brings near it, to nothing at the edge and to its own grey about
 * two sigmas in. A black pixel stays 0, so it is never touched; a grey area
 * keeps its grey; a stroke narrower than the edge is kept, only fainter.
 */
async function inwardFeatheredMask(mask: Buffer, W: number, H: number, featherSigma: number): Promise<Buffer> {
  const grey = await sharp(mask).resize(W, H, { fit: "fill" }).removeAlpha().greyscale().raw().toBuffer()
  const black = Buffer.alloc(W * H)
  for (let i = 0; i < W * H; i++) black[i] = grey[i]! <= MASK_BLACK_FLOOR ? 255 : 0
  const nearBlack = featherSigma > 0
    ? await sharp(black, { raw: { width: W, height: H, channels: 1 } })
        .blur(Math.max(0.3, featherSigma))
        .toColourspace("b-w")
        .raw()
        .toBuffer()
    : black
  const out = Buffer.alloc(W * H)
  for (let i = 0; i < W * H; i++) {
    if (black[i]) continue
    const keep = Math.max(0, 255 - 2 * nearBlack[i]!)
    out[i] = Math.round((grey[i]! * keep) / 255)
  }
  return out
}

/** The result as RGB at the base's size, the mask attached as its alpha. */
async function resultOpaque(result: Buffer, alpha: Buffer, W: number, H: number): Promise<Buffer> {
  const resultRgb = await sharp(result).resize(W, H, { fit: "fill" }).removeAlpha().toBuffer()
  return sharp(resultRgb)
    .joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer()
}

/**
 * Base and result blended channel by channel, alpha included:
 * out = base·(1−M') + result·M'. Outside the mask the base's pixels and
 * transparency, inside it the result's (a transparent result stays so).
 */
async function blendKeepingAlpha(base: Buffer, result: Buffer, alpha: Buffer, W: number, H: number): Promise<sharp.Sharp> {
  const [b, r] = await Promise.all([
    sharp(base).resize(W, H, { fit: "fill" }).ensureAlpha().raw().toBuffer(),
    sharp(result).resize(W, H, { fit: "fill" }).ensureAlpha().raw().toBuffer(),
  ])
  const out = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    const m = alpha[i]!
    for (let c = 0; c < 4; c++) {
      const k = i * 4 + c
      out[k] = Math.round((b[k]! * (255 - m) + r[k]! * m) / 255)
    }
  }
  return sharp(out, { raw: { width: W, height: H, channels: 4 } })
}

/** URL-in / R2-URL-out wrapper used by the worker. Throws a PLAIN Error on any failure. */
export async function compositeInpaint(opts: {
  baseUrl: string
  resultUrl: string
  maskUrl: string
  jobId: string
  userId?: string
  featherSigma?: number
}): Promise<string> {
  const [base, result, mask] = await Promise.all([
    fetchBytes(opts.baseUrl),
    fetchBytes(opts.resultUrl),
    fetchBytes(opts.maskUrl),
  ])
  const out = await compositeMaskedRegion({ base, result, mask, featherSigma: opts.featherSigma ?? 2 })
  return uploadBufferToR2(out, inpaintCompositeKey(opts.jobId), "image/png", opts.userId)
}

/**
 * The soft edge of a paste-back, as the sigma of its blur: a few pixels,
 * growing with the picture (a 500th of its short side, from 1 to 8), so the
 * edge looks alike at 1K and at 4K.
 */
export function maskFeatherSigma(width: number, height: number): number {
  return Math.min(8, Math.max(1, Math.min(width, height) / 500))
}

/**
 * A masked edit whose model redraws the whole picture: its result with the
 * SOURCE pasted back everywhere outside the mask, so there the delivered
 * picture is the source's own pixels (exactly so in a PNG; a JPEG or a WebP is
 * encoded once more).
 *  - The result is resized to the source first: the delivered picture is the
 *    source's size.
 *  - The soft edge lies inside the mask, a few pixels wide (`maskFeatherSigma`).
 *  - Transparency is kept, and the file is written in the result's own format.
 * A result that is not a PNG, JPEG or WebP is left as it is (`undefined`).
 * Stored in the job's scratch folder: finalize stores the delivered copy.
 * Throws a PLAIN Error on any failure, so the handler fails the job and refunds.
 */
export async function pasteSourceOutsideMask(opts: {
  sourceUrl: string
  resultUrl: string
  maskUrl: string
  jobId: string
}): Promise<string | undefined> {
  const [source, result, mask] = await Promise.all([
    fetchBytes(opts.sourceUrl),
    fetchBytes(opts.resultUrl),
    fetchBytes(opts.maskUrl),
  ])
  const format = sniffImageFormat(result)
  if (format !== "png" && format !== "jpeg" && format !== "webp") return undefined
  const meta = await sharp(source).metadata()
  if (!meta.width || !meta.height) throw new Error("pasteSourceOutsideMask: source image has no dimensions")
  const out = await compositeMaskedRegion({
    base: source,
    result,
    mask,
    featherSigma: maskFeatherSigma(meta.width, meta.height),
    featherInward: true,
    keepAlpha: true,
    format,
  })
  return uploadJobScratchBuffer(out, "mask-composite", IMAGE_OUTPUT_FORMAT_EXT[format], IMAGE_OUTPUT_FORMAT_MIME[format], opts.jobId)
}

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await safeFetch(url)
  if (!res.ok) throw new Error(`compositeInpaint: failed to fetch ${url.slice(0, 80)} (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

/** Image dimensions from a URL — reused by the worker for the prompt-tier hint. */
export async function imageDimensions(url: string): Promise<{ width: number; height: number }> {
  const buf = await fetchBytes(url)
  const meta = await sharp(buf).metadata()
  return { width: meta.width ?? 0, height: meta.height ?? 0 }
}
