import { dirname } from "node:path"
import { uploadFileToR2 } from "../../lib/storage.js"
import { cleanupWorkDir } from "./ffmpeg-utils.js"
import { smartLoopCut, type SmartLoopCutOptions } from "./smart-loop-cut.js"

/** Apply smart-loop-cut as a post-process to a video URL.
 *  Downloads from R2 (or whatever URL source smartLoopCut accepts), runs
 *  smart-loop-cut, uploads the result back to R2, returns the new URL.
 *  Cleans up the work directory.
 *
 *  Used by the i2v worker handler to replace the legacy VEO-only fixed
 *  8-frame trim. Throws on failure — caller is responsible for keeping
 *  the original URL and refunding the addon.
 *
 *  `userId` is forwarded to uploadFileToR2 for storage-quota tracking.
 *  Accepts `undefined` (matching `WorkerContext.jobUserId` and the upstream
 *  uploadFileToR2 signature) so the worker can pass `ctx.jobUserId` directly
 *  without a non-null assertion. */
export async function applySmartLoopCutToR2Url(
  videoUrl: string,
  jobId: string,
  userId: string | undefined,
  options: Omit<SmartLoopCutOptions, "videoUrl">,
): Promise<string> {
  const slc = await smartLoopCut({ videoUrl, ...options })
  try {
    const newUrl = await uploadFileToR2(slc.videoPath, `${jobId}-loop-cut`, "video", userId)
    return newUrl
  } finally {
    await cleanupWorkDir(dirname(slc.videoPath))
  }
}
