import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { uploadFileToR2 } from "../../lib/storage.js"
import { YOUTUBE_HOSTS, hostnameMatchesAllowlist } from "../../lib/url-validator.js"
import { resolveAttemptChain } from "../video/yt-proxy.js"
import {
  runThroughClientLadder,
  spawnYtDlpDownload,
  YT_SPOOF_ARGS,
  YtUrlNotAllowedError,
} from "../video/youtube-video.js"

/**
 * `--extract-audio` converts with a SILENT ffmpeg phase after the download, so
 * the shared spawn's 90s download-stall default would SIGKILL a healthy long
 * extraction mid-convert. 10 minutes matches the worker ffmpeg convention.
 */
const AUDIO_IDLE_TIMEOUT_MS = 10 * 60 * 1000

/** yt-dlp args for ONE audio-extraction attempt. Pure — exported for tests. */
export function buildYtAudioExtractionArgs(url: string, outputPath: string, proxy: string | null): string[] {
  return [
    url,
    "--extract-audio",
    "--audio-format", "mp3",
    "--audio-quality", "0",
    "--output", outputPath,
    "--no-playlist",
    "--no-check-certificates",
    "--force-overwrites",
    ...YT_SPOOF_ARGS,
    ...(proxy ? ["--proxy", proxy] : []),
    "--newline",
    "--progress-template", "download:%(progress._percent_str)s",
  ]
}

/**
 * Download a YouTube video's audio track as mp3 and upload it to R2.
 *
 * Rides the SAME hardened composition as the video lane — the proxy attempt
 * chain × the web→tv→android client ladder over the shared pinned-binary
 * spawn. The naive single web-client `youtube-dl-exec` call this replaced died
 * in production the day YouTube's web client started requiring a JS runtime
 * (deno) the image does not carry; the tv/android rungs need none, which is
 * why every OTHER audio path (trim-audio, workers/shared — hard android pins)
 * kept working while this one failed. The ladder is preferred over a hard pin:
 * one wasted web rung today is cheap, and it self-heals into best formats if a
 * JS runtime ever lands in the image.
 */
export async function extractYouTubeAudio(youtubeUrl: string): Promise<string> {
  // SSRF gate, same as the video lane's in-function check: the worker calls
  // this directly and yt-dlp does its own DNS+HTTP (bypassing safeFetch), so
  // the allowlist here is defense-in-depth beyond the route's Zod.
  let host: string
  try {
    host = new URL(youtubeUrl).hostname
  } catch {
    throw new YtUrlNotAllowedError(`invalid url: ${youtubeUrl}`)
  }
  if (!hostnameMatchesAllowlist(host, YOUTUBE_HOSTS)) {
    throw new YtUrlNotAllowedError(`host not allowed: ${host}`)
  }

  const outputId = randomUUID()
  const outputPath = join(tmpdir(), `yt-extract-${outputId}.mp3`)

  try {
    console.log(`[youtube-extractor] Downloading audio from: ${youtubeUrl}`)

    const attempts = resolveAttemptChain(youtubeUrl)
    let lastError: unknown = new Error("audio extraction not attempted")
    let downloaded = false
    for (let i = 0; i < attempts.length && !downloaded; i++) {
      const proxy = attempts[i]
      const args = buildYtAudioExtractionArgs(youtubeUrl, outputPath, proxy)
      try {
        await runThroughClientLadder(youtubeUrl, (rung) =>
          spawnYtDlpDownload([...args, ...rung.extractorArgs], undefined, { idleTimeoutMs: AUDIO_IDLE_TIMEOUT_MS }),
        )
        downloaded = true
      } catch (err) {
        lastError = err
        if (i < attempts.length - 1) {
          const firstLine = (err instanceof Error ? err.message : String(err)).split("\n")[0]
          console.log(
            `[youtube-extractor] attempt ${i + 1}/${attempts.length} (${proxy ? "proxy" : "direct"}) failed (${firstLine}); trying next`,
          )
        }
      }
    }
    if (!downloaded) throw lastError

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
