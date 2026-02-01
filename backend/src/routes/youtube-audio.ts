import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import youtubedl from "youtube-dl-exec"
import { uploadFileToR2 } from "../lib/storage.js"

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
    const outputPath = join(tmpdir(), `yt-audio-${outputId}.mp3`)

    try {
      console.log(`[youtube-audio] Downloading audio from: ${url}`)

      await youtubedl(url, {
        extractAudio: true,
        audioFormat: "mp3",
        audioQuality: 0,
        output: outputPath,
        noPlaylist: true,
        noCheckCertificates: true,
      })

      // Verify the file exists
      await fs.access(outputPath)

      console.log(`[youtube-audio] Downloaded to: ${outputPath}`)

      // Upload to R2
      const r2Url = await uploadFileToR2(outputPath, `yt-${outputId}`, "audio")

      // Cleanup temp file
      await fs.unlink(outputPath).catch(() => {})

      console.log(`[youtube-audio] Uploaded to R2: ${r2Url}`)

      return { url: r2Url }
    } catch (err) {
      // Cleanup on error
      await fs.unlink(outputPath).catch(() => {})

      const message = err instanceof Error ? err.message : "Failed to download YouTube audio"
      console.error(`[youtube-audio] Error: ${message}`)

      return reply.status(500).send({
        error: { code: "youtube_error", message },
      })
    }
  })
}
