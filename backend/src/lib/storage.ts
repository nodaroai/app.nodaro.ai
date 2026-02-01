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
  imageUrl: string,
  jobId: string,
): Promise<string> {
  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const key = `images/${jobId}.png`

  await s3.send(
    new PutObjectCommand({
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: "image/png",
    }),
  )

  return `${config.R2_PUBLIC_URL}/${key}`
}
