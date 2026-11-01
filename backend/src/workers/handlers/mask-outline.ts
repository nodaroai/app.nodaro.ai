/**
 * `mask-outline` worker handler — an internal child step
 * (routes/mask-outline.ts): the clip and its mask downloaded into a work dir
 * (through the SSRF-guarded download), the rings drawn locally
 * (services/mask-outline/), the result uploaded as it is (never watermarked:
 * it is what the video model is sent) and the job completed with what was
 * drawn. No provider, no reconcile: a crash re-runs the job on its BullMQ
 * retry. An unreadable clip or mask, or frame counts that cannot be matched,
 * fail deterministically (refunded once); no region for an outline is not a
 * failure (`regionsDrawn: 0`).
 */
import { join } from "node:path"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { uploadFileToR2 } from "../../lib/storage.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import { cleanupWorkDir, createWorkDir, downloadFile } from "../../providers/video/ffmpeg-utils.js"
import type { MaskEraseBoxInput } from "../../providers/video/mask-erase.js"
import { MASK_OUTLINE_RECIPE, drawMaskOutlineVideo, maskOutlineOutputPath } from "../../services/mask-outline/draw-mask-outline.js"
import {
  commitJobCredits,
  generateAndUploadThumbnail,
  markJobCompleted,
  setJobProgress,
  shouldSaveJobResult,
  type HandlerFn,
} from "../shared.js"

const COLOUR_RE = /^#[0-9A-Fa-f]{6}$/

const handleMaskOutline: HandlerFn = async function handleMaskOutline(job, ctx) {
  const d = job.data as { jobId: string; videoUrl?: string; maskUrl?: string; outlines?: Array<{ colour?: unknown; boxes?: MaskEraseBoxInput[] }> }
  const outlines = Array.isArray(d.outlines)
    ? d.outlines.filter((o) => typeof o.colour === "string" && COLOUR_RE.test(o.colour) && Array.isArray(o.boxes) && o.boxes.length > 0)
    : []
  if (typeof d.videoUrl !== "string" || !d.videoUrl || typeof d.maskUrl !== "string" || !d.maskUrl || outlines.length === 0) {
    throw new DeterministicJobError("Mask Outline needs a video, its mask and at least one outline.")
  }
  if (outlines.length !== d.outlines!.length) throw new DeterministicJobError("Mask Outline: an outline has no colour or no box.")
  console.log(`[worker] mask-outline ${ctx.jobId}: ${outlines.length} outline(s), ${outlines.reduce((n, o) => n + o.boxes!.length, 0)} box(es)`)

  const workDir = await createWorkDir("mask-outline")
  try {
    const videoPath = join(workDir, "video.mp4")
    const maskPath = join(workDir, "mask.mp4")
    await downloadFile(d.videoUrl, videoPath)
    await downloadFile(d.maskUrl, maskPath)
    await setJobProgress(job, ctx.jobId, 10)

    const r = await drawMaskOutlineVideo({
      videoPath,
      maskPath,
      outlines: outlines.map((o) => ({ colour: o.colour as string, boxes: o.boxes! })),
      outputPath: maskOutlineOutputPath(workDir),
    })
    await setJobProgress(job, ctx.jobId, 90)
    console.log(
      `[worker] mask-outline ${ctx.jobId}: ${r.perOutline.map((o) => `${o.regionsDrawn} region(s) on ${o.framesDrawn}`).join(", ")} of ${r.frames} frames, ` +
        `${r.ambiguous} ambiguous`,
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
        perOutline: r.perOutline,
        ambiguous: r.ambiguous,
        strokePx: r.strokePx,
        recipe: MASK_OUTLINE_RECIPE,
      },
    })
    if (!ok) return
    await commitJobCredits(ctx.usageLogId, ctx.jobId)
  } finally {
    await cleanupWorkDir(workDir)
  }
}

export const maskOutlineHandlers: Record<string, HandlerFn> = { "mask-outline": handleMaskOutline }
export { handleMaskOutline }
