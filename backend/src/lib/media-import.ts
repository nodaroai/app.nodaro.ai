import { randomUUID } from "node:crypto"
import sharp from "sharp"
import { safeFetch } from "./safe-fetch.js"
import { supabase } from "./supabase.js"
import { uploadBufferToR2 } from "./storage.js"
import {
  checkStorageQuota,
  refundStorage,
  reserveStorageIfWithinLimit,
} from "../utils/file-validation.js"
import { processImage } from "../utils/thumbnail.js"

/**
 * Server-side import of a remote IMAGE into the caller's storage — the
 * missing half of the upload pipeline for URL inputs. Client apps can't read
 * a cross-origin image's pixels (canvas taint), so anything that needs to
 * EDIT a linked image (person.nodaro.ai's crop-before-analyze) must first
 * land it on our R2, which serves CORS. This does exactly that, mirroring
 * `POST /v1/upload`'s semantics: same atomic storage reservation, same R2 key
 * shape, same asset record, same response fields.
 *
 * Security posture (the reason this lives server-side at all):
 *   - the route boundary validates with `safeUrlSchema` (syntactic gate);
 *   - the fetch goes through `safeFetch` (resolved-IP validation per hop —
 *     the authoritative SSRF gate);
 *   - the body is read with a HARD byte cap, aborting mid-stream on overflow
 *     (a Content-Length header is advisory and attacker-controlled);
 *   - the bytes must DECODE as an image (sharp metadata is the gate — the
 *     Content-Type header is only a fast-fail hint), and HEIC/HEIF is
 *     transcoded to JPEG exactly like the upload route.
 */

/** Import cap — matches the person app's client-side photo cap. */
export const IMPORT_MAX_BYTES = 20 * 1024 * 1024

/** Formats sharp may report that we accept (mirrors upload's image set). */
const ACCEPTED_FORMATS: Record<string, { mime: string; ext: string }> = {
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  png: { mime: "image/png", ext: "png" },
  webp: { mime: "image/webp", ext: "webp" },
  avif: { mime: "image/avif", ext: "avif" },
  gif: { mime: "image/gif", ext: "gif" },
  heif: { mime: "image/heic", ext: "jpg" }, // transcoded to JPEG below
}

/** Content-Type prefixes that are OBVIOUSLY not images — fail before reading
 *  the body. Anything else (image/*, octet-stream, missing) falls through to
 *  the decode gate, which is authoritative. */
const OBVIOUS_NON_IMAGE = /^(text\/|application\/(json|xml|javascript|pdf)|video\/|audio\/)/i

export type MediaImportResult =
  | {
      ok: true
      url: string
      thumbnailUrl: string | null
      assetId: string | null
      mimeType: string
      sizeBytes: number
      filename: string
    }
  | { ok: false; status: 400 | 413 | 422; code: string; message: string; details?: Record<string, unknown> }

/** Read a Response body with a hard cap; null when the cap is exceeded. */
async function readBodyCapped(res: Response, maxBytes: number): Promise<Buffer | null> {
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > maxBytes ? null : buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export async function importImageFromUrl(
  userId: string,
  url: string,
): Promise<MediaImportResult> {
  // ── Fetch (SSRF-gated, timeboxed) ──
  let res: Response
  try {
    res = await safeFetch(url, { timeoutMs: 20_000 })
  } catch (err) {
    return {
      ok: false,
      status: 422,
      code: "fetch_failed",
      message: `Couldn't fetch that URL: ${(err as Error).message}`,
    }
  }
  if (!res.ok) {
    return {
      ok: false,
      status: 422,
      code: "fetch_failed",
      message: `The URL responded with HTTP ${res.status}`,
    }
  }

  const contentType = res.headers.get("content-type") ?? ""
  if (OBVIOUS_NON_IMAGE.test(contentType)) {
    return {
      ok: false,
      status: 400,
      code: "validation_error",
      message: `That URL serves ${contentType.split(";")[0]}, not an image`,
    }
  }

  const body = await readBodyCapped(res, IMPORT_MAX_BYTES)
  if (body === null) {
    return {
      ok: false,
      status: 413,
      code: "file_too_large",
      message: `Images up to ${IMPORT_MAX_BYTES / (1024 * 1024)}MB can be imported`,
    }
  }

  // ── Decode gate (authoritative) + HEIC transcode ──
  let buffer = body
  let format: string
  try {
    const meta = await sharp(body).metadata()
    format = meta.format ?? ""
  } catch {
    return {
      ok: false,
      status: 400,
      code: "validation_error",
      message: "That URL doesn't point to a decodable image",
    }
  }
  const accepted = ACCEPTED_FORMATS[format]
  if (!accepted) {
    return {
      ok: false,
      status: 400,
      code: "validation_error",
      message: `Unsupported image format: ${format || "unknown"}`,
    }
  }
  let mimeType = accepted.mime
  if (format === "heif") {
    // Same rationale as the upload route: HEIC renders only in Safari and
    // costs providers a libheif decode — transcode once to JPEG.
    try {
      buffer = await sharp(body).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
      mimeType = "image/jpeg"
    } catch (err) {
      return {
        ok: false,
        status: 400,
        code: "validation_error",
        message: `Failed to decode HEIC image: ${(err as Error).message}`,
      }
    }
  }

  // ── Atomic storage reservation (same race-free RPC as /v1/upload) ──
  const reserved = await reserveStorageIfWithinLimit(userId, buffer.length)
  if (!reserved) {
    const quota = await checkStorageQuota(userId, buffer.length)
    return {
      ok: false,
      status: 413,
      code: "storage_limit_exceeded",
      message: quota.error ?? "Storage limit exceeded",
      details: {
        usedBytes: quota.usedBytes,
        quotaBytes: quota.quotaBytes,
        remainingBytes: quota.remainingBytes,
        tier: quota.tier,
      },
    }
  }

  // ── R2 upload (reservation already counted the bytes — no trackUserId) ──
  const fileId = randomUUID()
  const r2Key = `uploads/images/${fileId}.${accepted.ext}`
  let publicUrl: string
  try {
    publicUrl = await uploadBufferToR2(buffer, r2Key, mimeType)
  } catch (err) {
    await refundStorage(userId, buffer.length)
    throw err
  }

  // ── Thumbnail + metadata (best-effort, like the upload route) ──
  let thumbnailUrl: string | null = null
  let metadata: Record<string, unknown> = {}
  try {
    const result = await processImage(buffer)
    metadata = { ...(result.metadata ?? {}) }
    const thumbKey = `uploads/images/${fileId}_thumb.${accepted.ext}`
    thumbnailUrl = await uploadBufferToR2(result.thumbnail, thumbKey, mimeType)
  } catch (err) {
    console.error("[media-import] thumbnail/metadata extraction failed:", err)
  }

  // ── Asset record ──
  const filename = decodeURIComponent(
    new URL(url).pathname.split("/").pop() || `imported-${fileId}.${accepted.ext}`,
  )
  let assetId: string | null = null
  const { data: asset, error: insertError } = await supabase
    .from("assets")
    .insert({
      user_id: userId,
      type: "image",
      filename,
      mime_type: mimeType,
      size_bytes: buffer.length,
      r2_key: r2Key,
      r2_url: publicUrl,
      upload_source: "url_import",
      metadata: {
        ...metadata,
        thumbnail_url: thumbnailUrl,
        source_url: url,
      },
    })
    .select("id")
    .single()
  if (insertError) {
    console.error("[media-import] failed to create asset record:", insertError)
  } else {
    assetId = asset.id
  }

  return {
    ok: true,
    url: publicUrl,
    thumbnailUrl,
    assetId,
    mimeType,
    sizeBytes: buffer.length,
    filename,
  }
}
