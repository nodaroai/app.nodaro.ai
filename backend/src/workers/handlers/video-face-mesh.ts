/**
 * `video-face-mesh` worker handler — an internal child step
 * (routes/video-face-mesh.ts): the clips downloaded into a work dir (through
 * the SSRF-guarded download), the lines drawn locally
 * (services/face-mesh/draw-face-mesh.ts), the result uploaded as it is (never
 * watermarked: it is what the video model is sent) and the job completed with
 * what was drawn. No provider, no reconcile: a crash re-runs the job on its
 * BullMQ retry. An unreadable clip, frame counts that differ, or a host
 * without the model fail deterministically (refunded once); no face is not a
 * failure (`facesDrawn: 0`).
 */
import { join } from "node:path"
import { VIDEO_FACE_MESH_RECIPE, resolveVideoMaskZone } from "@nodaro/shared/media"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { uploadFileToR2 } from "../../lib/storage.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import { cleanupWorkDir, createWorkDir, downloadFile } from "../../providers/video/ffmpeg-utils.js"
import { drawFaceMeshVideo, faceMeshOutputPath } from "../../services/face-mesh/draw-face-mesh.js"
import {
  commitJobCredits,
  generateAndUploadThumbnail,
  markJobCompleted,
  setJobProgress,
  shouldSaveJobResult,
  type HandlerFn,
} from "../shared.js"

const pctOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(100, v) : 0)

const handleVideoFaceMesh: HandlerFn = async function handleVideoFaceMesh(job, ctx) {
  const d = job.data as {
    jobId: string
    videoUrl?: string
    drawOnUrl?: string
    maskUrl?: string
    minFaceHeightPct?: number
    maxFaceHeightPct?: number
    zone?: unknown
  }
  if (typeof d.videoUrl !== "string" || !d.videoUrl) throw new DeterministicJobError("Video Face Mesh needs a video.")
  const filters = { minFaceHeightPct: pctOf(d.minFaceHeightPct), maxFaceHeightPct: pctOf(d.maxFaceHeightPct), zone: resolveVideoMaskZone(d.zone) }
  const drawOn = typeof d.drawOnUrl === "string" && d.drawOnUrl && d.drawOnUrl !== d.videoUrl ? d.drawOnUrl : undefined
  const mask = typeof d.maskUrl === "string" && d.maskUrl ? d.maskUrl : undefined
  console.log(`[worker] video-face-mesh ${ctx.jobId}: ${drawOn ? "drawn on another clip" : "drawn on the clip"}${mask ? ", inside a mask" : ""}`)

  const workDir = await createWorkDir("video-face-mesh")
  try {
    const videoPath = join(workDir, "video.mp4")
    await downloadFile(d.videoUrl, videoPath)
    const drawOnPath = drawOn ? join(workDir, "draw-on.mp4") : videoPath
    if (drawOn) await downloadFile(drawOn, drawOnPath)
    const maskPath = mask ? join(workDir, "mask.mp4") : undefined
    if (mask && maskPath) await downloadFile(mask, maskPath)
    await setJobProgress(job, ctx.jobId, 10)

    const r = await drawFaceMeshVideo({ videoPath, drawOnPath, ...(maskPath ? { maskPath } : {}), filters, outputPath: faceMeshOutputPath(workDir) })
    await setJobProgress(job, ctx.jobId, 90)
    console.log(
      `[worker] video-face-mesh ${ctx.jobId}: ${r.facesDrawn} face(s) drawn on ${r.framesWithFaces}/${r.frames} frames, ` +
        `${(r.cpuMs / Math.max(1, r.frames)).toFixed(1)} CPU-ms a frame`,
    )

    // The drawing is done; an upload failure from here on is post-processing.
    const videoUrl = await runPostProcessing(() => uploadFileToR2(r.outputPath, ctx.jobId, "video", ctx.jobUserId))
    const thumbnailUrl = await generateAndUploadThumbnail(videoUrl, ctx.jobId, ctx.jobUserId)
    if (!await shouldSaveJobResult(ctx.jobId)) return
    const ok = await markJobCompleted(ctx.jobId, {
      output_data: {
        videoUrl,
        thumbnailUrl,
        width: r.width,
        height: r.height,
        frames: r.frames,
        framesWithFaces: r.framesWithFaces,
        facesDrawn: r.facesDrawn,
        recipe: VIDEO_FACE_MESH_RECIPE,
      },
    })
    if (!ok) return
    await commitJobCredits(ctx.usageLogId, ctx.jobId)
  } finally {
    await cleanupWorkDir(workDir)
  }
}

export const videoFaceMeshHandlers: Record<string, HandlerFn> = { "video-face-mesh": handleVideoFaceMesh }
export { handleVideoFaceMesh }
