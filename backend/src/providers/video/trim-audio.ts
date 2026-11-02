import { join } from "node:path"
import youtubedl from "youtube-dl-exec"
import { ytProxyOption } from "./yt-proxy.js"
import { withYtDlpOptionsAdmission } from "./ytdlp-admission.js"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"
import { isAllowedSocialVideoUrl } from "../../lib/url-validator.js"
import { requireImportAllowed, spendImportConfirmation, type ImportRights } from "../../lib/import-gate.js"
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
 * The sound of a video, cut to a range. A social link is an import of a link,
 * and this is an ENGINE of the import gate (`lib/import-gate.ts`): the site's
 * policy and the content rights confirmation are checked before anything is
 * fetched and the confirmation spent right before yt-dlp runs; a refusal is
 * the gate's own error, never rewrapped. A direct file is not an import of a
 * link and passes the gate untouched.
 */
export async function trimAudio(options: TrimAudioOptions, rights: ImportRights): Promise<TrimAudioResult> {
  const { videoUrl, audioFormat = "mp3", startTime, endTime } = options
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

    const codecMap = { mp3: "libmp3lame", wav: "pcm_s16le", aac: "aac" } as const
    const audioPath = join(workDir, `output.${audioFormat}`)

    const timeArgs: string[] = []
    if (startTime != null) timeArgs.push("-ss", String(startTime))
    if (endTime != null) timeArgs.push("-to", String(endTime))

    await runFfmpeg([
      "-y",
      "-i", videoPath,
      ...timeArgs,
      "-vn",
      "-acodec", codecMap[audioFormat],
      audioPath,
    ])

    console.log(`[trimAudio] Output: ${audioPath}`)
    return { audioPath }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
