/**
 * Storing the images of a run that asked for a format other than PNG (GPT
 * Image 2.6 writes JPEG, WebP, an animated GIF or an SVG): each under its own
 * extension and content type, a free account's watermark kept in its format,
 * an SVG made safe before anything is stored, and for a GIF or an SVG a PNG
 * still beside it (`thumbnailUrl`) for whatever needs a raster.
 *
 * WHY A PATH OF ITS OWN. Every other image is streamed to `images/<id>.png` as
 * `image/png` whatever its bytes are (`uploadImageMaybeWatermark`), and that
 * stays exactly so: a run that asked for no format is stored as it always was.
 * Here the file is read whole (an SVG must be, to be checked), so its format is
 * taken from its own bytes, never from what was asked or what the provider's
 * address says: what is stored is labelled as what it is.
 *
 * REFUND RULE. Fetching the provider's file and storing it are work on a result
 * the provider already delivered, so their failures are `PostProcessingError`s
 * (no refund), as on the PNG path. An SVG that cannot be made safe is refused
 * BEFORE any of that, as a plain final error, so the job fails and the run is
 * refunded: nothing was delivered that could be kept.
 */
import sharp from "sharp"
import { variantJobId } from "@nodaro/shared/workflow"
import { IMAGE_OUTPUT_FORMAT_EXT, IMAGE_OUTPUT_FORMAT_MIME, IMAGE_OUTPUT_FORMAT_VALUES, type ImageOutputFormat } from "@nodaro/shared/models"
import { safeFetch } from "./safe-fetch.js"
import { mediaObjectKey, uploadBufferToR2 } from "./storage.js"
import { runPostProcessing } from "./post-processing-error.js"
import { appendSvgWatermark, isSvgRefusedError, looksLikeSvg, sanitizeSvg, SVG_REFUSED_MESSAGE } from "./svg-sanitize.js"
import { DeterministicJobError } from "./deterministic-job-error.js"
import { getSizeLimit } from "../utils/file-validation.js"
import { applyAnimatedGifWatermark, applyImageWatermark, WATERMARK_TEXT } from "../utils/watermark.js"

/** A format stored on this path: every one but PNG. */
export type StoredImageFormat = Exclude<ImageOutputFormat, "png">

/**
 * The format a job asked for, from its recorded request (`input_data`, written
 * after the catalog snap): `undefined` for PNG or for none, which keep the PNG
 * path. The reconcile cron finalizes from the same row, so a run recovered
 * after its worker died is stored the same way.
 */
export function requestedImageFormat(inputData: Record<string, unknown> | null | undefined): StoredImageFormat | undefined {
  const format = inputData?.outputFormat
  return typeof format === "string" && format !== "png" && (IMAGE_OUTPUT_FORMAT_VALUES as readonly string[]).includes(format)
    ? (format as StoredImageFormat)
    : undefined
}

/** The format a file is, by its own signature; `undefined` for one this path does not know. */
export function sniffImageFormat(buffer: Buffer): ImageOutputFormat | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png"
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg"
  if (buffer.length >= 12 && buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return "webp"
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString("latin1", 0, 6))) return "gif"
  if (looksLikeSvg(buffer)) return "svg"
  return undefined
}

export interface StoredFormattedImages {
  /** The stored files, in the order given: the first is the job's `imageUrl`. */
  readonly urls: readonly string[]
  /** The first file's format and content type (`output_data.imageMimeType`). */
  readonly format: ImageOutputFormat
  readonly mimeType: string
  /** A PNG still of the first file when it is a GIF (its first frame) or an SVG (drawn), else none. */
  readonly thumbnailUrl?: string
}

/** The longest side of a GIF's or an SVG's PNG still. */
export const IMAGE_STILL_MAX_SIDE = 1024

interface PreparedImage {
  readonly format: ImageOutputFormat
  readonly bytes: Buffer
}

async function download(url: string): Promise<Buffer> {
  const response = await safeFetch(url, { timeoutMs: 120_000 })
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`)
  const cap = getSizeLimit("image")
  const advertised = parseInt(response.headers.get("content-length") ?? "", 10)
  if (Number.isFinite(advertised) && advertised > cap) {
    try { await response.body?.cancel() } catch { /* best effort */ }
    throw new Error(`upload-size-exceeded: Content-Length ${advertised} > cap ${cap}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > cap) throw new Error(`upload-size-exceeded: ${bytes.length} > cap ${cap}`)
  return bytes
}

/**
 * The SVG made safe, or the job refused. Outside `runPostProcessing` on
 * purpose: a refusal is not a post-processing failure, so the run is refunded.
 * It is final (`DeterministicJobError`): the queue does not run the provider
 * again for it, and its message starts with `SVG_REFUSED_MESSAGE`, which the
 * reconcile cron fails at once.
 */
async function safeSvg(bytes: Buffer): Promise<string> {
  try {
    return await sanitizeSvg(bytes)
  } catch (err) {
    if (isSvgRefusedError(err)) {
      console.warn(`[image-output-store] an SVG was refused (${(err as { reason?: unknown }).reason ?? "unknown"}): the job fails and is refunded`)
      throw new DeterministicJobError(SVG_REFUSED_MESSAGE, { cause: err })
    }
    throw err
  }
}

/** Fetch each file, read its format, and make an SVG safe (a refused one fails the job, refunded). */
async function prepare(sourceUrls: readonly string[]): Promise<PreparedImage[]> {
  const downloaded = await runPostProcessing(() => Promise.all(sourceUrls.map(download)))
  const prepared: PreparedImage[] = []
  for (const bytes of downloaded) {
    const format = sniffImageFormat(bytes) ?? "png"
    prepared.push(format === "svg" ? { format, bytes: Buffer.from(await safeSvg(bytes), "utf8") } : { format, bytes })
  }
  return prepared
}

/** The bytes to store: a free account's watermark drawn in the file's own format. */
async function watermarked(image: PreparedImage): Promise<Buffer> {
  switch (image.format) {
    case "gif":
      return applyAnimatedGifWatermark(image.bytes)
    case "svg":
      return Buffer.from(appendSvgWatermark(image.bytes.toString("utf8"), WATERMARK_TEXT), "utf8")
    default:
      // sharp writes the format it read (JPEG stays JPEG, WebP stays WebP).
      return applyImageWatermark(image.bytes)
  }
}

/**
 * Store variant `index` of the job at `images/<jobId>[-v<n>].<ext>`; answers
 * its url and the bytes stored (the still is made from those, watermark included).
 */
async function store(image: PreparedImage, jobId: string, index: number, userId: string | undefined, watermark: boolean): Promise<{ url: string; stored: PreparedImage }> {
  const bytes = watermark ? await watermarked(image) : image.bytes
  const url = await uploadBufferToR2(bytes, mediaObjectKey(variantJobId(jobId, index), "image", IMAGE_OUTPUT_FORMAT_EXT[image.format]), IMAGE_OUTPUT_FORMAT_MIME[image.format], userId)
  return { url, stored: { format: image.format, bytes } }
}

/**
 * A PNG still of a GIF (its first frame) or an SVG (drawn, at most
 * `IMAGE_STILL_MAX_SIDE` a side), stored beside it. Best effort: a still that
 * cannot be made is said in an alert and left out; the job is never failed for it.
 */
async function storeStill(image: PreparedImage, jobId: string, userId: string | undefined): Promise<string | undefined> {
  if (image.format !== "gif" && image.format !== "svg") return undefined
  try {
    const still = await sharp(image.bytes)
      .resize(IMAGE_STILL_MAX_SIDE, IMAGE_STILL_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer()
    // In the job's own key family (`<jobId>-still`), so it is expired and deleted with the job.
    return await uploadBufferToR2(still, mediaObjectKey(`${jobId}-still`, "image", "png"), "image/png", userId)
  } catch (err) {
    console.error(`[ALERT] [image-output-store] job ${jobId}: no PNG still of its ${image.format}, the job keeps its file without one:`, err)
    return undefined
  }
}

/**
 * Store a run's images in the format their bytes are, the first at
 * `images/<jobId>.<ext>` and each variant at `images/<jobId>-v<n>.<ext>`.
 */
export async function storeFormattedImages(opts: {
  readonly sourceUrls: readonly string[]
  readonly jobId: string
  readonly userId: string | undefined
  readonly watermark: boolean
}): Promise<StoredFormattedImages> {
  const { jobId, userId, watermark } = opts
  const prepared = await prepare(opts.sourceUrls)
  const first = prepared[0]
  if (!first) throw new Error(`[image-output-store] job ${jobId}: no image to store`)
  return runPostProcessing(async () => {
    const stored = await Promise.all(
      prepared.map((image, i) => store(image, jobId, i, userId, watermark)),
    )
    const thumbnailUrl = await storeStill(stored[0]!.stored, jobId, userId)
    return {
      urls: stored.map((s) => s.url),
      format: first.format,
      mimeType: IMAGE_OUTPUT_FORMAT_MIME[first.format],
      ...(thumbnailUrl !== undefined && { thumbnailUrl }),
    }
  })
}
