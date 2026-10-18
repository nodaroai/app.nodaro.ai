import { dirname } from "node:path"
import { removeAudio } from "../../providers/video/remove-audio.js"
import { uploadFileToR2 } from "../../lib/storage.js"
import { cleanupWorkDir } from "../../providers/video/ffmpeg-utils.js"
import { commitJobCredits, generateAndUploadThumbnail, markJobCompleted, setJobProgress, shouldSaveJobResult } from "../../workers/shared.js"
import type { UnitWorker } from "../kit.js"
import { descriptor } from "./descriptor.generated.js"

// The video-queue handler: download, stream-copy without the audio track
// (providers/video/remove-audio.ts), upload, thumbnail, complete, commit.
export const worker: UnitWorker = async function handleRemoveAudio(job, ctx) {
  const { videoUrl } = job.data as { jobId: string; videoUrl: string }
  console.log(`[worker] remove-audio ${ctx.jobId}`)
  const result = await removeAudio({ videoUrl, workDirPrefix: descriptor.type })
  await setJobProgress(job, ctx.jobId, 80)
  const r2Url = await uploadFileToR2(result.videoPath, ctx.jobId, "video", ctx.jobUserId)
  await cleanupWorkDir(dirname(result.videoPath))
  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}
