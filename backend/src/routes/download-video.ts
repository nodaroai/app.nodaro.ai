import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import youtubedl from "youtube-dl-exec"
import { uploadBufferToR2 } from "../lib/storage.js"

const SUPPORTED_HOSTNAMES = [
  "youtube.com", "youtu.be",
  "tiktok.com",
  "instagram.com",
  "twitter.com", "x.com",
  "facebook.com", "fb.watch", "fb.com",
]

const downloadVideoBody = z.object({
  url: z.string().url().refine(
    (url) => {
      try {
        const parsed = new URL(url)
        return SUPPORTED_HOSTNAMES.some((h) => parsed.hostname.includes(h))
      } catch {
        return false
      }
    },
    { message: "Must be a valid video URL (YouTube, Facebook, TikTok, Instagram, or X)" },
  ),
})

export async function downloadVideoRoutes(app: FastifyInstance) {
  app.post("/v1/download-video", async (req, reply) => {
    const parsed = downloadVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { url } = parsed.data
    const outputId = randomUUID()
    const baseName = `yt-video-${outputId}`
    const outputTemplate = join(tmpdir(), `${baseName}.%(ext)s`)
    const expectedPath = join(tmpdir(), `${baseName}.mp4`)

    try {
      console.log(`[download-video] Downloading video from: ${url}`)

      await youtubedl(url, {
        format: "mp4/best",
        output: outputTemplate,
        noPlaylist: true,
        noCheckCertificates: true,
        mergeOutputFormat: "mp4",
        writeThumbnail: true,
        convertThumbnails: "jpg",
        extractorArgs: "youtube:player_client=android",
        addHeader: [
          "referer:youtube.com",
          "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ],
      } as Record<string, unknown>)

      // Find the actual video file
      let actualPath = expectedPath
      try {
        await fs.access(expectedPath)
      } catch {
        const alternatives = [".mkv", ".webm", ".mov", ".avi", ".flv"]
        let found = false
        for (const ext of alternatives) {
          const altPath = join(tmpdir(), `${baseName}${ext}`)
          try {
            await fs.access(altPath)
            actualPath = altPath
            found = true
            break
          } catch {
            continue
          }
        }
        if (!found) {
          throw new Error("yt-dlp did not produce an output file")
        }
      }

      const stat = await fs.stat(actualPath)
      if (stat.size === 0) {
        throw new Error("Downloaded video file is empty")
      }

      console.log(`[download-video] Downloaded to: ${actualPath} (${stat.size} bytes)`)

      // Upload video to R2
      const buffer = await fs.readFile(actualPath)
      const r2Key = `videos/yt-${outputId}.mp4`
      const videoR2Url = await uploadBufferToR2(buffer, r2Key, "video/mp4")

      await fs.unlink(actualPath).catch(() => {})

      // Find and upload thumbnail
      let thumbnailUrl: string | undefined
      const thumbExtensions = [".jpg", ".webp", ".png"]
      for (const ext of thumbExtensions) {
        const thumbPath = join(tmpdir(), `${baseName}${ext}`)
        try {
          await fs.access(thumbPath)
          const thumbStat = await fs.stat(thumbPath)
          if (thumbStat.size > 0) {
            const thumbBuffer = await fs.readFile(thumbPath)
            const contentType = ext === ".jpg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png"
            const thumbR2Key = `thumbnails/yt-${outputId}${ext}`
            thumbnailUrl = await uploadBufferToR2(thumbBuffer, thumbR2Key, contentType)
            console.log(`[download-video] Uploaded thumbnail to R2: ${thumbnailUrl}`)
          }
          await fs.unlink(thumbPath).catch(() => {})
          break
        } catch {
          continue
        }
      }

      console.log(`[download-video] Uploaded video to R2: ${videoR2Url}`)

      return { videoUrl: videoR2Url, thumbnailUrl: thumbnailUrl ?? null }
    } catch (err) {
      // Cleanup on error
      const videoExts = [".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv"]
      const thumbExts = [".jpg", ".webp", ".png"]
      for (const ext of [...videoExts, ...thumbExts]) {
        await fs.unlink(join(tmpdir(), `${baseName}${ext}`)).catch(() => {})
      }

      const message = err instanceof Error ? err.message : "Failed to download video"
      console.error(`[download-video] Error: ${message}`)

      return reply.status(500).send({
        error: { code: "download_error", message },
      })
    }
  })
}
