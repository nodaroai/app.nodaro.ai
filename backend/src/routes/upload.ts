import type { FastifyInstance } from "fastify"
import multipart from "@fastify/multipart"
import { randomUUID } from "node:crypto"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { s3 } from "../lib/storage.js"
import {
  validateFile,
  checkStorageQuota,
  updateStorageUsage,
  getExtensionFromMime,
  type FileCategory,
} from "../utils/file-validation.js"
import {
  processImage,
  processVideo,
  processAudio,
  type FileMetadata,
} from "../utils/thumbnail.js"

// ============================================================
// Legacy Constants (kept for backward-compatible endpoints)
// ============================================================

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
])

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
])

// New endpoint supports up to 500 MB (for video), legacy stays at 50 MB
const LEGACY_MAX_FILE_SIZE = 50 * 1024 * 1024
const MAX_FILE_SIZE = 500 * 1024 * 1024

// ============================================================
// Helpers
// ============================================================

async function uploadBufferToS3(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  )
  return `${config.R2_PUBLIC_URL}/${key}`
}

// ============================================================
// Routes
// ============================================================

export async function uploadRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
  })

  // ===========================================================
  // POST /v1/upload - Generalized upload endpoint
  // ===========================================================
  // Accepts any supported file type (image, video, audio).
  // Returns: url, thumbnailUrl, metadata, category, asset record.
  //
  // Multipart fields:
  //   file       (required) - the file to upload
  //   userId     (optional) - user ID for quota/asset tracking
  //   projectId  (optional) - project to associate asset with
  //   filename   (optional) - override filename
  // ===========================================================

  app.post("/v1/upload", async (req, reply) => {
    const data = await req.file()
    if (!data) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "No file provided" },
      })
    }

    // Step 0: Validate MIME type BEFORE buffering the entire file
    const mimeType = data.mimetype
    const earlyValidation = validateFile(mimeType, 0) // size=0 skips size check
    if (!earlyValidation.valid && earlyValidation.error?.includes("Unsupported file type")) {
      // Consume and discard the stream to prevent connection hang
      data.file.resume()
      return reply.status(400).send({
        error: { code: "validation_error", message: earlyValidation.error },
      })
    }

    const buffer = await data.toBuffer()
    const originalFilename = data.filename

    // Parse optional fields from multipart form
    const fields = data.fields as Record<string, { value?: string } | undefined>
    // Use authenticated userId from JWT; fall back to form field for unauthenticated uploads
    const userId = req.userId ?? fields?.userId?.value ?? null
    const projectId = fields?.projectId?.value ?? null
    const filenameOverride = fields?.filename?.value ?? null

    // Step 1: Validate MIME type and size (full validation with actual size)
    const validation = validateFile(mimeType, buffer.length)
    if (!validation.valid) {
      return reply.status(400).send({
        error: { code: "validation_error", message: validation.error },
      })
    }

    const category = validation.category as FileCategory

    // Step 2: Check storage quota (cloud edition)
    if (userId) {
      const quota = await checkStorageQuota(userId, buffer.length)
      if (!quota.allowed) {
        return reply.status(413).send({
          error: {
            code: "storage_limit_exceeded",
            message: quota.error,
            usedBytes: quota.usedBytes,
            quotaBytes: quota.quotaBytes,
            remainingBytes: quota.remainingBytes,
            tier: quota.tier,
          },
        })
      }
    }

    // Step 3: Upload original file to R2
    const ext = getExtensionFromMime(mimeType)
    const fileId = randomUUID()
    const r2Key = `uploads/${category}s/${fileId}.${ext}`
    const publicUrl = await uploadBufferToS3(buffer, r2Key, mimeType)

    // Step 4: Generate thumbnail & extract metadata
    let thumbnailUrl: string | null = null
    let metadata: FileMetadata | null = null

    try {
      if (category === "image") {
        const result = await processImage(buffer)
        metadata = result.metadata
        const thumbKey = `uploads/${category}s/${fileId}_thumb.${ext}`
        thumbnailUrl = await uploadBufferToS3(result.thumbnail, thumbKey, mimeType)
      } else if (category === "video") {
        const result = await processVideo(buffer)
        metadata = result.metadata
        const thumbKey = `uploads/${category}s/${fileId}_thumb.png`
        thumbnailUrl = await uploadBufferToS3(result.thumbnail, thumbKey, "image/png")
      } else if (category === "audio") {
        const result = await processAudio(buffer)
        metadata = result.metadata
        // Audio has no thumbnail
      }
    } catch (err) {
      // Log but don't fail the upload - metadata/thumbnail are nice-to-have
      console.error(`[upload] Metadata extraction failed for ${category}:`, err)
    }

    // Step 5: Create asset record in database
    let assetId: string | null = null
    if (userId) {
      const displayFilename = filenameOverride ?? originalFilename

      const { data: asset, error: insertError } = await supabase
        .from("assets")
        .insert({
          user_id: userId,
          type: category,
          filename: displayFilename,
          mime_type: mimeType,
          size_bytes: buffer.length,
          r2_key: r2Key,
          r2_url: publicUrl,
          upload_source: "manual_upload",
          metadata: {
            ...(metadata ?? {}),
            thumbnail_url: thumbnailUrl,
            original_filename: originalFilename,
          },
        })
        .select("id")
        .single()

      if (insertError) {
        console.error("[upload] Failed to create asset record:", insertError)
      } else {
        assetId = asset.id
      }

      // Step 6: Update user storage usage
      await updateStorageUsage(userId, buffer.length)
    }

    return {
      data: {
        url: publicUrl,
        thumbnailUrl,
        assetId,
        category,
        filename: filenameOverride ?? originalFilename,
        mimeType,
        sizeBytes: buffer.length,
        metadata,
        r2Key,
      },
    }
  })

  // ===========================================================
  // Legacy Endpoints (preserved for backward compatibility)
  // ===========================================================

  app.post("/v1/upload/audio", async (req, reply) => {
    const file = await req.file()
    if (!file) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "No file provided" },
      })
    }

    if (!ALLOWED_AUDIO_TYPES.has(file.mimetype)) {
      return reply.status(400).send({
        error: { code: "validation_error", message: `Unsupported audio type: ${file.mimetype}. Accepted: mp3, wav, m4a, aac` },
      })
    }

    const buffer = await file.toBuffer()

    if (buffer.length > LEGACY_MAX_FILE_SIZE) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "File too large. Maximum: 50 MB" },
      })
    }

    const ext = file.filename.split(".").pop() ?? "mp3"
    const key = `uploads/${randomUUID()}.${ext}`

    const publicUrl = await uploadBufferToS3(buffer, key, file.mimetype)

    return { url: publicUrl }
  })

  app.post("/v1/upload/image", async (req, reply) => {
    const file = await req.file()
    if (!file) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "No file provided" },
      })
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return reply.status(400).send({
        error: { code: "validation_error", message: `Unsupported image type: ${file.mimetype}. Accepted: png, jpeg, webp` },
      })
    }

    const buffer = await file.toBuffer()

    if (buffer.length > LEGACY_MAX_FILE_SIZE) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "File too large. Maximum: 50 MB" },
      })
    }

    const MIME_TO_EXT: Record<string, string> = { "image/png": "png", "image/webp": "webp" }
    const ext = MIME_TO_EXT[file.mimetype] ?? "jpg"
    const key = `uploads/${randomUUID()}.${ext}`

    const publicUrl = await uploadBufferToS3(buffer, key, file.mimetype)

    return { url: publicUrl }
  })
}
