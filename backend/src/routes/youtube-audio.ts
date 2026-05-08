import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import youtubedl from "youtube-dl-exec"
import { uploadFileWithKeyToR2, uploadBufferToR2 } from "../lib/storage.js"
import { formatZodError } from "../lib/zod-error.js"

// Supported video platforms (yt-dlp supports 1000+ sites natively)
const SUPPORTED_HOSTNAMES = [
  "youtube.com", "youtu.be",
  "tiktok.com",
  "instagram.com",
  "twitter.com", "x.com",
  "facebook.com", "fb.watch", "fb.com",
]

const videoAudioBody = z.object({
  url: safeUrlSchema.refine(
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

export async function youtubeAudioRoutes(app: FastifyInstance) {
  app.post("/v1/youtube-audio", async (req, reply) => {
    const parsed = videoAudioBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { url } = parsed.data
    const outputId = randomUUID()
    // Use %(ext)s template so yt-dlp controls the final extension
    const baseName = `yt-audio-${outputId}`
    const outputTemplate = join(tmpdir(), `${baseName}.%(ext)s`)
    const expectedPath = join(tmpdir(), `${baseName}.mp3`)

    try {
      console.log(`[youtube-audio] Downloading audio from: ${url}`)

      await youtubedl(url, {
        extractAudio: true,
        audioFormat: "mp3",
        audioQuality: 0,
        output: outputTemplate,
        noPlaylist: true,
        noCheckCertificates: true,
        preferFreeFormats: true,
        writeThumbnail: true,
        convertThumbnails: "jpg",
        // Use Android client to bypass JS runtime requirement
        extractorArgs: "youtube:player_client=android",
        addHeader: [
          "referer:youtube.com",
          "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ],
      } as Record<string, unknown>)

      // Find the actual audio file - yt-dlp may use different naming
      let actualPath = expectedPath
      try {
        await fs.access(expectedPath)
      } catch {
        // Search for alternative extensions yt-dlp might produce
        const alternatives = [".m4a", ".webm", ".opus", ".ogg", ".wav"]
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

      // Validate file has content
      const stat = await fs.stat(actualPath)
      if (stat.size === 0) {
        throw new Error("Downloaded audio file is empty")
      }

      console.log(`[youtube-audio] Downloaded to: ${actualPath} (${stat.size} bytes)`)

      // Upload audio to R2 with correct MP3 content type
      const r2Url = await uploadFileWithKeyToR2(actualPath, `audios/yt-${outputId}.mp3`, "audio/mpeg")

      // Cleanup audio temp file
      await fs.unlink(actualPath).catch(() => {})

      // Find and upload thumbnail (yt-dlp writes it alongside audio)
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
            console.log(`[youtube-audio] Uploaded thumbnail to R2: ${thumbnailUrl}`)
          }
          await fs.unlink(thumbPath).catch(() => {})
          break
        } catch {
          continue
        }
      }

      console.log(`[youtube-audio] Uploaded audio to R2: ${r2Url}`)

      return { url: r2Url, thumbnailUrl: thumbnailUrl ?? null }
    } catch (err) {
      // Cleanup on error - try all possible paths
      const audioExts = [".mp3", ".m4a", ".webm", ".opus", ".ogg", ".wav"]
      const thumbExts = [".jpg", ".webp", ".png"]
      for (const ext of [...audioExts, ...thumbExts]) {
        await fs.unlink(join(tmpdir(), `${baseName}${ext}`)).catch(() => {})
      }

      const message = err instanceof Error ? err.message : "Failed to download audio from video"
      console.error(`[youtube-audio] Error: ${message}`)

      return reply.status(500).send({
        error: { code: "youtube_error", message },
      })
    }
  })
}
