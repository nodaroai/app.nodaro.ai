import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import youtubedl from "youtube-dl-exec"
import { uploadBufferToR2 } from "../lib/storage.js"

const youtubeAudioBody = z.object({
  url: z.string().url().refine(
    (url) => {
      try {
        const parsed = new URL(url)
        return parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtu.be")
      } catch {
        return false
      }
    },
    { message: "Must be a valid YouTube URL" },
  ),
})

export async function youtubeAudioRoutes(app: FastifyInstance) {
  app.post("/v1/youtube-audio", async (req, reply) => {
    const parsed = youtubeAudioBody.safeParse(req.body)
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
        // Use Android client to bypass JS runtime requirement
        extractorArgs: "youtube:player_client=android",
        addHeader: [
          "referer:youtube.com",
          "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ],
      } as Record<string, unknown>)

      // Find the actual output file - yt-dlp may use different naming
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

      // Upload to R2 with correct MP3 content type
      const buffer = await fs.readFile(actualPath)
      const r2Key = `audios/yt-${outputId}.mp3`
      const r2Url = await uploadBufferToR2(buffer, r2Key, "audio/mpeg")

      // Cleanup temp file
      await fs.unlink(actualPath).catch(() => {})

      console.log(`[youtube-audio] Uploaded to R2: ${r2Url}`)

      return { url: r2Url }
    } catch (err) {
      // Cleanup on error - try all possible paths
      const extensions = [".mp3", ".m4a", ".webm", ".opus", ".ogg", ".wav"]
      for (const ext of extensions) {
        await fs.unlink(join(tmpdir(), `${baseName}${ext}`)).catch(() => {})
      }

      const message = err instanceof Error ? err.message : "Failed to download YouTube audio"
      console.error(`[youtube-audio] Error: ${message}`)

      return reply.status(500).send({
        error: { code: "youtube_error", message },
      })
    }
  })
}
