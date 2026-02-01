import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { config } from "./config.js"

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
  },
})

export async function uploadToR2(
  sourceUrl: string,
  jobId: string,
  type: "image" | "video" | "audio" = "image",
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

  return `${config.R2_PUBLIC_URL}/${key}`
}
