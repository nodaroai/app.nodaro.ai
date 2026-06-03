import { join } from "node:path"
import { downloadFile, runFfmpeg, hasAudioStream, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

/** Thrown when the source video has no audio track to revoice. The worker
 *  surfaces `message` verbatim as the job's user-facing error. */
export class NoAudioTrackError extends Error {
  constructor() {
    super("This video has no audio track to revoice. Use a clip with spoken audio (e.g. a Veo3 / lip-synced video), or feed audio directly.")
    this.name = "NoAudioTrackError"
  }
}

export interface ExtractedAudio {
  /** Local path to the extracted MP3. */
  readonly audioPath: string
  /** Work dir to clean up once the caller is done with `audioPath`. */
  readonly workDir: string
}

/**
 * Download a video once, verify it has an audio stream, and extract that audio
 * as MP3 for the voice-changer speech-to-speech pass. Throws `NoAudioTrackError`
 * when the clip is silent so the worker can fail with a friendly message instead
 * of a cryptic ffmpeg error.
 *
 * The caller owns `workDir` cleanup (so the extracted audio survives until it's
 * read into a buffer). `downloadFile` is SSRF-guarded (`safeFetch`).
 */
export async function extractAudioTrack(videoUrl: string): Promise<ExtractedAudio> {
  const workDir = await createWorkDir("vc-extract")
  try {
    const videoPath = join(workDir, "input.mp4")
    await downloadFile(videoUrl, videoPath)

    if (!(await hasAudioStream(videoPath))) {
      throw new NoAudioTrackError()
    }

    const audioPath = join(workDir, "audio.mp3")
    await runFfmpeg(["-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", "-q:a", "2", audioPath])
    return { audioPath, workDir }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
