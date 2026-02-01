import type { FastifyInstance } from "fastify"
import multipart from "@fastify/multipart"
import { randomUUID } from "node:crypto"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { config } from "../lib/config.js"

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
  },
})

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
])

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export async function uploadRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
  })

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
    const ext = file.filename.split(".").pop() ?? "mp3"
    const key = `uploads/${randomUUID()}.${ext}`

    await s3.send(
      new PutObjectCommand({
        Bucket: config.R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: file.mimetype,
      }),
    )

    const publicUrl = `${config.R2_PUBLIC_URL}/${key}`
    console.log(`[upload] Audio uploaded: ${publicUrl}`)

    return { url: publicUrl }
  })
}
