import sharp from "sharp"
import { safeFetch } from "./safe-fetch.js"
import type { LlmContentBlock } from "./llm-client.js"

/**
 * The four image formats the Anthropic API accepts. Anything else — AVIF,
 * HEIC, TIFF, BMP, SVG — is rejected with
 * `image.source.…: The file format is invalid or unsupported`, whether it
 * arrives as base64 or as a URL the API fetches itself.
 *
 * This platform ACCEPTS more than that on upload (`routes/upload.ts` allows
 * `image/avif`; only HEIC/HEIF is transcoded), so "a valid image here" and "a
 * valid image to Claude" are two different sets and every vision lane has to
 * cross that gap deliberately. This constant is where the gap is named, once.
 */
export const ANTHROPIC_IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
])

/** Extension → media type, for the lanes that only ever see a URL. Covers the
 *  supported four AND the unsupported formats we can store, so an unknown
 *  extension stays unknown rather than being guessed at. */
const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", heic: "image/heic", heif: "image/heic", tif: "image/tiff", tiff: "image/tiff",
  bmp: "image/bmp", svg: "image/svg+xml",
}

/** The media type a URL's extension implies, or undefined when it implies none. */
export function mediaTypeFromUrl(url: string): string | undefined {
  const path = url.split("?")[0]?.split("#")[0] ?? url
  const dot = path.lastIndexOf(".")
  if (dot === -1) return undefined
  return EXTENSION_MEDIA_TYPES[path.slice(dot + 1).toLowerCase()]
}

/**
 * Would Anthropic accept this image?
 *
 * Declared type first (an upload row knows its own `mime_type`), then the
 * URL's extension. When NEITHER says anything the answer is yes: an unknown
 * format is Anthropic's call to make, and refusing it here would drop images
 * that work today (job outputs served from paths with no extension).
 */
export function anthropicVisionAccepts(url: string, mediaType?: string | null): boolean {
  // `image/jpg` is not a registered type but real uploaders send it; reading it
  // as "not JPEG" would drop an image Claude reads fine.
  const declared = mediaType?.split(";")[0]?.trim().toLowerCase().replace(/^image\/jpg$/, "image/jpeg")
  if (declared && declared.startsWith("image/")) return ANTHROPIC_IMAGE_MEDIA_TYPES.has(declared)
  const implied = mediaTypeFromUrl(url)
  return implied === undefined || ANTHROPIC_IMAGE_MEDIA_TYPES.has(implied)
}

// Anthropic rejects any single base64 image whose encoded payload exceeds 5 MB
// (5_242_880 bytes). base64 inflates raw bytes by 4/3, so the raw image must stay
// under ~3.9 MB; we re-encode past a conservative 3.5 MB budget to leave headroom.
const ANTHROPIC_B64_RAW_BUDGET = 3_500_000
// Sonnet/Haiku downscale anything past a 1568px long edge internally, so capping
// there before sending costs the model no fidelity it would otherwise have used.
const ANTHROPIC_NATIVE_LONG_EDGE = 1568

/** Fetch an image and return an Anthropic-ready content block. Re-encodes any
 *  format Anthropic does not accept (AVIF, HEIC, TIFF, BMP), downscales past a
 *  3.5 MB raw budget so the base64 payload clears Anthropic's 5 MB cap; falls
 *  back to URL pass-through on any error. The block it returns NEVER carries a
 *  media type outside {@link ANTHROPIC_IMAGE_MEDIA_TYPES}.
 *
 *  Sized for Anthropic, so a KIE OpenAI-shaped lane may shrink these bytes
 *  further on its own way out (`inlineImagesForKie`, lib/kie-inline-image.ts):
 *  KIE's inline limit is lower, and those lanes take no image URL at all.
 *
 *  `signal` is the caller's cancel: it ends the fetch at once, and a cancel
 *  rejects with its reason rather than falling back to the URL — a cancelled
 *  call must stop, not go on with a URL block. */
export async function prefetchAsBase64(url: string, signal?: AbortSignal): Promise<LlmContentBlock> {
  signal?.throwIfAborted()
  try {
    const r = await safeFetch(url, signal ? { timeoutMs: 30_000, signal } : { timeoutMs: 30_000 })
    if (!r.ok) return { type: "image", url }

    const buf = Buffer.from(await r.arrayBuffer())
    const mediaType =
      (r.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim()

    // Small enough to send verbatim — preserve the original encoding, but only
    // when Anthropic can read it. An AVIF upload sent verbatim is a 400 on the
    // whole request ("The file format is invalid or unsupported"), so an
    // unsupported format falls through to the re-encode below regardless of
    // size.
    if (buf.byteLength <= ANTHROPIC_B64_RAW_BUDGET && ANTHROPIC_IMAGE_MEDIA_TYPES.has(mediaType)) {
      return { type: "image_base64", mediaType, data: buf.toString("base64") }
    }

    // Oversized or unreadable-by-Claude: downscale to the model's native long edge and re-encode as JPEG
    // so the base64 payload clears Anthropic's 5 MB-per-image cap. Flatten any
    // alpha onto white so transparent PNGs don't pick up a black background.
    const jpeg = await sharp(buf)
      .rotate() // honor EXIF orientation before metadata is dropped
      .resize(ANTHROPIC_NATIVE_LONG_EDGE, ANTHROPIC_NATIVE_LONG_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90 })
      .toBuffer()
    if (jpeg.byteLength <= ANTHROPIC_B64_RAW_BUDGET) {
      return { type: "image_base64", mediaType: "image/jpeg", data: jpeg.toString("base64") }
    }
    // Pathologically dense even after downscale — let Claude fetch the URL itself
    // (no base64 size cap on URL sources) rather than send an oversized payload.
    return { type: "image", url }
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err
    // Network error, SSRF block, or an undecodable image → URL pass-through.
    return { type: "image", url }
  }
}
