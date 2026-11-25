import { join } from "node:path"
import {
  cleanupWorkDir,
  createWorkDir,
  downloadFile,
  restoreVideoAudioFromSource,
} from "../../providers/video/ffmpeg-utils.js"
import { uploadVideoMaybeWatermark, watermarkLocalVideoAndUpload } from "../shared.js"
import type { StoredVideo } from "../../lib/video-result-store.js"

export interface SwapUploadTarget {
  readonly jobId: string
  readonly jobUserId: string | undefined
  readonly shouldWatermark: boolean
}

/**
 * Upload a Face Swap result WITH the source clip's sound.
 *
 * The swap model returns the picture only, with no audio stream at all, so
 * every swapped clip used to lose its dialogue and ambience. This lays the
 * source's own first audio track back onto the swapped picture, which is kept
 * untouched (stream copy), then uploads through the usual watermark lane.
 *
 * A source with no sound keeps the swap as it came back. Restoring is
 * best-effort: the provider has already delivered (and billed), so a failed
 * download or mux delivers the silent swap instead of failing the job.
 */
export async function uploadSwapWithSourceAudio(
  swapUrl: string,
  sourceVideoUrl: string,
  target: SwapUploadTarget,
): Promise<StoredVideo> {
  const workDir = await createWorkDir("face-swap-audio")
  try {
    const local = await swapWithSourceAudio(workDir, swapUrl, sourceVideoUrl, target.jobId)
    return local
      ? await watermarkLocalVideoAndUpload(local.path, target.jobId, target.jobUserId, target.shouldWatermark)
      : await uploadVideoMaybeWatermark(swapUrl, target.jobId, target.jobUserId, target.shouldWatermark)
  } finally {
    await cleanupWorkDir(workDir)
  }
}

/** The swap downloaded beside the source: the file to deliver and whether it
 *  carries the source's sound. */
export interface LocalSwap {
  readonly path: string
  /** False when the source has no sound: `path` is the swap as it came back. */
  readonly hasSourceAudio: boolean
}

/** The local file to deliver: the swap with the source's sound, the swap alone
 *  when the source is silent, or undefined when restoring failed. Shared with
 *  the reconcile lane (`lib/reconcile/face-swap-audio.ts`), which delivers a
 *  swap its worker did not live to finish. */
export async function swapWithSourceAudio(
  workDir: string,
  swapUrl: string,
  sourceVideoUrl: string,
  jobId: string,
): Promise<LocalSwap | undefined> {
  const swapped = join(workDir, "swapped.mp4")
  const source = join(workDir, "source.mp4")
  const withAudio = join(workDir, "with-audio.mp4")
  try {
    await downloadFile(swapUrl, swapped)
    await downloadFile(sourceVideoUrl, source)
    return (await restoreVideoAudioFromSource(swapped, source, withAudio))
      ? { path: withAudio, hasSourceAudio: true }
      : { path: swapped, hasSourceAudio: false }
  } catch (err) {
    console.warn(
      `[worker] face-swap ${jobId}: could not restore the source audio, delivering the swap as returned: ${err instanceof Error ? err.message : String(err)}`,
    )
    return undefined
  }
}
