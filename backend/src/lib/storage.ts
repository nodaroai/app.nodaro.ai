import { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable, Transform } from "node:stream"
import { config } from "./config.js"
import { safeFetch } from "./safe-fetch.js"
import {
  updateStorageUsage,
  reserveStorageIfWithinLimit,
  refundStorage,
  getSizeLimit,
  type FileCategory,
} from "../utils/file-validation.js"

export const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
  },
})

type MediaType = "image" | "video" | "audio"

const MEDIA_EXT: Record<MediaType, string> = { video: "mp4", audio: "wav", image: "png" }
const MEDIA_MIME: Record<MediaType, string> = { video: "video/mp4", audio: "audio/wav", image: "image/png" }

// Immutable assets keyed by job ID — cache for 1 year
const R2_CACHE_CONTROL = "public, max-age=31536000, immutable"

/**
 * Build the R2 object key for a given job and media type.
 */
function r2Key(jobId: string, type: MediaType): string {
  return `${type}s/${jobId}.${MEDIA_EXT[type]}`
}

/**
 * Build the public URL for an R2 key.
 */
function r2Url(key: string): string {
  return `${config.R2_PUBLIC_URL}/${key}`
}

/**
 * Stream a body to R2 via multipart upload.
 */
async function streamToR2(key: string, body: Readable | Buffer, contentType: string): Promise<void> {
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: R2_CACHE_CONTROL,
    },
    partSize: 5 * 1024 * 1024,
    queueSize: 4,
  })
  await upload.done()
}

/**
 * Track storage usage for a user after upload.
 * Fire-and-forget: errors are logged but never thrown.
 */
function trackStorage(trackUserId: string | undefined, sizeBytes: number): void {
  if (!trackUserId || sizeBytes <= 0) return
  updateStorageUsage(trackUserId, sizeBytes).catch((err) => {
    console.error("[storage] Failed to track usage:", err)
  })
}

/**
 * Transform that counts bytes flowing through it and errors once the cap is
 * crossed. Used by uploadToR2 to bound streaming downloads of user-supplied
 * URLs: Content-Length is advisory (attacker-controlled servers may lie or
 * omit it), so authoritative enforcement happens here, mid-stream.
 */
class SizeLimitedStream extends Transform {
  private counted = 0
  constructor(private readonly maxBytes: number) {
    super()
  }
  _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    cb: (err?: Error | null, data?: Buffer) => void,
  ): void {
    this.counted += chunk.length
    if (this.counted > this.maxBytes) {
      cb(
        new Error(
          `upload-size-exceeded: ${this.counted} bytes read, cap is ${this.maxBytes}`,
        ),
      )
      return
    }
    cb(null, chunk)
  }
  get bytesRead(): number {
    return this.counted
  }
}

/**
 * Stream a remote URL directly to R2, bounded by
 * `min(getSizeLimit(type), opts.remainingQuotaBytes ?? ∞)` via
 * SizeLimitedStream. Content-Length is an advisory early-reject only.
 *
 * Pass `opts.reserveQuota: true` (together with `trackUserId`) to do an
 * atomic pre-upload reservation of `effectiveCap` bytes through the
 * reserve_storage_if_within_limit RPC. The unused portion is refunded on
 * success; the full reservation is refunded on failure. This is what
 * protects against the concurrent-upload quota oversubscription: the RPC
 * serialises against a FOR UPDATE lock on the profile row, so N parallel
 * callers cannot each pass the same pre-upload snapshot check.
 */
export async function uploadToR2(
  sourceUrl: string,
  jobId: string,
  type: MediaType = "image",
  trackUserId?: string,
  opts: { remainingQuotaBytes?: number; reserveQuota?: boolean } = {},
): Promise<string> {
  // safeFetch: validate DNS resolution against private/reserved IP ranges at
  // connection time. Without this, a user-supplied sourceUrl resolving to an
  // internal IP (cloud metadata, admin service, 127.0.0.1) would stream that
  // response into R2 and return the public URL — a read-oracle for internal
  // HTTP. See backend/src/lib/safe-fetch.ts.
  const response = await safeFetch(sourceUrl, { timeoutMs: 120_000 })
  if (!response.ok) {
    throw new Error(`Failed to download ${type}: ${response.status}`)
  }

  const typeCap = getSizeLimit(type as FileCategory)
  const quotaCap = opts.remainingQuotaBytes ?? Number.POSITIVE_INFINITY
  const effectiveCap = Math.min(typeCap, quotaCap)

  const advertised = parseInt(response.headers.get("content-length") ?? "", 10)
  if (Number.isFinite(advertised) && advertised > effectiveCap) {
    try { await response.body?.cancel() } catch { /* best effort */ }
    throw new Error(
      `upload-size-exceeded: Content-Length ${advertised} > cap ${effectiveCap}`,
    )
  }

  let reserved = false
  if (opts.reserveQuota && trackUserId) {
    reserved = await reserveStorageIfWithinLimit(trackUserId, effectiveCap)
    if (!reserved) {
      try { await response.body?.cancel() } catch { /* best effort */ }
      throw new Error(
        `storage-limit-exceeded: atomic reservation of ${effectiveCap} bytes refused`,
      )
    }
  }

  const key = r2Key(jobId, type)
  const source = Readable.fromWeb(response.body as import("stream/web").ReadableStream)
  const counter = new SizeLimitedStream(effectiveCap)

  // Propagate teardown: a counter error (or source error) must destroy both
  // sides so the upstream fetch socket is closed and the Upload aborts.
  counter.once("error", (err) => {
    if (!source.destroyed) source.destroy(err)
  })
  source.once("error", (err) => {
    if (!counter.destroyed) counter.destroy(err)
  })
  source.pipe(counter)

  try {
    await streamToR2(key, counter, MEDIA_MIME[type])
  } catch (err) {
    // Reservation must be released before surfacing the error, otherwise a
    // failed upload permanently holds the user's quota. lib-storage aborts
    // in-flight multipart uploads, but a completed single-part PutObject
    // that failed post-commit could still leak — best-effort delete covers
    // that case. Refund + delete are independent, so run in parallel.
    const cleanupTasks: Promise<unknown>[] = [deleteFromR2(key)]
    if (reserved) cleanupTasks.push(refundStorage(trackUserId!, effectiveCap))
    const results = await Promise.allSettled(cleanupTasks)
    for (const r of results) {
      if (r.status === "rejected") {
        console.error("[uploadToR2] cleanup failed:", r.reason)
      }
    }
    throw err
  }

  if (reserved) {
    const unused = effectiveCap - counter.bytesRead
    if (unused > 0) {
      await refundStorage(trackUserId!, unused).catch((refundErr) => {
        console.error("[uploadToR2] unused-bytes refund failed:", refundErr)
      })
    }
  } else {
    trackStorage(trackUserId, counter.bytesRead)
  }

  return r2Url(key)
}

export async function uploadBufferToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
  trackUserId?: string,
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: R2_CACHE_CONTROL,
    }),
  )

  trackStorage(trackUserId, buffer.length)

  return r2Url(key)
}

/**
 * Stream a local file directly to R2 without buffering the entire file in memory.
 */
export async function uploadFileToR2(
  filePath: string,
  jobId: string,
  type: MediaType = "video",
  trackUserId?: string,
): Promise<string> {
  const fileStat = await stat(filePath)
  const key = r2Key(jobId, type)

  await streamToR2(key, createReadStream(filePath), MEDIA_MIME[type])

  trackStorage(trackUserId, fileStat.size)

  return r2Url(key)
}

/**
 * Stream a local file to R2 with a custom key (no jobId-based naming).
 */
export async function uploadFileWithKeyToR2(
  filePath: string,
  key: string,
  contentType: string,
  trackUserId?: string,
): Promise<string> {
  const fileStat = await stat(filePath)
  await streamToR2(key, createReadStream(filePath), contentType)
  trackStorage(trackUserId, fileStat.size)
  return r2Url(key)
}

// ---------------------------------------------------------------------------
// Template preview copy
// ---------------------------------------------------------------------------

const PREVIEW_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
}

/**
 * Origin-anchored R2 key extractor. Uses startsWith with a trailing slash to
 * avoid the substring-prefix pitfall (R2_PUBLIC_URL=https://assets.nodaro.ai
 * would otherwise prefix-match https://assets.nodaro.ai.attacker.com/...).
 */
function r2KeyFromOurUrl(url: string): string | null {
  if (!config.R2_PUBLIC_URL) return null
  const prefix = config.R2_PUBLIC_URL.endsWith("/")
    ? config.R2_PUBLIC_URL
    : config.R2_PUBLIC_URL + "/"
  if (!url.startsWith(prefix)) return null
  return url.slice(prefix.length)
}

function extractExtensionFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname
    const dot = path.lastIndexOf(".")
    if (dot < 0 || dot === path.length - 1) return null
    const ext = path.slice(dot + 1).toLowerCase()
    return /^[a-z0-9]{1,5}$/.test(ext) ? ext : null
  } catch {
    return null
  }
}

/**
 * Copy a media URL into a durable template-preview slot.
 *
 * Why this exists: workflow_templates.preview_media_url used to store a direct
 * reference to an in-flow asset URL — if the source node was later deleted and
 * the template re-published, derivePreviewMedia returned null and the preview
 * silently disappeared from marketplace/tutorial cards. This helper decouples
 * the template's preview from any node by writing an independent copy at a
 * stable key.
 *
 * R2-to-R2 path uses CopyObjectCommand — no egress, no re-upload. Foreign URLs
 * fall back to a bounded safeFetch + streamToR2. Storage is tracked against
 * the creator (matches who owns the template).
 *
 * Idempotent: re-publishing overwrites the same `templates/<id>/preview.<ext>`
 * key. CDN URL stays stable; edge caches refresh on their own TTL.
 *
 * TODO(thumbnails): cap video preview size or convert video previews to a
 * single-frame poster — currently copies videos at full size. Tracked as a
 * separate follow-up.
 */
export async function copyToTemplatePreview(
  sourceUrl: string,
  templateId: string,
  mediaType: "image" | "video",
  creatorUserId: string,
): Promise<string> {
  const ext = extractExtensionFromUrl(sourceUrl) ?? MEDIA_EXT[mediaType]
  const destKey = `templates/${templateId}/preview.${ext}`
  const contentType = PREVIEW_EXT_TO_MIME[ext] ?? MEDIA_MIME[mediaType]

  const sourceKey = r2KeyFromOurUrl(sourceUrl)
  if (sourceKey) {
    await s3.send(
      new CopyObjectCommand({
        Bucket: config.R2_BUCKET_NAME,
        Key: destKey,
        CopySource: `/${config.R2_BUCKET_NAME}/${sourceKey}`,
        ContentType: contentType,
        CacheControl: R2_CACHE_CONTROL,
        MetadataDirective: "REPLACE",
      }),
    )
    // Best-effort size tracking. A HEAD failure shouldn't fail the publish —
    // the copy already succeeded; quota accounting drifting by one preview is
    // acceptable.
    try {
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: destKey }),
      )
      if (head.ContentLength) trackStorage(creatorUserId, head.ContentLength)
    } catch (err) {
      console.error("[copyToTemplatePreview] HEAD failed (storage not tracked):", err)
    }
    return r2Url(destKey)
  }

  // Foreign URL — download and upload, bounded by the standard size cap.
  const response = await safeFetch(sourceUrl, { timeoutMs: 120_000 })
  if (!response.ok) {
    throw new Error(`copyToTemplatePreview: source fetch failed (${response.status})`)
  }
  const cap = getSizeLimit(mediaType as FileCategory)
  const source = Readable.fromWeb(response.body as import("stream/web").ReadableStream)
  const counter = new SizeLimitedStream(cap)
  counter.once("error", (err) => {
    if (!source.destroyed) source.destroy(err)
  })
  source.once("error", (err) => {
    if (!counter.destroyed) counter.destroy(err)
  })
  source.pipe(counter)

  await streamToR2(destKey, counter, contentType)
  trackStorage(creatorUserId, counter.bytesRead)
  return r2Url(destKey)
}

export async function deleteFromR2(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
    }),
  )
}

/**
 * Batch delete up to 1000 keys per call from R2.
 * Automatically chunks if more than 1000 keys are provided.
 */
export async function batchDeleteFromR2(keys: string[]): Promise<{ deleted: number; errors: number }> {
  if (keys.length === 0) return { deleted: 0, errors: 0 }

  const BATCH_SIZE = 1000
  let deleted = 0
  let errors = 0

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE)
    try {
      const result = await s3.send(new DeleteObjectsCommand({
        Bucket: config.R2_BUCKET_NAME,
        Delete: { Objects: batch.map(Key => ({ Key })) },
      }))
      deleted += result.Deleted?.length ?? 0
      errors += result.Errors?.length ?? 0
    } catch (err) {
      console.error(`[storage] Batch delete failed for ${batch.length} keys:`, err)
      errors += batch.length
    }
  }
  return { deleted, errors }
}
