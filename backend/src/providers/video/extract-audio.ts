import { join } from "node:path"
import { downloadFile, runFfmpeg, hasAudioStream, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

/**
 * Provider for the "Extract Audio" node: download a video and demux its audio
 * track to a standalone MP3.
 *
 * Distinct from `extract-audio-track.ts`, which is an INTERNAL voice-changer
 * helper — that one keeps its work dir open for a follow-up remux and throws a
 * revoice-specific error. This provider owns its full lifecycle (the worker
 * cleans up via `dirname(audioPath)` after upload) and fails with a generic
 * message when the clip is silent.
 */
export interface ExtractAudioOptions {
  readonly videoUrl: string
}

export interface ExtractAudioResult {
  /** Local path to the extracted MP3. Caller owns cleanup of its dirname. */
  readonly audioPath: string
}

export async function extractAudio({ videoUrl }: ExtractAudioOptions): Promise<ExtractAudioResult> {
  const workDir = await createWorkDir("extract-audio")
  try {
    const videoPath = join(workDir, "input.mp4")
    console.log("[extractAudio] Downloading video")
    await downloadFile(videoUrl, videoPath)

    if (!(await hasAudioStream(videoPath))) {
      throw new Error("This video has no audio track to extract.")
    }

    const audioPath = join(workDir, "audio.mp3")
    await runFfmpeg(["-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", "-q:a", "2", audioPath])
    return { audioPath }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
