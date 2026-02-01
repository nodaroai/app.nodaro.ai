import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import youtubedl from "youtube-dl-exec"
import { uploadFileToR2 } from "../../lib/storage.js"

export async function extractYouTubeAudio(youtubeUrl: string): Promise<string> {
  const outputId = randomUUID()
  const outputPath = join(tmpdir(), `yt-extract-${outputId}.mp3`)

  try {
    console.log(`[youtube-extractor] Downloading audio from: ${youtubeUrl}`)

    await youtubedl(youtubeUrl, {
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: 0,
      output: outputPath,
      noPlaylist: true,
      noCheckCertificates: true,
    })

    await fs.access(outputPath)

    console.log(`[youtube-extractor] Downloaded to: ${outputPath}`)

    const r2Url = await uploadFileToR2(outputPath, `yt-extract-${outputId}`, "audio")

    await fs.unlink(outputPath).catch(() => {})

    console.log(`[youtube-extractor] Uploaded to R2: ${r2Url}`)

    return r2Url
  } catch (err) {
    await fs.unlink(outputPath).catch(() => {})
    const message = err instanceof Error ? err.message : "Failed to extract YouTube audio"
    throw new Error(message)
  }
}
