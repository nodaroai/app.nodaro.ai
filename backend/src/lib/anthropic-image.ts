import sharp from "sharp"
import { safeFetch } from "./safe-fetch.js"
import type { LlmContentBlock } from "./llm-client.js"

// Anthropic rejects any single base64 image whose encoded payload exceeds 5 MB
// (5_242_880 bytes). base64 inflates raw bytes by 4/3, so the raw image must stay
// under ~3.9 MB; we re-encode past a conservative 3.5 MB budget to leave headroom.
const ANTHROPIC_B64_RAW_BUDGET = 3_500_000
// Sonnet/Haiku downscale anything past a 1568px long edge internally, so capping
// there before sending costs the model no fidelity it would otherwise have used.
const ANTHROPIC_NATIVE_LONG_EDGE = 1568

/** Fetch an image and return an Anthropic-ready content block. Downscales past
 *  a 3.5 MB raw budget so the base64 payload clears Anthropic's 5 MB cap;
 *  falls back to URL pass-through on any error. */
export async function prefetchAsBase64(url: string): Promise<LlmContentBlock> {
  try {
    const r = await safeFetch(url, { timeoutMs: 30_000 })
    if (!r.ok) return { type: "image", url }

    const buf = Buffer.from(await r.arrayBuffer())
    const mediaType =
      (r.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim()

    // Small enough to send verbatim — preserve the original encoding.
    if (buf.byteLength <= ANTHROPIC_B64_RAW_BUDGET) {
      return { type: "image_base64", mediaType, data: buf.toString("base64") }
    }

    // Oversized: downscale to the model's native long edge and re-encode as JPEG
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
  } catch {
    // Network error, SSRF block, or an undecodable image → URL pass-through.
    return { type: "image", url }
  }
}
