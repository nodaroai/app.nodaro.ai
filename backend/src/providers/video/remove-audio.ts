import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

/**
 * Provider for the "Remove Audio" node: strip the audio track from a video,
 * leaving a silent clip. Stream-copies the video stream (`-c:v copy -an`) so
 * there's no re-encode — near-instant and lossless. The result is the inverse
 * tap of `extract-audio` / the partner of `merge-video-audio`.
 */
export interface RemoveAudioOptions {
  readonly videoUrl: string
}

export interface RemoveAudioResult {
  /** Local path to the silent video. Caller owns cleanup of its dirname. */
  readonly videoPath: string
}

export async function removeAudio({ videoUrl }: RemoveAudioOptions): Promise<RemoveAudioResult> {
  const workDir = await createWorkDir("remove-audio")
  try {
    const inputPath = join(workDir, "input.mp4")
    console.log("[removeAudio] Downloading video")
    await downloadFile(videoUrl, inputPath)

    const outputPath = join(workDir, "silent.mp4")
    // Stream-copy the video, drop every audio stream. No re-encode.
    await runFfmpeg(["-y", "-i", inputPath, "-c:v", "copy", "-an", outputPath])
    return { videoPath: outputPath }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
