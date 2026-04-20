import { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"
import { config } from "./config.js"
import { safeFetch } from "./safe-fetch.js"
import { updateStorageUsage } from "../utils/file-validation.js"

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
 * Stream a remote URL directly to R2 without buffering the entire file in memory.
 */
export async function uploadToR2(
  sourceUrl: string,
  jobId: string,
  type: MediaType = "image",
  trackUserId?: string,
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

  const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10)
  const key = r2Key(jobId, type)
  const nodeStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream)

  await streamToR2(key, nodeStream, MEDIA_MIME[type])

  if (contentLength > 0) {
    trackStorage(trackUserId, contentLength)
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
