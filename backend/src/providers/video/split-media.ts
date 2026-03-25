import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface SplitMediaOptions {
  readonly videoUrl?: string
  readonly audioUrl?: string
  readonly chunkDuration: number
  readonly audioFormat?: "mp3" | "wav" | "aac"
}

interface SplitMediaResult {
  readonly videoPaths?: string[]
  readonly audioPaths?: string[]
}

export async function splitMedia(options: SplitMediaOptions): Promise<SplitMediaResult> {
  const { videoUrl, audioUrl, chunkDuration, audioFormat = "mp3" } = options
  const workDir = await createWorkDir("split-media")
  try {
    const videoPaths: string[] = []
    const audioPaths: string[] = []

    if (videoUrl) {
      const inputPath = join(workDir, "input-video.mp4")
      console.log("[splitMedia] Downloading video")
      await downloadFile(videoUrl, inputPath)
      const videoOutputPattern = join(workDir, "video-chunk-%03d.mp4")
      await runFfmpeg([
        "-y", "-i", inputPath,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-f", "segment",
        "-segment_time", String(chunkDuration),
        "-reset_timestamps", "1",
        videoOutputPattern,
      ])
      const { readdirSync } = await import("node:fs")
      const files = readdirSync(workDir).filter(f => f.startsWith("video-chunk-")).sort()
      for (const f of files) videoPaths.push(join(workDir, f))
    }

    if (audioUrl) {
      const inputPath = join(workDir, "input-audio.mp3")
      console.log("[splitMedia] Downloading audio")
      await downloadFile(audioUrl, inputPath)
      const codecMap = { mp3: "libmp3lame", wav: "pcm_s16le", aac: "aac" } as const
      const audioOutputPattern = join(workDir, `audio-chunk-%03d.${audioFormat}`)
      await runFfmpeg([
        "-y", "-i", inputPath,
        "-f", "segment",
        "-segment_time", String(chunkDuration),
        "-reset_timestamps", "1",
        "-acodec", codecMap[audioFormat],
        audioOutputPattern,
      ])
      const { readdirSync } = await import("node:fs")
      const files = readdirSync(workDir).filter(f => f.startsWith("audio-chunk-")).sort()
      for (const f of files) audioPaths.push(join(workDir, f))
    }

    return {
      videoPaths: videoPaths.length > 0 ? videoPaths : undefined,
      audioPaths: audioPaths.length > 0 ? audioPaths : undefined,
    }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
