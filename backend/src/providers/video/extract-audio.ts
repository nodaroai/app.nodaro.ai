import { join } from "node:path"
import youtubedl from "youtube-dl-exec"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

const SOCIAL_MEDIA_HOSTS = [
  "youtube.com", "youtu.be",
  "tiktok.com",
  "instagram.com",
  "twitter.com", "x.com",
  "facebook.com", "fb.watch", "fb.com",
]

function isSocialMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return SOCIAL_MEDIA_HOSTS.some((h) => parsed.hostname.includes(h))
  } catch {
    return false
  }
}

interface ExtractAudioOptions {
  readonly videoUrl: string
  readonly audioFormat?: "mp3" | "wav" | "aac"
  readonly outputSilentVideo?: boolean
  readonly startTime?: number
  readonly endTime?: number
}

interface ExtractAudioResult {
  readonly audioPath: string
  readonly silentVideoPath?: string
}

export async function extractAudio(options: ExtractAudioOptions): Promise<ExtractAudioResult> {
  const { videoUrl, audioFormat = "mp3", outputSilentVideo = false, startTime, endTime } = options
  const workDir = await createWorkDir("extract-audio")

  try {
    const videoPath = join(workDir, "input.mp4")
    console.log("[extractAudio] Downloading video")

    if (isSocialMediaUrl(videoUrl)) {
      console.log("[extractAudio] Social media URL detected, using yt-dlp")
      try {
        await youtubedl(videoUrl, {
          output: videoPath,
          format: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
          mergeOutputFormat: "mp4",
          noPlaylist: true,
          noCheckCertificates: true,
          extractorArgs: "youtube:player_client=android",
          addHeader: [
            "referer:youtube.com",
            "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          ],
        } as Record<string, unknown>)
      } catch (ytErr: unknown) {
        const stderr = (ytErr as { stderr?: string }).stderr ?? ""
        const msg = (ytErr as Error).message || stderr || "yt-dlp failed"
        console.error("[extractAudio] yt-dlp error:", stderr || msg)
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

    let silentVideoPath: string | undefined
    if (outputSilentVideo) {
      silentVideoPath = join(workDir, "silent.mp4")
      await runFfmpeg([
        "-y",
        "-i", videoPath,
        "-an",
        "-c:v", "copy",
        silentVideoPath,
      ])
    }

    console.log(`[extractAudio] Output: ${audioPath}`)
    return { audioPath, silentVideoPath }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
