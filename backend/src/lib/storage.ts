import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { promises as fs } from "node:fs"
import { config } from "./config.js"
import { updateStorageUsage } from "../utils/file-validation.js"

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
  },
})

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

export async function uploadToR2(
  sourceUrl: string,
  jobId: string,
  type: "image" | "video" | "audio" = "image",
  trackUserId?: string,
): Promise<string> {
  const response = await fetch(sourceUrl)
  if (!response.ok) {
    throw new Error(`Failed to download ${type}: ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const ext = type === "video" ? "mp4" : type === "audio" ? "wav" : "png"
  const contentType = type === "video" ? "video/mp4" : type === "audio" ? "audio/wav" : "image/png"
  const key = `${type}s/${jobId}.${ext}`

  await s3.send(
    new PutObjectCommand({
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  )

  trackStorage(trackUserId, buffer.length)

  return `${config.R2_PUBLIC_URL}/${key}`
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
    }),
  )

  trackStorage(trackUserId, buffer.length)

  return `${config.R2_PUBLIC_URL}/${key}`
}

export async function uploadFileToR2(
  filePath: string,
  jobId: string,
  type: "image" | "video" | "audio" = "video",
  trackUserId?: string,
): Promise<string> {
  const buffer = await fs.readFile(filePath)
  const ext = type === "video" ? "mp4" : type === "audio" ? "wav" : "png"
  const contentType = type === "video" ? "video/mp4" : type === "audio" ? "audio/wav" : "image/png"
  const key = `${type}s/${jobId}.${ext}`

  await s3.send(
    new PutObjectCommand({
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  )

  trackStorage(trackUserId, buffer.length)

  return `${config.R2_PUBLIC_URL}/${key}`
}

export async function deleteFromR2(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
    }),
  )
}
