// @reads-none reads only the audio yt-dlp writes to the OS temp dir
import { promises as fs } from "node:fs"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ytProxyOption } from "../providers/video/yt-proxy.js"
import { runYtDlpOptions } from "../providers/video/ytdlp-options-run.js"
import { uploadFileWithKeyToR2 } from "../lib/storage.js"
import { uploadJobScratchFile } from "../lib/job-scratch.js"
import { requireImportAllowed, spendImportConfirmation, type ImportRights } from "../lib/import-gate.js"

/**
 * The worker's audio downloader, an ENGINE of the import gate
 * (`lib/import-gate.ts`): a social link's audio becomes a stored file. Its
 * own module so the gate's totality guard holds it to one yt-dlp run beside
 * the gate's two halves, apart from everything else `workers/shared.ts` does.
 *
 * With `scratchJobId` (Suno's cover and upload-extend: a provider input) the
 * copy goes to that job's scratch folder, emptied when the job ends (decided
 * 2026-10-09). Without it (a workflow run's link fetch, whose audio later
 * nodes read) it keeps its own key.
 *
 * The site's policy and the content rights confirmation are checked first and
 * the confirmation spent right before yt-dlp runs; a refusal is the gate's
 * own error, before any fetch.
 */
export async function downloadAudioToR2(url: string, rights: ImportRights, opts: { scratchJobId?: string } = {}): Promise<string> {
  await requireImportAllowed(url, rights)
  const outputId = randomUUID()
  const baseName = `yt-audio-${outputId}`
  const outputTemplate = join(tmpdir(), `${baseName}.%(ext)s`)
  const expectedPath = join(tmpdir(), `${baseName}.mp3`)

  console.log(`[worker] Downloading audio from social URL: ${url}`)

  const ytDlpOptions: Record<string, unknown> = {
    extractAudio: true,
    audioFormat: "mp3",
    audioQuality: 0,
    output: outputTemplate,
    noPlaylist: true,
    noCheckCertificates: true,
    preferFreeFormats: true,
    // Residential proxy for YouTube (datacenter IP bot-block); no-op when unset.
    ...ytProxyOption(url),
    extractorArgs: "youtube:player_client=android",
    addHeader: [
      "referer:youtube.com",
      "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    ],
  }
  // Nothing else can refuse the import now: spend the confirmation, then fetch.
  await spendImportConfirmation(url, rights)
  // `-x --audio-format mp3` runs yt-dlp's own ffmpeg to ENCODE: admitted like any ffmpeg, and stopped
  // with its whole process group at the hold.
  await runYtDlpOptions(url, ytDlpOptions)

  // Find the actual audio file
  let actualPath = expectedPath
  try {
    await fs.access(expectedPath)
  } catch {
    const alternatives = [".m4a", ".webm", ".opus", ".ogg", ".wav"]
    let found = false
    for (const ext of alternatives) {
      const altPath = join(tmpdir(), `${baseName}${ext}`)
      try {
        await fs.access(altPath)
        actualPath = altPath
        found = true
        break
      } catch { continue }
    }
    if (!found) throw new Error("yt-dlp did not produce an output file")
  }

  const stat = await fs.stat(actualPath)
  if (stat.size === 0) throw new Error("Downloaded audio file is empty")

  const r2Url = opts.scratchJobId
    ? await uploadJobScratchFile(actualPath, "cover-src", "mp3", "audio/mpeg", opts.scratchJobId)
    : await uploadFileWithKeyToR2(actualPath, `audios/cover-src-${outputId}.mp3`, "audio/mpeg")
  await fs.unlink(actualPath).catch(() => {})

  console.log(`[worker] Audio downloaded and uploaded to R2: ${r2Url}`)
  return r2Url
}
