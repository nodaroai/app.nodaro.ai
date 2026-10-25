/**
 * HEIF-family images (AVIF and HEIC) that sharp cannot decode, decoded by
 * ffmpeg instead.
 *
 * sharp's prebuilt libvips carries libheif with ONLY an 8-bit AV1 decoder
 * (aom built without high bit depth, and no HEVC at all). So it reads the
 * header of every HEIF file — `metadata()` succeeds, reporting `format: "heif"`
 * — and then fails on the pixels of:
 *   - every 10-bit AVIF ("heif: Invalid input: Unspecified: Bitstream not
 *     supported by this decoder (2.0)", preceded by "bad seek to <n>" lines),
 *   - every HEIC ("heif: Error while loading plugin: Support for this
 *     compression format has not been built in").
 * Production Cast Swap run 30bdae5f (2026-10-25) died on a 10-bit AVIF upload
 * this way, and every HEIC transcode at upload has been a 400.
 *
 * The pinned ffmpeg builds dav1d (AV1) and decodes HEVC, and it assembles a
 * tile grid (an iPhone photo is 512 px tiles) and applies `irot` the same way
 * libheif does. It decodes the colour image only: an alpha plane is dropped,
 * so the fallback flattens transparency — sharp, when it CAN decode, keeps it.
 *
 * `withHeifDecodeFallback` runs the caller's sharp work first and asks ffmpeg
 * only when that work threw on a HEIF-family input, so every image sharp
 * already handled takes exactly the path it took before.
 */
// @reads-none reads only the image its caller passes and the decode it writes to the OS temp dir
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import sharp from "sharp"
import { runFfmpeg } from "../providers/video/ffmpeg-utils.js"

/** One still image; a stuck decode must not hold its ffmpeg slot for long. */
const HEIF_DECODE_TIMEOUT_MS = 60_000

const HEIF_FAMILY_MIMES: ReadonlySet<string> = new Set(["image/heic", "image/heif", "image/avif"])

/** The upload types `transcodeHeifForStorage` converts before storing. */
export function isHeifFamilyMime(mime: string): boolean {
  return HEIF_FAMILY_MIMES.has(mime)
}

/** True when sharp reads the bytes as a HEIF container (AVIF or HEIC). */
export async function isHeifFamily(buffer: Buffer): Promise<boolean> {
  try {
    return (await sharp(buffer).metadata()).format === "heif"
  } catch {
    return false
  }
}

/**
 * Decode the primary image of a HEIF-family file to PNG with ffmpeg (16-bit
 * when the source is deeper than 8 bits, so nothing is lost before the
 * caller's own encode). Throws when ffmpeg fails, or when the picture it
 * produced is not the size the container declares — a decode that kept one
 * tile of a grid, or a thumbnail, must never pass for the image.
 */
export async function decodeHeifWithFfmpeg(buffer: Buffer): Promise<Buffer> {
  const declared = await sharp(buffer).metadata()
  const workDir = join(tmpdir(), `heif-decode-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })
  try {
    const inPath = join(workDir, "in.heif")
    const outPath = join(workDir, "out.png")
    await fs.writeFile(inPath, buffer)
    await runFfmpeg(
      ["-v", "error", "-i", inPath, "-frames:v", "1", "-c:v", "png", "-f", "image2", "-y", outPath],
      HEIF_DECODE_TIMEOUT_MS,
    )
    const png = await fs.readFile(outPath)
    const decoded = await sharp(png).metadata()
    const w = declared.width ?? 0
    const h = declared.height ?? 0
    const sameSize = (decoded.width === w && decoded.height === h) || (decoded.width === h && decoded.height === w)
    if (!w || !h || !sameSize) {
      throw new Error(`HEIF decode produced ${decoded.width}×${decoded.height}, the file declares ${w}×${h}`)
    }
    return png
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Run `work` on the image; when it throws on a HEIF-family input, run it again
 * on ffmpeg's PNG decode of that input. Any other failure — and a failure of
 * the retry — is thrown as it was.
 */
export async function withHeifDecodeFallback<T>(
  buffer: Buffer,
  work: (input: Buffer) => Promise<T>,
): Promise<T> {
  try {
    return await work(buffer)
  } catch (err) {
    if (!(await isHeifFamily(buffer))) throw err
    return work(await decodeHeifWithFfmpeg(buffer))
  }
}

export type StoredImageTranscode = { buffer: Buffer; mime: "image/jpeg" | "image/png"; ext: "jpg" | "png" }

/**
 * A HEIF-family upload as the file we store: PNG when the decoded image has
 * transparency (a cutout keeps its alpha), JPEG otherwise. AVIF and HEIC
 * render in few browsers and no KIE image lane accepts either, so they are
 * converted once, at ingestion, instead of on every provider call.
 */
export async function transcodeHeifForStorage(buffer: Buffer): Promise<StoredImageTranscode> {
  return withHeifDecodeFallback(buffer, async (input) => {
    const { hasAlpha } = await sharp(input).metadata()
    if (hasAlpha) {
      return { buffer: await sharp(input).png({ compressionLevel: 9 }).toBuffer(), mime: "image/png", ext: "png" }
    }
    return { buffer: await sharp(input).jpeg({ quality: 90, mozjpeg: true }).toBuffer(), mime: "image/jpeg", ext: "jpg" }
  })
}
