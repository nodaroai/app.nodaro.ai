/**
 * Does an image file carry anything besides its pixels?
 *
 * A reference image handed to a model must be just a picture. Files from image
 * generators commonly embed Content Credentials (a C2PA manifest: a PNG `caBX`
 * chunk, a JPEG APP11 JUMBF box) naming the tool that made them, and a model
 * can refuse an input because of it. EXIF, XMP, IPTC and text chunks are the
 * same class: data the provider never needs.
 *
 * The check is an ALLOWLIST of the container structures that describe the
 * image itself (pixels, palette, transparency, colour). Anything else — a
 * metadata chunk, a segment type we do not know, a file we cannot walk — counts
 * as metadata, so a new kind of embedded data is stripped by default rather
 * than slipping through until someone adds it to a list.
 *
 * Pure: bytes in, boolean out. `ensureImageForProvider` (providers/kie/video.ts)
 * re-encodes through sharp, which writes none of it, whenever this says yes.
 */

/** PNG chunks that describe the image. Everything else (tEXt, zTXt, iTXt,
 *  eXIf, tIME, caBX, APNG's acTL/fcTL/fdAT, private chunks) is stripped. */
const PNG_IMAGE_CHUNKS = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "bKGD", "pHYs",
])

/** WebP RIFF chunks that describe the image. EXIF and XMP are stripped. */
const WEBP_IMAGE_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP", "ANIM", "ANMF"])

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function pngHasMetadata(buf: Buffer): boolean {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return true
  let offset = 8
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString("latin1", offset + 4, offset + 8)
    if (!PNG_IMAGE_CHUNKS.has(type)) return true
    if (type === "IEND") return offset + 12 < buf.length // trailing bytes after IEND
    offset += 12 + length
  }
  return true // no IEND: not a file we can vouch for
}

function jpegHasMetadata(buf: Buffer): boolean {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return true
  let offset = 2
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return true
    const marker = buf[offset + 1]!
    // Fill bytes before a marker.
    if (marker === 0xff) {
      offset += 1
      continue
    }
    // Start of scan: the header is over; metadata only lives before it.
    if (marker === 0xda) return false
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = buf.readUInt16BE(offset + 2)
    if (length < 2) return true
    const payload = buf.subarray(offset + 4, offset + 2 + length)
    if (marker >= 0xe0 && marker <= 0xef) {
      const app = marker - 0xe0
      const id = payload.toString("latin1", 0, 14)
      const allowed =
        (app === 0 && (id.startsWith("JFIF\0") || id.startsWith("JFXX\0"))) ||
        (app === 2 && id.startsWith("ICC_PROFILE\0")) ||
        (app === 14 && id.startsWith("Adobe")) // colour transform flag: needed to decode CMYK/YCCK
      if (!allowed) return true // APP1 EXIF/XMP, APP11 JUMBF/C2PA, APP13 IPTC, …
    } else if (marker === 0xfe) {
      return true // COM
    }
    offset += 2 + length
  }
  return true // never reached a scan: not a file we can vouch for
}

function webpHasMetadata(buf: Buffer): boolean {
  if (buf.length < 12 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") {
    return true
  }
  let offset = 12
  while (offset + 8 <= buf.length) {
    const type = buf.toString("latin1", offset, offset + 4)
    if (!WEBP_IMAGE_CHUNKS.has(type)) return true
    const size = buf.readUInt32LE(offset + 4)
    offset += 8 + size + (size % 2)
  }
  return false
}

/**
 * True when `buffer` (of the format sharp reported) carries anything the
 * allowlist above does not recognise as image data. A format without a walker
 * here counts as metadata-bearing: re-encoding it is always safe.
 */
export function imageHasMetadata(buffer: Buffer, format: string): boolean {
  switch (format) {
    case "png":
      return pngHasMetadata(buffer)
    case "jpeg":
      return jpegHasMetadata(buffer)
    case "webp":
      return webpHasMetadata(buffer)
    default:
      return true
  }
}
