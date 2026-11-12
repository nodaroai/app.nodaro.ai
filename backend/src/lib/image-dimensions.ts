/**
 * An image's pixel size, read from its own bytes — THE reader every image size
 * the platform reports comes from (decided 2026-10-15).
 *
 * Its callers:
 *  - the image-to-image "auto" ratio (`image-source-size.ts`), which reads the
 *    first bytes of a SOURCE image;
 *  - the storage writers (`lib/storage.ts`), which measure every image they
 *    store and note the size here, by the url they return — and drop the note
 *    on any write they did not measure;
 *  - the job-output stamp (`job-output-dimensions.ts`), which puts the size of
 *    the image a job published on its `output_data` — from the size noted at
 *    store time when this process stored it, otherwise by reading the stored
 *    file's first bytes.
 *
 * The size is the DISPLAYED one: EXIF orientation applied, so a photo stored
 * 3024×4032 with a quarter-turn tag reads 4032×3024, as a browser shows it. A
 * multi-page file (GIF, animated WebP) reads as one page, and an SVG as its
 * root's width and height (else its viewBox).
 *
 * Never throws: a format sharp cannot read, or a header the bytes do not
 * reach, answers `undefined`.
 */
import sharp from "sharp"
import { looksLikeSvg, svgIntrinsicSize } from "./svg-sanitize.js"

export interface ImageDimensions {
  readonly width: number
  readonly height: number
}

/** First decode attempt on a partial read: covers PNG / WebP / GIF / AVIF headers and most JPEGs (a WebP's from its own header). */
export const IMAGE_HEADER_FIRST_READ_BYTES = 64 * 1024

/**
 * The most a partial read ever takes. A phone JPEG can carry an EXIF
 * thumbnail, an ICC profile and XMP ahead of its frame header, which can push
 * that header past the first read.
 */
export const IMAGE_HEADER_MAX_READ_BYTES = 512 * 1024

function isPixelSize(width: unknown, height: unknown): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && (width as number) > 0 && (height as number) > 0
}

/** VP8X feature flag: the file carries EXIF, which may hold an orientation. */
const WEBP_VP8X_EXIF_FLAG = 0x08

/**
 * A WebP's pixel size read from its first 30 bytes, for the leading bytes of a
 * file sharp will not open (its WebP loader needs the whole file). The RIFF
 * header names one of three first chunks, each of which states the size:
 *  - `VP8 ` (lossy): the key frame's 14-bit width and height after its start code;
 *  - `VP8L` (lossless): width − 1 and height − 1, 14 bits each, after its signature;
 *  - `VP8X` (extended): the canvas width − 1 and height − 1, 24 bits each.
 * A `VP8X` file that carries EXIF may be displayed turned, which the header
 * cannot tell, so it answers `undefined` and the size stays unread.
 */
export function webpHeaderDimensions(bytes: Buffer): ImageDimensions | undefined {
  if (bytes.length < 30) return undefined
  if (bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WEBP") return undefined
  const chunk = bytes.toString("latin1", 12, 16)
  let width: number
  let height: number
  if (chunk === "VP8 ") {
    // Frame tag (3 bytes) at 20, then the start code 9d 01 2a.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return undefined
    width = bytes.readUInt16LE(26) & 0x3fff
    height = bytes.readUInt16LE(28) & 0x3fff
  } else if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return undefined
    const bits = bytes.readUInt32LE(21)
    width = (bits & 0x3fff) + 1
    height = ((bits >>> 14) & 0x3fff) + 1
  } else if (chunk === "VP8X") {
    if ((bytes[20] & WEBP_VP8X_EXIF_FLAG) !== 0) return undefined
    width = bytes.readUIntLE(24, 3) + 1
    height = bytes.readUIntLE(27, 3) + 1
  } else {
    return undefined
  }
  return isPixelSize(width, height) ? { width, height } : undefined
}

/**
 * The displayed pixel size of an image: `input` is its bytes (the whole file,
 * or only its leading bytes) or the path of a local file. `undefined` when it
 * cannot be read.
 */
export async function imageDimensionsOf(input: Buffer | string): Promise<ImageDimensions | undefined> {
  if (typeof input !== "string" && input.length === 0) return undefined
  // An SVG's size is its root's width and height, else its viewBox: read from
  // the text, so the leading bytes of a large drawing are enough (sharp needs
  // the whole document) and nothing is drawn to measure it.
  if (typeof input !== "string" && looksLikeSvg(input)) {
    const size = svgIntrinsicSize(input.toString("utf8"))
    return size && isPixelSize(size.width, size.height) ? size : undefined
  }
  try {
    const meta = await sharp(input).metadata()
    const width = meta.autoOrient?.width ?? meta.width
    const height = meta.autoOrient?.height ?? meta.height
    return isPixelSize(width, height) ? { width, height } : undefined
  } catch {
    // Not enough of the header, or not a format sharp reads. sharp opens a
    // WebP only whole, so the leading bytes of one are read from its header.
    return typeof input === "string" ? undefined : webpHeaderDimensions(input)
  }
}

/** How many stored-image sizes this process keeps (each is read moments after it is noted). */
export const STORED_IMAGE_DIMENSIONS_MAX = 1_000

/**
 * The sizes this process measured as it stored images, by the url the storage
 * writer returned. A job's output is completed by the same process that stored
 * it, moments later, so the stamp finds its size here without reading the file
 * back. `null` records a store whose bytes hold no readable size: reading the
 * file back would read the same bytes for nothing. Bounded, oldest first out;
 * a miss only means the stamp reads the stored file instead.
 */
const storedSizes = new Map<string, ImageDimensions | null>()

/**
 * Measure what was just stored at `url` (its bytes, or the local file it was
 * stored from) and remember the size — or that it has none (`null`). It
 * replaces whatever was noted for that url before: a deterministic key can be
 * written again, and a stale size must never outlive the bytes it described.
 */
export async function noteStoredImage(url: string, stored: Buffer | string): Promise<void> {
  const size = (await imageDimensionsOf(stored)) ?? null
  storedSizes.delete(url)
  if (storedSizes.size >= STORED_IMAGE_DIMENSIONS_MAX) {
    const oldest = storedSizes.keys().next().value
    if (oldest !== undefined) storedSizes.delete(oldest)
  }
  storedSizes.set(url, size)
}

/** Drop what was noted for `url` — a writer that stored new bytes there without measuring them. */
export function forgetStoredImage(url: string): void {
  storedSizes.delete(url)
}

/**
 * What this process noted when it stored `url`: its size, `null` when the
 * stored bytes hold no readable size, `undefined` when nothing was noted.
 */
export function storedImageDimensions(url: string): ImageDimensions | null | undefined {
  return storedSizes.get(url)
}

/** Clears every noted size — for tests. */
export function forgetStoredImageDimensions(): void {
  storedSizes.clear()
}
