/**
 * Bring a RENDER that nodaro.ai finished home to this install (SV13, decided
 * 2026-10-06).
 *
 * The relay's generic video path (`uploadVideoMaybeWatermark`) downloads under
 * the flat 120-second limit and then watermarks or transcodes. A Speaker View
 * final can be hours long and several GB: it would time out there, or be
 * re-encoded. A render of the user's own footage is a processing result, which
 * is never watermarked (core Apply EDL uploads plain), and nodaro.ai already
 * encoded it browser-safe — so it is copied as it is, under the big-media
 * download limits, and its thumbnail is cut from the local copy rather than by
 * downloading the file a second time.
 *
 * POST-PROVIDER: nodaro.ai has already billed the connected account for the
 * render, so a failure here must never refund (`runPostProcessing`).
 */
import { join } from "node:path"
import {
  BIG_MEDIA_DOWNLOAD_LIMITS,
  cleanupWorkDir,
  createWorkDir,
  downloadFile,
} from "../../providers/video/ffmpeg-utils.js"
import { uploadBufferToR2, uploadFileToR2 } from "../../lib/storage.js"
import { thumbnailFromLocalVideo } from "../../utils/thumbnail.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"

export async function bringRenderHome(
  videoUrl: string,
  jobId: string,
  jobUserId: string | undefined,
): Promise<{ videoUrl: string; thumbnailUrl: string | null }> {
  return runPostProcessing(async () => {
    const workDir = await createWorkDir("relay-render")
    try {
      const localPath = join(workDir, "render.mp4")
      await downloadFile(videoUrl, localPath, { limits: BIG_MEDIA_DOWNLOAD_LIMITS })
      const r2Url = await uploadFileToR2(localPath, jobId, "video", jobUserId)
      let thumbnailUrl: string | null = null
      try {
        const frame = await thumbnailFromLocalVideo(localPath)
        thumbnailUrl = await uploadBufferToR2(frame, `thumbnails/${jobId}.png`, "image/png", jobUserId)
      } catch (err) {
        console.warn(`[worker] ${jobId}: no thumbnail for the relayed render:`, err instanceof Error ? err.message : err)
      }
      return { videoUrl: r2Url, thumbnailUrl }
    } finally {
      await cleanupWorkDir(workDir)
    }
  })
}
