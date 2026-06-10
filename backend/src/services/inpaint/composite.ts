import sharp from "sharp"
import { safeFetch } from "../../lib/safe-fetch.js"
import { uploadBufferToR2 } from "../../lib/storage.js"

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

/**
 * Feather-composite the provider RESULT onto the BASE, restricted to the white
 * region of MASK: out = base·(1−M') + result·M', M' = feathered mask as alpha.
 * White = edit (matches the painter + generate-mask convention). Returns PNG bytes.
 */
export async function compositeMaskedRegion(opts: {
  base: Buffer
  result: Buffer
  mask: Buffer
  featherSigma?: number
}): Promise<Buffer> {
  const baseMeta = await sharp(opts.base).metadata()
  const W = baseMeta.width ?? 0
  const H = baseMeta.height ?? 0
  if (!W || !H) throw new Error("compositeMaskedRegion: base image has no dimensions")

  // Mask → single-channel alpha at base dims, optionally feathered.
  let maskPipe = sharp(opts.mask).resize(W, H, { fit: "fill" }).greyscale()
  if (opts.featherSigma && opts.featherSigma > 0) maskPipe = maskPipe.blur(opts.featherSigma)
  const alpha = await maskPipe.raw().toBuffer() // W*H bytes, 1 channel

  // Result → RGB at base dims, then attach the mask as its alpha channel.
  const resultRgb = await sharp(opts.result).resize(W, H, { fit: "fill" }).removeAlpha().toBuffer()
  const resultRgba = await sharp(resultRgb)
    .joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer()

  // Base (opaque) ← result (alpha = mask) via "over".
  return sharp(opts.base)
    .resize(W, H, { fit: "fill" })
    .removeAlpha()
    .composite([{ input: resultRgba, blend: "over" }])
    .png()
    .toBuffer()
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
  const key = `inpaint/${opts.jobId}.png`
  return uploadBufferToR2(out, key, "image/png", opts.userId)
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
