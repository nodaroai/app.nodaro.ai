import { join } from "node:path"
import youtubedl from "youtube-dl-exec"
import { ytProxyOption } from "./yt-proxy.js"
import { withYtDlpOptionsAdmission } from "./ytdlp-admission.js"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"
import { mp3EncodeArgs } from "./mp3-encode.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { trimRangeRefusal } from "./trim-audio-range.js"
import { isAllowedSocialVideoUrl } from "../../lib/url-validator.js"
import { requireImportAllowed, spendImportConfirmation, type ImportRights } from "../../lib/import-gate.js"
import { assertLinkImportAllowed } from "../../lib/link-imports.js"
import { VIDEO_FORMAT_SELECTOR } from "./video-format.js"

function isSocialMediaUrl(url: string): boolean {
  return isAllowedSocialVideoUrl(url)
}

interface TrimAudioOptions {
  readonly videoUrl: string
  readonly audioFormat?: "mp3" | "wav" | "aac"
  readonly startTime?: number
  readonly endTime?: number
}

interface TrimAudioResult {
  readonly audioPath: string
}

/**
 * The ffmpeg arguments that cut a file's sound to [`startTime`, `endTime`) in
 * `audioFormat`. WAV and AAC take the cut as output `-ss`/`-to`; an MP3 takes
 * the same cut inside its chain, ahead of the encoder's frame size
 * (`mp3-encode.ts`).
 */
export function trimAudioArgs(
  videoPath: string,
  audioPath: string,
  audioFormat: "mp3" | "wav" | "aac",
  startTime?: number,
  endTime?: number,
): string[] {
  if (audioFormat === "mp3") {
    const cut = { ...(startTime != null ? { start: startTime } : {}), ...(endTime != null ? { end: endTime } : {}) }
    return ["-y", "-i", videoPath, "-vn", ...mp3EncodeArgs({ cut }), audioPath]
  }
  const codec = audioFormat === "wav" ? "pcm_s16le" : "aac"
  const timeArgs: string[] = []
  if (startTime != null) timeArgs.push("-ss", String(startTime))
  if (endTime != null) timeArgs.push("-to", String(endTime))
  return ["-y", "-i", videoPath, ...timeArgs, "-vn", "-acodec", codec, audioPath]
}

/**
 * The sound of a video, cut to a range. A social link is an import of a link,
 * and this is an ENGINE of the import gate (`lib/import-gate.ts`): the site's
 * policy and the content rights confirmation are checked before anything is
 * fetched and the confirmation spent right before yt-dlp runs; a refusal is
 * the gate's own error, never rewrapped. A direct file needs no rights
 * confirmation and passes the gate untouched, but a link to outside content,
 * in either shape, is refused first on a deployment that turned link imports
 * off (`lib/link-imports.ts`): the route answers it, and this is the backstop
 * for a workflow run, which reaches the worker without the route.
 */
export async function trimAudio(options: TrimAudioOptions, rights: ImportRights): Promise<TrimAudioResult> {
  const { videoUrl, audioFormat = "mp3", startTime, endTime } = options
  // The same refusal on every attempt: fail now, without a retry.
  const refusal = trimRangeRefusal(startTime, endTime)
  if (refusal) throw new DeterministicJobError(refusal)
  assertLinkImportAllowed(videoUrl)
  const social = isSocialMediaUrl(videoUrl)
  // Outside the work dir and the try below: a refusal is the gate's own error.
  if (social) await requireImportAllowed(videoUrl, rights)
  const workDir = await createWorkDir("trim-audio")

  try {
    const videoPath = join(workDir, "input.mp4")
    console.log("[trimAudio] Downloading video")

    if (social) {
      console.log("[trimAudio] Social media URL detected, using yt-dlp")
      // Nothing else can refuse the import now: spend the confirmation, then fetch.
      await spendImportConfirmation(videoUrl, rights)
      try {
        const ytDlpOptions: Record<string, unknown> = {
          output: videoPath,
          // Shared with the download path — this function EXTRACTS AUDIO, so a
          // selector that can land on a video-only format is fatal here. The old
          // one could: its `best[ext=mp4]` fallback happily picked TikTok's
          // h265 format, which claims `acodec=aac` and downloads without audio.
          format: VIDEO_FORMAT_SELECTOR,
          mergeOutputFormat: "mp4",
          noPlaylist: true,
          noCheckCertificates: true,
          // Residential proxy for YouTube (datacenter IP bot-block); no-op when unset.
          ...ytProxyOption(videoUrl),
          extractorArgs: "youtube:player_client=android",
          addHeader: [
            "referer:youtube.com",
            "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          ],
        }
        // Merge only (stream copy): classified exempt by its flags, so never held — but every yt-dlp run goes through
        // the funnel, which refuses a library run that would encode (the library cannot stop yt-dlp's ffmpeg).
        await withYtDlpOptionsAdmission(ytDlpOptions, () => youtubedl(videoUrl, ytDlpOptions))
      } catch (ytErr: unknown) {
        const stderr = (ytErr as { stderr?: string }).stderr ?? ""
        const msg = (ytErr as Error).message || stderr || "yt-dlp failed"
        console.error("[trimAudio] yt-dlp error:", stderr || msg)
        throw new Error(`yt-dlp download failed: ${msg}`)
      }
    } else {
      await downloadFile(videoUrl, videoPath)
    }

    const audioPath = join(workDir, `output.${audioFormat}`)
    await runFfmpeg(trimAudioArgs(videoPath, audioPath, audioFormat, startTime, endTime))

    console.log(`[trimAudio] Output: ${audioPath}`)
    return { audioPath }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
