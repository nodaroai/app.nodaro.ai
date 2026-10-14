/**
 * `video-depth` worker branch: dispatch to the fal or Replicate provider
 * function, upload (watermark-aware), thumbnail, finalize. Mirrors
 * handleLipSync's fal/replicate lanes. The reconcile hook is armed BEFORE the
 * provider polls, so a crash mid-poll is recoverable (lib/reconcile/fal.ts,
 * lib/reconcile/replicate.ts).
 *
 * The Replicate model only renders inferno; when the run's resolved colormap
 * is grayscale (`videoDepthNeedsGrayscalePass`) the delivered video goes
 * through an ffmpeg grayscale pass before upload. fal renders every colormap
 * itself.
 */
import {
  FAL_VIDEO_DEPTH_PROVIDERS,
  REPLICATE_VIDEO_DEPTH_PROVIDERS,
  videoDepthNeedsGrayscalePass,
} from "@nodaro/shared/media"
import { falVideoDepth } from "../../providers/fal/video-depth.js"
import { replicateVideoDepth } from "../../providers/replicate/video-depth.js"
import type { VideoDepthParams } from "../../providers/video-depth-params.js"
import { grayscaleVideo } from "../../providers/video/grayscale-video.js"
import { cleanupWorkDir } from "../../providers/video/ffmpeg-utils.js"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import { finalizeJobWithMedia } from "../../lib/job-finalize.js"
import {
  uploadVideoMaybeWatermark,
  watermarkLocalVideoAndUpload,
  generateAndUploadThumbnail,
  setJobProgress,
  startProgressRamp,
  type HandlerFn,
} from "../shared.js"

type DepthResult = { videoUrl: string; cost: number | null }

const handleVideoDepth: HandlerFn = async function handleVideoDepth(job, ctx) {
  const d = job.data as Record<string, unknown>
  const provider = String(d.provider ?? "video-depth-anything")
  const videoUrl = typeof d.videoUrl === "string" ? d.videoUrl : ""
  const colormap = d.colormap as VideoDepthParams["colormap"]
  const params: VideoDepthParams = {
    modelSize: d.modelSize as VideoDepthParams["modelSize"],
    colormap,
    resolution: d.resolution as VideoDepthParams["resolution"],
    sideBySide: d.sideBySide as boolean | undefined,
    // The route queues `durationSec`; the orchestrator's stamp hook writes `duration_seconds`.
    durationSec: (d.durationSec ?? d.duration_seconds) as number | undefined,
  }

  let run: () => Promise<DepthResult>
  let providerUsed: string
  if (FAL_VIDEO_DEPTH_PROVIDERS.has(provider)) {
    const reconcileOpts = { onTaskCreated: makeOnTaskCreated(ctx.jobId, "fal-request") }
    run = () => falVideoDepth(provider, videoUrl, params, reconcileOpts)
    providerUsed = "fal"
  } else if (REPLICATE_VIDEO_DEPTH_PROVIDERS.has(provider)) {
    const reconcileOpts = { onTaskCreated: makeOnTaskCreated(ctx.jobId, "replicate-prediction") }
    run = () => replicateVideoDepth(provider, videoUrl, params, reconcileOpts)
    providerUsed = `replicate:${provider}`
  } else {
    throw new Error(`Unsupported video-depth provider: ${provider}`)
  }
  if (!videoUrl) throw new Error("video-depth requires a videoUrl")

  await setJobProgress(job, ctx.jobId, 5)
  const ramp = startProgressRamp(job, ctx.jobId, { start: 5, cap: 45 })
  let out: DepthResult
  try {
    out = await run()
  } finally {
    ramp.stop()
  }

  await setJobProgress(job, ctx.jobId, 50)
  let r2Url: string
  if (videoDepthNeedsGrayscalePass(provider, colormap)) {
    // A crash-recovered Replicate row skips this pass: reconcile finalizes the provider (inferno) URL as-is.
    let gray: { outputPath: string; workDir: string } | undefined
    try {
      gray = await runPostProcessing(() => grayscaleVideo(out.videoUrl))
      r2Url = await watermarkLocalVideoAndUpload(gray.outputPath, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
    } finally {
      if (gray) await cleanupWorkDir(gray.workDir)
    }
  } else {
    r2Url = await uploadVideoMaybeWatermark(out.videoUrl, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  }
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)
  await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "video-depth",
    result: { url: out.videoUrl, cost: out.cost, displayCost: out.cost, providerUsed },
    mediaUrl: r2Url,
    extraOutputData: { thumbnailUrl: thumbUrl },
  })
}

export const videoDepthHandlers: Record<string, HandlerFn> = { "video-depth": handleVideoDepth }
export { handleVideoDepth }
