import { dirname, join } from "node:path"
import { promises as fs } from "node:fs"
import type { Job } from "bullmq"
import type { Caption } from "@remotion/captions"
import { createHash } from "node:crypto"
import { uploadFileToR2, uploadFileWithKeyToR2, getR2ObjectSize, r2Url } from "../../lib/storage.js"
import { renderQueue } from "../../lib/render-queue.js"
import { supabase } from "../../lib/supabase.js"
import { cleanupWorkDir, createWorkDir, downloadFile, runFfmpeg, BROWSER_SAFE_VIDEO_ARGS, probeVideoSource } from "../../providers/video/ffmpeg-utils.js"
import { combineVideos } from "../../providers/video/combine-videos.js"
import { applyEdl } from "../../providers/video/apply-edl.js"
import { declaredJobBudgetMs } from "../../lib/job-budget.js"
import { assembleNarratedVideo } from "../../providers/video/assemble-narrated-video.js"
import { createImageCollage } from "../../providers/image/collage.js"
import { createImageOverlay, type ImageOverlayParams } from "../../providers/image/overlay.js"
import { socialMediaFormat } from "../../providers/video/social-media-format.js"
import { mergeVideoAudio } from "../../providers/video/merge-video-audio.js"
import { trimAudio } from "../../providers/video/trim-audio.js"
import { trimVideo } from "../../providers/video/trim-video.js"
import { smartLoopCut } from "../../providers/video/smart-loop-cut.js"
import { extractFrame } from "../../providers/video/extract-frame.js"
import { splitMedia } from "../../providers/video/split-media.js"
import { extractAudio } from "../../providers/video/extract-audio.js"
import { removeAudio } from "../../providers/video/remove-audio.js"
import { resizeVideo } from "../../providers/video/resize-video.js"
import { adjustVolume } from "../../providers/video/adjust-volume.js"
import { applyAudioFx } from "../../providers/video/audio-fx.js"
import { addCaptions } from "../../providers/video/add-captions.js"
import { mixAudio } from "../../providers/video/mix-audio.js"
import { combineAudio } from "../../providers/video/combine-audio.js"
import { speedRamp } from "../../providers/video/speed-ramp.js"
import { loopVideo } from "../../providers/video/loop-video.js"
import { fadeVideo } from "../../providers/video/fade-video.js"
import { renderVideoOverlay, type VideoOverlayJobPayload } from "../../providers/video/video-overlay.js"
import { stillToVideo } from "../../providers/video/still-to-video.js"
import { gifToVideo } from "../../providers/video/gif-to-video.js"
import { slideshow } from "../../providers/video/slideshow.js"
import { transcribe, type TranscribeProvider } from "../../providers/audio/transcribe.js"
import { detectSilence } from "../../providers/audio/silence-detect.js"
import { audioSync } from "../../providers/audio/audio-sync.js"
import { config } from "../../lib/config.js"
import { syntheticCaptionsFromText, transcribeSegmentsToCaptions, transcriptToCaptions } from "../../providers/audio/captions-mappers.js"
import {
  captionRenderFps,
  captionRenderFpsWithinFrameCap,
  captionsNeedWordTimings,
  explicitLevers,
  isStaticTextCaptionSource,
  resolveCaptionSegments,
  staticTextCaptionBlock,
  type CaptionSegmentInput,
} from "../../providers/video/caption-segments.js"
import { BURN_CAPTIONS_FPS_FALLBACK } from "../../lib/plan-schemas.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  markJobCompleted,
  generateAndUploadThumbnail,
  completeFfmpegVideoJob,
  completeFfmpegAudioJob,
  setJobProgress,
  type HandlerFn,
  type JobContext,
} from "../shared.js"
import { captionRoutesToRemotion, normalizeTranscript, remapTranscriptThroughEdl, resolveCaptionLevers, transcribeLaneSupportsWordTimestamps, TRANSCRIBE_PROVIDERS, TRANSCRIBE_PROVIDER_CAPABILITIES, type Edl, type SupportedFontName, type Transcript, type CaptionLookId } from "@nodaro/shared"
import { attachAssetToCharacter, resolveAssetColumn } from "../../lib/character-auto-attach.js"
import { DrainAbortError } from "../../lib/worker-drain.js"

/**
 * The transcription lane a KEYLESS install relays add-captions' auto-transcribe
 * through. It must satisfy BOTH ends: the cloud's `/v1/transcribe` Zod enum
 * (`TRANSCRIBE_PROVIDERS` — the ENABLED subset, which no longer holds either
 * Replicate lane) and the word-timings capability this render needs. Derived
 * from the two shared tables so disabling or adding a lane moves it for free;
 * `undefined` (nothing enabled can do word timings) is handled at the call site.
 */
const CLOUD_RELAY_TRANSCRIBE_PROVIDER = TRANSCRIBE_PROVIDERS.find(
  (p) => TRANSCRIBE_PROVIDER_CAPABILITIES[p].wordTimestamps,
)

const handleCombineVideos: HandlerFn = async function handleCombineVideos(job, ctx) {
  const { videoUrls, transition, transitionDuration, audioMode, audioCrossfadeCurve, audioCrossfadeDuration, smartCutEnabled, smartCutMode, smartCutFramesPrev, smartCutFramesNext, trimStartFrames, trimEndFrames, transitions, edgeFades } = job.data as {
    jobId: string
    videoUrls: string[]
    /** Validated upstream against `COMBINE_TRANSITION_IDS` at the route's
     *  Zod boundary; the worker just forwards the string. */
    transition: string
    transitionDuration: number
    audioMode?: "keep" | "crossfade" | "remove"
    audioCrossfadeCurve?: string
    /** Audio-only crossfade length; undefined → provider falls back to
     *  transitionDuration (pre-split workflows). */
    audioCrossfadeDuration?: number
    smartCutEnabled?: boolean
    /** Cut-point algorithm — validated at the route's Zod boundary. */
    smartCutMode?: "best-pair" | "preroll-keep-prev" | "preroll-keep-next"
    smartCutFramesPrev?: number
    smartCutFramesNext?: number
    trimStartFrames?: number
    trimEndFrames?: number
    /** Per-boundary seam devices; `index` = the join between clip k and k+1.
     *  Ids validated upstream at the route's Zod boundary. */
    transitions?: Array<{ index: number; transition: string; duration: number }>
    /** Film-edge fades in seconds (opening fade-in / closing fade-out). */
    edgeFades?: { in?: number; out?: number }
  }
  console.log(`[worker] combine-videos ${ctx.jobId}: ${videoUrls.length} videos, transition=${transition}, audio=${audioMode ?? "crossfade"}, curve=${audioCrossfadeCurve ?? "linear"}, audioXfade=${audioCrossfadeDuration ?? "(=transition)"}, trimStart=${trimStartFrames ?? 0}, trimEnd=${trimEndFrames ?? 0}`)

  const { outputPath, smartCuts } = await combineVideos({
    videoUrls, transition, transitionDuration,
    audioMode: audioMode ?? "crossfade", audioCrossfadeCurve, audioCrossfadeDuration,
    trimStartFrames: trimStartFrames ?? 0, trimEndFrames: trimEndFrames ?? 0,
    smartCut: smartCutEnabled
      ? { enabled: true, framesFromPrev: smartCutFramesPrev ?? 8, framesFromNext: smartCutFramesNext ?? 8, mode: smartCutMode ?? "best-pair" }
      : undefined,
    // Forwarded verbatim — both are fully optional in the provider and absent
    // means byte-identical to a job created before they existed.
    transitions,
    edgeFades,
  })
  await setJobProgress(job, ctx.jobId, 80)

  const r2Url = await uploadFileToR2(outputPath, ctx.jobId, "video", ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)

  // combineVideos uses its own temp dir structure (not cleanupWorkDir-compatible)
  await fs.rm(dirname(outputPath), { recursive: true, force: true }).catch(() => {})

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    // smartCuts: per-boundary cut decisions (frames trimmed on each side of
    // every junction + match PSNR) so users can see where each cut landed.
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl, ...(smartCuts ? { smartCuts } : {}) },
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

/** Parse a JSON string, returning undefined (never throwing) on bad input —
 *  an unparseable wired transcript degrades to "no remap", not a failed render. */
function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

/**
 * apply-edl: render the (already effective + validated) EDL into ONE media
 * file, and — when a transcript was wired — the transcript remapped through the
 * cut. Dual output_data: the media URL on `videoUrl`/`audioUrl`, the remapped
 * Transcript on `json`. `completeFfmpegAudioJob` has no extra-output slot, so
 * this handler writes its own `markJobCompleted` to carry `json` on both
 * output modes.
 */
const handleApplyEdl: HandlerFn = async function handleApplyEdl(job, ctx) {
  const { edl, transcript, output, quality } = job.data as {
    jobId: string
    edl: Edl
    /** Optional upstream Transcript (JSON string OR object) to remap through
     *  the cut for the `json` output handle. */
    transcript?: unknown
    output?: "video" | "audio"
    quality?: "proxy" | "final"
  }
  const outputKind = output === "audio" ? "audio" : "video"
  console.log(`[worker] apply-edl ${ctx.jobId}: ${edl.segments.length} segments, output=${outputKind}, quality=${quality ?? "final"}`)

  const { outputPath } = await applyEdl({
    edl,
    output: outputKind,
    quality: quality === "proxy" ? "proxy" : "final",
    jobId: ctx.jobId,
    jobUserId: ctx.jobUserId,
    onProgress: (f) => {
      void setJobProgress(job, ctx.jobId, Math.round(5 + f * 80)).catch(() => {})
    },
  })
  await setJobProgress(job, ctx.jobId, 90)

  // Remap the transcript through the SAME EDL the media was rendered from, so
  // captions built downstream align to the cut (±80 ms under D17).
  let remapped: Transcript | undefined
  if (transcript !== undefined && transcript !== null) {
    const raw = typeof transcript === "string" ? safeParseJson(transcript) : transcript
    if (raw !== undefined) remapped = remapTranscriptThroughEdl(edl, normalizeTranscript(raw))
  }

  const mediaUrl = await uploadFileToR2(outputPath, ctx.jobId, outputKind, ctx.jobUserId)
  await fs.rm(dirname(outputPath), { recursive: true, force: true }).catch(() => {})
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = outputKind === "video"
    ? await generateAndUploadThumbnail(mediaUrl, ctx.jobId, ctx.jobUserId)
    : undefined

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const output_data: Record<string, unknown> = outputKind === "video"
    ? { videoUrl: mediaUrl, ...(thumbUrl ? { thumbnailUrl: thumbUrl } : {}) }
    : { audioUrl: mediaUrl }
  if (remapped) output_data.json = remapped

  const ok = await markJobCompleted(ctx.jobId, { output_data })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${mediaUrl}${remapped ? " (+ remapped transcript)" : ""}`)
}
// A final-quality render of a long episode is hours of ffmpeg — far past the
// pre-task heartbeat's default cap (the orchestrator's 90-min node ceiling),
// and on a direct lane (`POST /v1/apply-edl`, the MCP verb) nothing else bounds
// it. The handler's liveness budget is the budget it gives its own bounded
// work: the per-chunk ffmpeg kill budget `applyEdl` hands `runFfmpeg`, plus its
// fetches and probes — so "hung" means one thing to the heartbeat and to those
// steps. Storage I/O and ffmpeg-slot waits have no ceiling to add and are the
// stated residual (see `workers/pre-task-heartbeat.ts`).
//
// Declared THROUGH the job-budget registry (`lib/job-budget.ts`), never
// computed here: the workflow orchestrator sizes an apply-edl node's ceilings
// from the same `declaredJobBudgetMs` call on the same payload (Track 0.11),
// so the heartbeat and the DAG agree on how long this job may run.
handleApplyEdl.livenessBudgetMs = (job) => declaredJobBudgetMs("apply-edl", job.data)

const handleAssembleNarratedVideo: HandlerFn = async function handleAssembleNarratedVideo(job, ctx) {
  const { blocks, voiceVolume, clipAudioVolume, maxSlowdown, trimStartFrames, trimEndFrames } = job.data as {
    jobId: string
    blocks: { videoUrl: string; audioUrl?: string }[]
    voiceVolume?: number; clipAudioVolume?: number; maxSlowdown?: number
    trimStartFrames?: number; trimEndFrames?: number
  }
  console.log(`[worker] assemble-narrated-video ${ctx.jobId}: ${blocks.length} blocks`)

  // Per-block progress: walks 5 -> 75 while blocks download/normalize/concat,
  // so a many-block job (e.g. 60 blocks) shows incremental movement instead
  // of sitting at 0% for minutes. Fire-and-forget (not awaited) so a slow DB
  // write never serializes block processing — `setJobProgress` already
  // best-effort-catches its own DB write failures; the `.catch` here only
  // guards the (rarer) BullMQ `job.updateProgress` rejection.
  const outputPath = await assembleNarratedVideo({
    blocks, voiceVolume, clipAudioVolume, maxSlowdown, trimStartFrames, trimEndFrames,
    onProgress: (f) => {
      void setJobProgress(job, ctx.jobId, Math.round(5 + f * 70)).catch(() => {})
    },
  })
  await setJobProgress(job, ctx.jobId, 80)

  const r2Url = await uploadFileToR2(outputPath, ctx.jobId, "video", ctx.jobUserId)
  await cleanupWorkDir(dirname(outputPath))
  await setJobProgress(job, ctx.jobId, 100)

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, { output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl } })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleMergeVideoAudio: HandlerFn = async function handleMergeVideoAudio(job, ctx) {
  const { videoUrl, audioUrl, audioTracks, voiceoverVolume, backgroundVolume, keepOriginalAudio } = job.data as {
    jobId: string; videoUrl: string; audioUrl?: string
    audioTracks?: { url: string; startTime: number; volume?: number; sourceType?: "audio" | "video" }[]
    voiceoverVolume?: number; backgroundVolume?: number; keepOriginalAudio?: boolean
  }
  console.log(`[worker] merge-video-audio ${ctx.jobId}`)
  const outputPath = await mergeVideoAudio({ videoUrl, audioUrl, audioTracks, voiceoverVolume, backgroundVolume, keepOriginalAudio })
  await setJobProgress(job, ctx.jobId, 80)
  await completeFfmpegVideoJob(outputPath, ctx)
}

const handleTrimAudio: HandlerFn = async function handleTrimAudio(job, ctx) {
  const { videoUrl, audioFormat, startTime, endTime } = job.data as {
    jobId: string; videoUrl: string; audioFormat?: "mp3" | "wav" | "aac"; startTime?: number; endTime?: number
  }
  console.log(`[worker] trim-audio ${ctx.jobId}`)
  const result = await trimAudio({ videoUrl, audioFormat, startTime, endTime })
  await setJobProgress(job, ctx.jobId, 80)
  const audioR2Url = await uploadFileToR2(result.audioPath, ctx.jobId, "audio", ctx.jobUserId)
  await cleanupWorkDir(dirname(result.audioPath))
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { audioUrl: audioR2Url },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${audioR2Url}`)
}

const handleTrimVideo: HandlerFn = async function handleTrimVideo(job, ctx) {
  const {
    videoUrl, startTime, endTime, outputSilentVideo,
    trimStartFrames, trimEndFrames,
    trimStartSeconds, trimEndSeconds, keepFirstSeconds, keepLastSeconds,
    smartLoopCut: smartLoopCutFlag, smartLoopCutLookback, losslessKeyframe,
  } = job.data as {
    jobId: string
    videoUrl: string
    startTime?: number
    endTime?: number
    outputSilentVideo?: boolean
    trimStartFrames?: number
    trimEndFrames?: number
    trimStartSeconds?: number
    trimEndSeconds?: number
    keepFirstSeconds?: number
    keepLastSeconds?: number
    smartLoopCut?: boolean
    smartLoopCutLookback?: number
    losslessKeyframe?: boolean
  }

  // Smart loop cut: empirically pick the trailing frame closest to frame 0
  // and trim there. Bypasses the time/frame trim entirely.
  if (smartLoopCutFlag) {
    console.log(`[worker] trim-video ${ctx.jobId} (smart-loop-cut, lookback=${smartLoopCutLookback ?? 16}${outputSilentVideo ? ", silent" : ""})`)
    const slc = await smartLoopCut({
      videoUrl,
      lookbackFrames: smartLoopCutLookback,
      outputSilent: outputSilentVideo,
    })
    await setJobProgress(job, ctx.jobId, 80)
    const r2Url = await uploadFileToR2(slc.videoPath, ctx.jobId, "video", ctx.jobUserId)
    await cleanupWorkDir(dirname(slc.videoPath))
    const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)
    await setJobProgress(job, ctx.jobId, 100)
    if (!await shouldSaveJobResult(ctx.jobId)) return
    const ok = await markJobCompleted(ctx.jobId, {
      output_data: {
        videoUrl: r2Url,
        thumbnailUrl: thumbUrl,
        smartLoopCut: {
          chosenFrameIndex: slc.chosenFrameIndex,
          psnr: slc.psnr,
          sourceFrameCount: slc.sourceFrameCount,
          fps: slc.fps,
        },
      },
    })
    if (!ok) return
    await commitJobCredits(ctx.usageLogId, ctx.jobId)
    console.log(`[worker] Job ${ctx.jobId} completed (smart-loop-cut): ${r2Url}`)
    return
  }

  console.log(`[worker] trim-video ${ctx.jobId}${outputSilentVideo ? " (silent)" : ""}`)
  const result = await trimVideo({
    videoUrl,
    startTime: startTime ?? 0,
    endTime,
    outputSilentVideo,
    trimStartFrames,
    trimEndFrames,
    trimStartSeconds,
    trimEndSeconds,
    keepFirstSeconds,
    keepLastSeconds,
    losslessKeyframe,
  })
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

const handleExtractFrame: HandlerFn = async function handleExtractFrame(job, ctx) {
  const { videoUrl, mode, timestamp, frameIndex, framesFromEnd } = job.data as {
    jobId: string
    videoUrl: string
    mode: "first" | "last" | "timestamp" | "frame-index" | "frame-from-end" | "keyframe"
    timestamp?: number
    frameIndex?: number
    framesFromEnd?: number
  }
  console.log(`[worker] extract-frame ${ctx.jobId} mode=${mode}`)
  const result = await extractFrame({ videoUrl, mode, timestamp, frameIndex, framesFromEnd })
  await setJobProgress(job, ctx.jobId, 80)
  const r2Url = await uploadFileToR2(result.imagePath, ctx.jobId, "image", ctx.jobUserId)
  await cleanupWorkDir(dirname(result.imagePath))
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { imageUrl: r2Url, thumbnailUrl: r2Url },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleSpeedRamp: HandlerFn = async function handleSpeedRamp(job, ctx) {
  const { videoUrl, speed, adjustAudio, reverse, audioMode, quality, ramps } = job.data as {
    jobId: string
    videoUrl: string
    speed: number
    adjustAudio?: boolean
    reverse?: boolean
    audioMode?: "pitch-preserve" | "pitch-shift" | "drop"
    quality?: "fast" | "smooth"
    ramps?: ReadonlyArray<{ start: number; end: number; speed: number }>
  }
  const tags = [
    quality === "smooth" ? "smooth" : null,
    reverse ? "reverse" : null,
    ramps && ramps.length > 0 ? `ramps=${ramps.length}` : null,
  ].filter(Boolean).join(",")
  console.log(`[worker] speed-ramp ${ctx.jobId}${tags ? ` [${tags}]` : ""}`)
  const outputPath = await speedRamp({ videoUrl, speed, adjustAudio, reverse, audioMode, quality, ramps })
  await setJobProgress(job, ctx.jobId, 80)
  await completeFfmpegVideoJob(outputPath, ctx)
}

const handleLoopVideo: HandlerFn = async function handleLoopVideo(job, ctx) {
  const { videoUrl, mode, repeatCount, targetDuration, smartLoopCutBeforeRepeat, smartLoopCutLookback } = job.data as {
    jobId: string
    videoUrl: string
    mode: "repeat" | "duration"
    repeatCount?: number
    targetDuration?: number
    smartLoopCutBeforeRepeat?: boolean
    smartLoopCutLookback?: number
  }
  console.log(`[worker] loop-video ${ctx.jobId}${smartLoopCutBeforeRepeat ? " [smart-cut-pre]" : ""}`)
  const result = await loopVideo({
    videoUrl,
    mode,
    repeatCount,
    targetDuration,
    smartLoopCutBeforeRepeat,
    smartLoopCutLookback,
  })
  await setJobProgress(job, ctx.jobId, 80)
  await completeFfmpegVideoJob(
    result.outputPath,
    ctx,
    result.smartLoopCutMeta ? { smartLoopCut: result.smartLoopCutMeta } : undefined,
  )
}

const handleFadeVideo: HandlerFn = async function handleFadeVideo(job, ctx) {
  const { videoUrl, fadeIn, fadeInDuration, fadeOut, fadeOutDuration, color } = job.data as {
    jobId: string; videoUrl: string; fadeIn: boolean; fadeInDuration: number; fadeOut: boolean; fadeOutDuration: number; color: "black" | "white"
  }
  console.log(`[worker] fade-video ${ctx.jobId}`)
  const outputPath = await fadeVideo({ videoUrl, fadeIn, fadeInDuration, fadeOut, fadeOutDuration, color })
  await setJobProgress(job, ctx.jobId, 80)
  await completeFfmpegVideoJob(outputPath, ctx)
}

const handleVideoOverlay: HandlerFn = async function handleVideoOverlay(job, ctx) {
  const payload = job.data as { jobId: string } & VideoOverlayJobPayload
  console.log(`[worker] video-overlay ${ctx.jobId}: ${payload.layers?.length ?? 0} layer(s)${payload.outputAspect ? `, ${payload.outputAspect}` : ""}`)
  // The handler owns the work dir (spec §4.2 step 1): completeFfmpegVideoJob
  // removes it only when its own upload succeeds, so this finally covers a
  // refused image, a failed render and a failed R2 put alike.
  const workDir = await createWorkDir("video-overlay")
  try {
    const render = await renderVideoOverlay(payload, workDir)
    await setJobProgress(job, ctx.jobId, 80)
    await completeFfmpegVideoJob(render.outputPath, ctx, {
      warnings: render.warnings,
      width: render.width,
      height: render.height,
      durationSec: render.durationSec,
      // The run's freshness key (a DAG stamp, or the canvas key a REST Run sent) rides to the node (output-extractor / the restore lanes).
      ...(typeof payload.resultCompositionKey === "string" ? { resultCompositionKey: payload.resultCompositionKey } : {}),
    })
  } finally {
    await cleanupWorkDir(workDir)
  }
}

const handleResizeVideo: HandlerFn = async function handleResizeVideo(job, ctx) {
  const { videoUrl, targetAspect, method, padColor } = job.data as {
    jobId: string; videoUrl: string; targetAspect: string; method: "crop" | "pad" | "stretch"; padColor?: string
  }
  console.log(`[worker] resize-video ${ctx.jobId}`)
  const outputPath = await resizeVideo({ videoUrl, targetAspect, method, padColor })
  await setJobProgress(job, ctx.jobId, 80)
  await completeFfmpegVideoJob(outputPath, ctx)
}

const handleGifToVideo: HandlerFn = async function handleGifToVideo(job, ctx) {
  const { gifUrl, loopToMinimum, targetDuration, interpolate, alphaBackground } = job.data as {
    jobId: string
    gifUrl: string
    loopToMinimum?: boolean
    targetDuration?: number
    interpolate?: boolean
    alphaBackground?: "white" | "black"
  }
  console.log(`[worker] gif-to-video ${ctx.jobId}: loop=${loopToMinimum} target=${targetDuration}s interp=${interpolate} bg=${alphaBackground}`)
  await setJobProgress(job, ctx.jobId, 3)

  const workDir = await createWorkDir("gif-to-video")
  try {
    const gifPath = join(workDir, "input.gif")
    await downloadFile(gifUrl, gifPath)
    await setJobProgress(job, ctx.jobId, 20)

    // Content-addressed cache: the same reference GIF is reused across many
    // generations, and minterpolate is expensive enough that recomputing it
    // per run is noticeable. Key by the GIF bytes + the conversion params so a
    // settings change misses the cache. On a hit we reuse the already-encoded
    // MP4 and skip conversion entirely.
    const gifBytes = await fs.readFile(gifPath)
    // `v` salts the cache: bump it whenever the conversion pipeline changes so
    // pre-change cached MP4s aren't served (content-addressed caching pins the
    // exact output bytes, bugs included). v2: real GIF-cadence minterpolate.
    const paramsSig = JSON.stringify({ v: 2, loopToMinimum, targetDuration, interpolate, alphaBackground })
    const hash = createHash("sha256").update(gifBytes).update(paramsSig).digest("hex")
    const cacheKey = `videos/gif2mp4/${hash}.mp4`

    let videoUrl: string
    let cached = false
    let meta: Record<string, unknown> = {}
    if (await getR2ObjectSize(cacheKey) > 0) {
      videoUrl = r2Url(cacheKey)
      cached = true
      console.log(`[worker] gif-to-video ${ctx.jobId}: cache hit ${cacheKey}`)
    } else {
      const result = await gifToVideo({
        gifPath, workDir, loopToMinimum, targetDuration, interpolate, alphaBackground,
      })
      await setJobProgress(job, ctx.jobId, 80)
      videoUrl = await uploadFileWithKeyToR2(result.outputPath, cacheKey, "video/mp4", ctx.jobUserId)
      meta = {
        gifSourceFrames: result.sourceFrames,
        gifSourceDuration: result.sourceDurationSeconds,
        outputDuration: result.outputDurationSeconds,
        loopStrategy: result.loopStrategy,
        loops: result.loops,
        seamless: result.seamless,
        interpolated: result.interpolated,
        ...(result.warning ? { warning: result.warning } : {}),
      }
    }

    await cleanupWorkDir(workDir)
    await setJobProgress(job, ctx.jobId, 90)
    const thumbUrl = await generateAndUploadThumbnail(videoUrl, ctx.jobId, ctx.jobUserId)
    await setJobProgress(job, ctx.jobId, 100)

    if (!await shouldSaveJobResult(ctx.jobId)) return
    const ok = await markJobCompleted(ctx.jobId, {
      output_data: { videoUrl, thumbnailUrl: thumbUrl, cached, ...meta },
    })
    if (!ok) return
    await commitJobCredits(ctx.usageLogId, ctx.jobId)
    console.log(`[worker] Job ${ctx.jobId} completed: ${videoUrl}${cached ? " (cached)" : ""}`)
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}

const handleAdjustVolume: HandlerFn = async function handleAdjustVolume(job, ctx) {
  const { audioUrl, videoUrl, volume, normalize, fadeIn, fadeOut } = job.data as {
    jobId: string; audioUrl?: string; videoUrl?: string; volume?: number; normalize?: boolean; fadeIn?: number; fadeOut?: number
  }
  console.log(`[worker] adjust-volume ${ctx.jobId} (${videoUrl ? "video" : "audio"} input)`)
  const { outputPath, inputType } = await adjustVolume({ audioUrl, videoUrl, volume, normalize, fadeIn, fadeOut })
  await setJobProgress(job, ctx.jobId, 80)
  const r2Url = await uploadFileToR2(outputPath, ctx.jobId, inputType, ctx.jobUserId)
  await cleanupWorkDir(dirname(outputPath))
  await setJobProgress(job, ctx.jobId, 100)
  const thumbUrl = inputType === "video" ? await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId) : null
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const outputData = inputType === "video" ? { videoUrl: r2Url, thumbnailUrl: thumbUrl } : { audioUrl: r2Url }
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { ...outputData, inputType },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleAudioFx: HandlerFn = async function handleAudioFx(job, ctx) {
  const { audioUrl, preset, mix, delayMs, decay, eqLow, eqHigh } = job.data as {
    jobId: string
    audioUrl: string
    preset: import("@nodaro/shared").AudioFxPreset
    mix?: number; delayMs?: number; decay?: number; eqLow?: number; eqHigh?: number
  }
  console.log(`[worker] audio-fx ${ctx.jobId} (${preset})`)
  const { outputPath } = await applyAudioFx({ audioUrl, preset, mix, delayMs, decay, eqLow, eqHigh })
  await setJobProgress(job, ctx.jobId, 80)
  const r2Url = await uploadFileToR2(outputPath, ctx.jobId, "audio", ctx.jobUserId)
  await cleanupWorkDir(dirname(outputPath))
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, { output_data: { audioUrl: r2Url } })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleAddCaptions: HandlerFn = async function handleAddCaptions(job, ctx) {
  const data = job.data as {
    jobId: string
    videoUrl: string
    text?: string
    captions?: Caption[]
    transcript?: unknown
    wordLevel?: boolean
    auto_transcribe?: boolean
    transcribe_provider?: TranscribeProvider
    style?: string
    position?: string
    fontSize?: number
    color?: string
    backgroundColor?: string
    look?: CaptionLookId
    fontWeight?: number
    fontFamily?: SupportedFontName
    strokeColor?: string
    strokeWidth?: number
    highlightColor?: string
    uppercase?: boolean
    positionY?: number
    animate?: boolean
    maxWordsPerLine?: number
    segments?: CaptionSegmentInput[]
  }
  const style = data.style ?? "subtitle"
  const hasSegments = !!(data.segments && data.segments.length > 0)
  const hasTranscript = data.transcript !== undefined && data.transcript !== null
  console.log(`[worker] add-captions ${ctx.jobId} style=${style}${hasSegments ? ` segments=${data.segments!.length}` : ""}${hasTranscript ? " transcript" : ""}`)

  // Renderer choice is the SHARED predicate (same one the route's credit id uses,
  // so price and renderer never drift): a Remotion render for segments, a kinetic
  // style, or a styled / timed / transcribed subtitle; the cheap FFmpeg drawtext
  // burn only for a plain-text subtitle with no lever. A wired transcript on
  // `subtitle` now routes to Remotion and renders as timed phrase lines — no
  // silent-drop guard needed.
  if (captionRoutesToRemotion(data)) {
    return dispatchKineticCaptions(job, ctx, data)
  }
  if (style !== "subtitle") {
    throw new Error(`Unknown add-captions style: ${style}`)
  }

  // Static path (existing FFmpeg drawtext) — plain-text subtitle only.
  if (!data.text) throw new Error("text is required for static subtitle style")
  const outputPath = await addCaptions({
    videoUrl: data.videoUrl,
    text: data.text,
    style: style as "subtitle",
    position: data.position as "bottom" | "top" | "center" | undefined,
    fontSize: data.fontSize,
    color: data.color,
    backgroundColor: data.backgroundColor,
  })
  await setJobProgress(job, ctx.jobId, 80)
  await completeFfmpegVideoJob(outputPath, ctx)
}

/** What a transcription — local or relayed — can hand this render. `words` is
 *  present only when the lane was asked for (and delivers) word timings;
 *  `segments` are the phrase ranges in SECONDS that every lane returns. */
interface TranscribedCaptionSource {
  words?: Caption[]
  segments?: Array<{ start: number; end: number; text: string }>
}

async function dispatchKineticCaptions(
  job: Job,
  ctx: JobContext,
  data: {
    videoUrl: string
    text?: string
    captions?: Caption[]
    transcript?: unknown
    wordLevel?: boolean
    auto_transcribe?: boolean
    transcribe_provider?: TranscribeProvider
    style?: string
    position?: string
    fontSize?: number
    color?: string
    backgroundColor?: string
    fontFamily?: SupportedFontName
    fontWeight?: number
    strokeColor?: string
    strokeWidth?: number
    highlightColor?: string
    uppercase?: boolean
    positionY?: number
    animate?: boolean
    maxWordsPerLine?: number
    look?: CaptionLookId
    segments?: CaptionSegmentInput[]
  },
): Promise<void> {
  // Rendering re-encodes the video, so the plan's fps must be the SOURCE clip's
  // own — a hardcoded 30 re-timed every 24 fps clip. Filled from the probe below;
  // an unreadable rate keeps the historical fallback (captionRenderFps).
  let fps = BURN_CAPTIONS_FPS_FALLBACK
  let width = 1920
  let height = 1080
  let videoDurationSeconds = 0

  // Per-segment captions: the shared transcript is only needed for segments that
  // don't carry their own text/captions. If every segment is self-sourced, skip
  // transcription entirely.
  const hasSegments = !!(data.segments && data.segments.length > 0)
  const hasTranscript = data.transcript !== undefined && data.transcript !== null
  const someSegmentNeedsShared =
    hasSegments && data.segments!.some((s) => !(s.text || (s.captions && s.captions.length > 0)))
  // `text` on a `subtitle` IS the caption — one static block for the whole clip,
  // never transcribed over, whichever renderer draws it. A styling lever moves
  // that render here (to Remotion), and this path used to ignore `text` and burn
  // a transcription of the audio over the caller's words. On a KINETIC style the
  // same `text` stays the FALLBACK it always was (synthetic word timings), so the
  // predicate is shared with the ingress rather than re-spelled here.
  const staticText = isStaticTextCaptionSource(data)
  // `null` is UNSET for the levers this handler forwards RAW into the plan (and
  // into the segment defaults): stored workflow JSON written by an agent / import
  // / a cleared field carries nulls, and the plan's schemas are `.optional()`,
  // never `.nullable()` — a forwarded null fails validation mid-run, after
  // credits are reserved. Normalized once, here, so every use below is safe.
  const look = data.look ?? undefined
  const positionY = data.positionY ?? undefined
  const animate = data.animate ?? undefined
  const maxWordsPerLine = data.maxWordsPerLine ?? undefined
  // Probe + transcribe in parallel — both depend only on data.videoUrl. A wired
  // transcript IS the shared caption source, so skip the vendor call entirely
  // (otherwise we would pay for a transcription we then discard) — and so is a
  // static text block.
  const needTranscribe =
    !staticText && !data.captions?.length && !hasTranscript && data.auto_transcribe !== false && (!hasSegments || someSegmentNeedsShared)
  // Does the RENDER need per-word timings, or will phrase lines do? Only the
  // kinetic styles move word by word; a `subtitle` draws whole lines and the
  // Remotion SubtitleOverlay groups/holds them itself. This does NOT decide what
  // we ASK the lane for — a capable lane is always asked for words, which is
  // strictly better input for both renders — it decides what happens on a lane
  // that CANNOT give them: a kinetic render skips the vendor call (nothing
  // usable could come back), a line render runs it for the phrase segments every
  // lane returns. Same predicate the route refuses on, so a request ingress
  // accepted is a request this render can actually serve.
  const needsWordTimings = captionsNeedWordTimings({ style: data.style, segments: data.segments })

  // THE SAME THREE-WAY LADDER handleTranscribe uses (workers/handlers/audio-ai.ts),
  // for the same reason (#761): transcription calls a vendor client straight
  // from the worker and never reaches the capability router, so a
  // keyless-but-connected install could not be rescued by any capability
  // declaration. Without it `add-captions` — a WHITELISTED node on the
  // self-host — hard-failed on every kinetic style, because auto-transcribe is
  // the default when no captions[] are supplied. Key resolution is
  // per-PROVIDER: elevenlabs-stt needs ELEVENLABS_API_KEY, the two whisper
  // lanes need REPLICATE_API_TOKEN.
  //   1. local key -> local transcribe(), byte-identical
  //   2. no key, connected -> replay on the cloud (which holds both), verbatim
  //   3. no key, not connected -> the local path's own missing-key error
  //
  // `audioUrl` matches run-on-cloud's URL_FIELD, so a local-MinIO videoUrl is
  // re-hosted before the POST; `jobId` is in INSTANCE_ONLY_FIELDS — stripped
  // from the wire body, but used by runJobOnCloud to stamp relay_job_id /
  // relay_credits on THIS row. Note what that figure then means: the relayed
  // TRANSCRIPTION only, never the locally-rendered Remotion pass, so it is not
  // the job's full cost and settlement must not read it as one.
  const transcribeProvider = data.transcribe_provider ?? "incredibly-fast-whisper"
  const localTranscribeKey =
    transcribeProvider === "elevenlabs-stt" ? config.ELEVENLABS_API_KEY : config.REPLICATE_API_TOKEN
  const { shouldRunOnCloud, runJobOnCloud } = await import("../../providers/nodaro/run-on-cloud.js")
  const runTranscription = async (): Promise<TranscribedCaptionSource | null> => {
    if (!needTranscribe) return null
    // The chosen lane cannot produce word timings, and this render IS word-timed
    // (a kinetic style). `transcribe()` REFUSES that pair before the provider
    // call, so calling it would fail the whole job — including the case where
    // `text` is present and used to carry the render as synthetic captions. Skip
    // the vendor call entirely and return the same `null` "not run" value,
    // leaving the text / no-caption-source ladder below to decide. (The route
    // rejects this pair at ingress when transcription is the ONLY possible
    // caption source; an incapable lane reaches here from the DAG / authored
    // node data, which never passes through that Zod.)
    // A render that does NOT need word timings never lands here: it asks the
    // same lane for phrase segments, which every lane returns.
    if (needsWordTimings && !transcribeLaneSupportsWordTimestamps(transcribeProvider)) {
      console.warn(
        `[add-captions kinetic] transcription SKIPPED: provider "${transcribeProvider}" cannot return word timestamps, which this render needs — falling back to the text / no-caption-source path.`,
      )
      return null
    }
    if (!(await shouldRunOnCloud(localTranscribeKey))) {
      // Ask for word timings whenever the lane CAN give them, whatever the
      // render is: the line overlays group words themselves, so words are the
      // better input for a subtitle too, and every capable lane stays
      // byte-identical to before. Only a lane that cannot — reached here solely
      // by a render that does not need them — is asked for phrase segments.
      return transcribe(data.videoUrl, transcribeProvider, undefined, {
        wordTimestamps: transcribeLaneSupportsWordTimestamps(transcribeProvider),
      })
    }
    // The RELAY provider is not necessarily the local one. The cloud's
    // /v1/transcribe enum is `TRANSCRIBE_PROVIDERS` (what a caller may name),
    // which has not always held every lane this worker can pick locally —
    // relaying an unaccepted one is a guaranteed 400. Send the local choice when
    // the cloud accepts it, otherwise the first accepted lane that can do word
    // timings. Derived from the two shared tables, never a hand-written name.
    const relayProvider = (TRANSCRIBE_PROVIDERS as readonly string[]).includes(transcribeProvider)
      ? transcribeProvider
      : CLOUD_RELAY_TRANSCRIBE_PROVIDER
    if (!relayProvider) {
      throw new Error(
        "nodaro.ai: no enabled transcription provider can return word timestamps — cannot relay this render's transcription",
      )
    }
    const cloud = await runJobOnCloud("transcribe", {
      jobId: ctx.jobId,
      audioUrl: data.videoUrl,
      // Same rule as the local leg, asked of the RELAY lane (which is not always
      // the local one): the flag rides only when that lane can honour it —
      // sending it to one that cannot is what makes the cloud's `/v1/transcribe`
      // refuse a render it could otherwise serve with phrase segments.
      ...(transcribeLaneSupportsWordTimestamps(relayProvider) ? { wordTimestamps: true } : {}),
      provider: relayProvider,
    })
    // Validate rather than trust — a version-skewed far end returning nothing
    // usable would otherwise fall through to the synthetic-text branch or die
    // with a misleading "no words" message (the suno-lyrics rule, and the same
    // check handleTranscribe makes on its own cloud result). What counts as
    // usable follows the ask: words for a word-timed render, words OR phrase
    // segments for a line-based one.
    const relayed = cloud as TranscribedCaptionSource
    const usable = Array.isArray(relayed.words) || (!needsWordTimings && Array.isArray(relayed.segments))
    if (!usable) {
      throw new Error("nodaro.ai returned no transcription")
    }
    return relayed
  }

  const [probeResult, transcribeResult] = await Promise.allSettled([
    probeVideoSource(data.videoUrl),
    runTranscription(),
  ])

  if (probeResult.status === "fulfilled") {
    width = probeResult.value.width
    height = probeResult.value.height
    videoDurationSeconds = probeResult.value.durationSeconds
    // Render AT the source's frame rate (rounded + clamped to the plan's band);
    // an unreadable rate leaves the fallback in place.
    fps = captionRenderFps(probeResult.value.fps)
  } else {
    console.warn(
      `[add-captions kinetic] ffprobe failed for ${data.videoUrl}; falling back to 1920x1080. Error: ${probeResult.reason instanceof Error ? probeResult.reason.message : String(probeResult.reason)}`,
    )
  }

  let captions: Caption[]
  if (data.captions && data.captions.length > 0) {
    captions = data.captions
  } else if (hasTranscript) {
    // A wired Transcript (json handle) — object or stringified — reshaped into
    // the caption list. wordLevel:true (default) = one caption per word for the
    // per-word kinetic styles; false groups words into lines. Both ingress paths
    // (route + payload-builder) already reject a non-JSON / empty transcript
    // before credits reserve; these throws are defence-in-depth with the SAME
    // split messages so a bypass still fails clearly, not misleadingly.
    const raw = typeof data.transcript === "string" ? safeParseJson(data.transcript) : data.transcript
    if (typeof data.transcript === "string" && raw === undefined) {
      throw new Error("transcript input is not JSON — wire the Transcript (json) output")
    }
    captions = transcriptToCaptions(normalizeTranscript(raw), { wordLevel: data.wordLevel })
    if (captions.length === 0) {
      throw new Error("wired transcript has no words to caption")
    }
  } else if (needTranscribe) {
    if (transcribeResult.status === "rejected") {
      // Identity invariant (B6b): a DrainAbortError must never be rewrapped —
      // every drain hatch matches on `instanceof DrainAbortError`, and the
      // rewrap below would flatten it into a plain Error. No drain check sits
      // on the transcribe path today, so this guards a future one rather than
      // a live bug; it costs one line and keeps the invariant local.
      if (transcribeResult.reason instanceof DrainAbortError) throw transcribeResult.reason
      throw new Error(
        `transcribe failed: ${transcribeResult.reason instanceof Error ? transcribeResult.reason.message : String(transcribeResult.reason)}`,
      )
    }
    // Word timings when the render needs (and got) them; otherwise the phrase
    // segments — one caption per segment, which the SubtitleOverlay groups and
    // holds into lines. A word-less lane can therefore still caption a subtitle
    // instead of dying on an empty word list after the transcription was paid for.
    const result = transcribeResult.value
    const transcribed =
      result?.words && result.words.length > 0
        ? result.words
        : !needsWordTimings && result?.segments
          ? transcribeSegmentsToCaptions(result.segments)
          : []
    if (transcribed.length === 0) {
      if (!data.text) {
        throw new Error(
          needsWordTimings
            ? "transcribe returned no words and no text fallback was provided"
            : "transcribe returned no speech and no text fallback was provided",
        )
      }
      const fallbackEndMs = videoDurationSeconds > 0 ? videoDurationSeconds * 1000 : 5000
      captions = syntheticCaptionsFromText(data.text, { startMs: 0, endMs: fallbackEndMs })
    } else {
      captions = transcribed
    }
  } else if (data.text) {
    // The SAME text, two meanings (see isStaticTextCaptionSource): on a subtitle
    // it is the caption — ONE block spanning the clip, `\n` a forced break, the
    // words-per-line cap applied to the text itself; on a kinetic style it is the
    // fallback, sliced into evenly-timed words the overlay re-groups.
    captions = staticText
      ? [staticTextCaptionBlock(data.text, { videoDurationSeconds, maxWordsPerLine })]
      : syntheticCaptionsFromText(data.text, {
          startMs: 0,
          endMs: videoDurationSeconds > 0 ? videoDurationSeconds * 1000 : 5000,
        })
  } else if (hasSegments) {
    // No shared transcript needed — every segment carries its own words.
    captions = []
  } else {
    throw new Error("Kinetic style requires captions, text, or auto_transcribe")
  }

  // Resolve the top-level look → concrete levers (font/weight/colour/outline/
  // spoken-word/casing). The caller's EXPLICIT levers win over the look; the
  // outline auto-sizes to the font when the look supplies it.
  const topFontSize = data.fontSize ?? 32
  const topExplicit = explicitLevers({
    fontFamily: data.fontFamily,
    fontWeight: data.fontWeight,
    color: data.color,
    backgroundColor: data.backgroundColor,
    strokeColor: data.strokeColor,
    strokeWidth: data.strokeWidth,
    highlightColor: data.highlightColor,
    uppercase: data.uppercase,
  })
  // Bare `subtitle` (no look) → plain (explicit levers only); kinetic or a
  // look-named subtitle → resolve the preset. Shared with the segment resolver
  // and the frontend so the rule can't drift (resolveCaptionLevers).
  const topLevers = resolveCaptionLevers(data.style, look, topExplicit, topFontSize)

  // Per-segment captions: resolve each segment to its own words + merged levers.
  // The composition renders these instead of the top-level captions/style.
  const resolvedSegments = hasSegments
    ? resolveCaptionSegments(captions, data.segments!, {
        style: data.style ?? "subtitle",
        position: (data.position as "top" | "center" | "bottom" | undefined) ?? "bottom",
        positionY,
        fontSize: topFontSize,
        look,
        animate,
        maxWordsPerLine,
        explicit: topExplicit,
      })
    : undefined

  await setJobProgress(job, ctx.jobId, 30)

  // burnCaptionsPlanSchema requires a non-empty top-level `captions`; the
  // composition ignores it when segments are present, so fall back to the
  // segments' own words when there is no shared transcript.
  const planCaptions =
    captions.length > 0 ? captions : (resolvedSegments?.flatMap((s) => s.captions) ?? captions)

  const segmentsLastEndMs = resolvedSegments?.reduce((m, s) => Math.max(m, s.endMs), 0) ?? 0
  const lastCaptionEndMs = Math.max(captions[captions.length - 1]?.endMs ?? 0, segmentsLastEndMs)
  const captionsDurationSeconds = lastCaptionEndMs / 1000
  const targetDurationSeconds = Math.max(captionsDurationSeconds, videoDurationSeconds)
  // A long clip at a high source rate would ask for more frames than the plan
  // accepts, and that cap is only checked when the plan validates — after credits
  // are reserved and after any paid transcription. Fall back to the historical 30,
  // exactly as an unreadable source rate does.
  fps = captionRenderFpsWithinFrameCap(fps, targetDurationSeconds)
  const durationInFrames = Math.max(30, Math.ceil(targetDurationSeconds * fps))

  // Clear the video-worker's `pre-task` reconcile sentinel before handing this
  // job to the render queue. The reconcile cron treats a `pre-task` row whose
  // provider_call_started_at is older than 30 min as a crashed sync job and
  // marks it failed + refunds — but a Remotion render legitimately runs far
  // longer than 30 min behind a render backlog. Nulling both fields leaves the
  // row at status="processing" with no provider_call_started_at, so it escapes
  // BOTH reconcile paths (the main scan requires the timestamp non-null;
  // sweepNeverStartedJobs requires status="pending"). render-worker + BullMQ
  // stall-recovery now solely own the job's lifecycle. Without this the cron
  // would fail + refund a job that is still rendering, and markJobCompleted's
  // live-status CAS would then discard the finished render.
  await supabase
    .from("jobs")
    .update({ provider_kind: null, provider_call_started_at: null })
    .eq("id", ctx.jobId)

  // Deterministic BullMQ job id so a video-worker stall-retry (which would
  // re-run this handler) coalesces onto the SAME render job instead of
  // enqueuing a duplicate Remotion render.
  await renderQueue.add(
    "render",
    {
      jobId: ctx.jobId,
      planType: "burn-captions",
      plan: {
        planType: "burn-captions",
        sourceVideo: data.videoUrl,
        captions: planCaptions,
        // The plan accepts ANY caption style at top level now — a subtitle that
        // routed here (styled / timed / transcribed) renders via the Remotion
        // SubtitleOverlay. With segments the top-level style is ignored (the
        // composition renders the segments).
        style: data.style ?? "subtitle",
        position: data.position ?? "bottom",
        fontSize: topFontSize,
        // Resolved look levers (default look = outline unless the caller set one).
        color: topLevers.color ?? "#ffffff",
        backgroundColor: topLevers.backgroundColor,
        fontFamily: topLevers.fontFamily,
        fontWeight: topLevers.fontWeight,
        strokeColor: topLevers.strokeColor,
        strokeWidth: topLevers.strokeWidth,
        highlightColor: topLevers.highlightColor,
        uppercase: topLevers.uppercase,
        // Null-normalized above — the plan's schemas are `.optional()`, never
        // `.nullable()`.
        positionY,
        animate,
        // A static text block is ONE caption and the cap was already applied to
        // the text itself (staticTextCaptionBlock) — passing it on would let the
        // overlay time-split the block into pages.
        maxWordsPerLine: staticText ? undefined : maxWordsPerLine,
        ...(resolvedSegments ? { segments: resolvedSegments } : {}),
        fps,
        width,
        height,
        durationInFrames,
      },
      usageLogId: ctx.usageLogId,
    },
    { jobId: `render-${ctx.jobId}` },
  )
  // Ownership: render-worker now owns this jobs.id — don't call commit/refund here.
}

const handleCombineAudio: HandlerFn = async function handleCombineAudio(job, ctx) {
  const { segments } = job.data as { segments: Array<{ url: string; startTime?: number; endTime?: number }> }
  console.log(`[worker] combine-audio ${ctx.jobId}: ${segments.length} segments`)
  const outputPath = await combineAudio({ segments })
  await setJobProgress(job, ctx.jobId, 80)
  await completeFfmpegAudioJob(outputPath, ctx)
}

const handleMixAudio: HandlerFn = async function handleMixAudio(job, ctx) {
  const { audioUrls, trackVolumes } = job.data as { jobId: string; audioUrls: string[]; trackVolumes?: number[] }
  console.log(`[worker] mix-audio ${ctx.jobId}: ${audioUrls.length} tracks`)
  const outputPath = await mixAudio({ audioUrls, trackVolumes })
  await setJobProgress(job, ctx.jobId, 80)
  await completeFfmpegAudioJob(outputPath, ctx)
}

const RESOLUTION_SCALE: Record<string, string> = {
  "1080p": "scale=-2:1080",
  "720p": "scale=-2:720",
  "480p": "scale=-2:480",
}

const handleTranscodeVideo: HandlerFn = async function handleTranscodeVideo(job, ctx) {
  const { videoUrl, codec, crf, resolution, audioBitrate } = job.data as {
    jobId: string; videoUrl: string; codec?: "h264" | "h265"; crf?: number; resolution?: string; audioBitrate?: string
  }
  console.log(`[worker] transcode-video ${ctx.jobId}`)

  const isDefault = !codec && crf === undefined && (!resolution || resolution === "original") && !audioBitrate
  const workDir = await createWorkDir("transcode")
  const inputPath = join(workDir, "input.mp4")
  const outputPath = join(workDir, "output.mp4")
  await downloadFile(videoUrl, inputPath)
  await setJobProgress(job, ctx.jobId, 30)

  if (isDefault) {
    // Use the standard browser-safe args
    await runFfmpeg(["-y", "-i", inputPath, ...BROWSER_SAFE_VIDEO_ARGS, "-c:a", "aac", "-b:a", "128k", outputPath])
  } else {
    // Build custom args
    const videoCodec = codec === "h265" ? "libx265" : "libx264"
    const crfValue = String(crf ?? 23)
    const args: string[] = ["-y", "-i", inputPath, "-c:v", videoCodec, "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", crfValue]

    if (resolution && resolution !== "original" && RESOLUTION_SCALE[resolution]) {
      args.push("-vf", RESOLUTION_SCALE[resolution])
    }

    args.push("-movflags", "+faststart", "-c:a", "aac", "-b:a", audioBitrate ?? "128k", outputPath)
    await runFfmpeg(args)
  }
  await setJobProgress(job, ctx.jobId, 80)
  await completeFfmpegVideoJob(outputPath, ctx)
}

const handleSocialMediaFormat: HandlerFn = async function handleSocialMediaFormat(job, ctx) {
  const { mediaUrl, mediaType, width, height, method, padColor } = job.data as {
    jobId: string; mediaUrl: string; mediaType: "image" | "video"
    width: number; height: number; method: "crop" | "pad" | "stretch"; padColor?: string
  }
  console.log(`[worker] social-media-format ${ctx.jobId}: ${mediaType} → ${width}×${height}`)
  const outputPath = await socialMediaFormat({ mediaUrl, mediaType, width, height, method, padColor })
  await setJobProgress(job, ctx.jobId, 80)
  if (mediaType === "image") {
    const r2Url = await uploadFileToR2(outputPath, ctx.jobId, "image", ctx.jobUserId)
    await cleanupWorkDir(dirname(outputPath))
    await setJobProgress(job, ctx.jobId, 100)
    if (!await shouldSaveJobResult(ctx.jobId)) return
    const ok = await markJobCompleted(ctx.jobId, {
      output_data: { videoUrl: r2Url, imageUrl: r2Url, mediaType: "image" },
    })
    if (!ok) return
    await commitJobCredits(ctx.usageLogId, ctx.jobId)
    console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
  } else {
    await completeFfmpegVideoJob(outputPath, ctx)
  }
}

const handleSplitMedia: HandlerFn = async function handleSplitMedia(job, ctx) {
  const { videoUrl, audioUrl, chunkDuration, audioFormat } = job.data as {
    jobId: string; videoUrl?: string; audioUrl?: string; chunkDuration: number; audioFormat?: "mp3" | "wav" | "aac"
  }
  console.log(`[worker] split-media ${ctx.jobId} (chunkDuration: ${chunkDuration}s)`)
  const result = await splitMedia({ videoUrl, audioUrl, chunkDuration, audioFormat })
  await setJobProgress(job, ctx.jobId, 70)

  const videoUrls: string[] = []
  const audioUrls: string[] = []

  if (result.videoPaths) {
    for (let i = 0; i < result.videoPaths.length; i++) {
      const r2Url = await uploadFileToR2(result.videoPaths[i], `${ctx.jobId}-video-${i}`, "video", ctx.jobUserId)
      videoUrls.push(r2Url)
    }
  }
  if (result.audioPaths) {
    for (let i = 0; i < result.audioPaths.length; i++) {
      const r2Url = await uploadFileToR2(result.audioPaths[i], `${ctx.jobId}-audio-${i}`, "audio", ctx.jobUserId)
      audioUrls.push(r2Url)
    }
  }

  // Clean up work directory from first available path
  const firstPath = result.videoPaths?.[0] ?? result.audioPaths?.[0]
  if (firstPath) await cleanupWorkDir(dirname(firstPath))

  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: {
      videoUrls: videoUrls.length > 0 ? videoUrls : undefined,
      audioUrls: audioUrls.length > 0 ? audioUrls : undefined,
      chunkCount: Math.max(videoUrls.length, audioUrls.length),
    },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${videoUrls.length} video chunks, ${audioUrls.length} audio chunks`)
}

const handleSilenceDetect: HandlerFn = async function handleSilenceDetect(job, ctx) {
  const { audioUrl, thresholdDb, minSilenceMs, padMs } = job.data as {
    jobId: string
    audioUrl: string
    thresholdDb?: number
    minSilenceMs?: number
    padMs?: number
  }
  console.log(`[worker] silence-detect ${ctx.jobId} (threshold=${thresholdDb ?? -35}dB, minSilence=${minSilenceMs ?? 700}ms, pad=${padMs ?? 120}ms)`)

  const result = await detectSilence(audioUrl, {
    thresholdDb: thresholdDb ?? -35,
    minSilenceMs: minSilenceMs ?? 700,
    padMs: padMs ?? 120,
  })
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return
  // Stored under `json` so the DAG extractors (getPrimaryOutput / the frontend
  // extractNodeOutput) read + stringify it exactly like web-scrape/video-analysis.
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { json: result },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${result.ranges.length} silence range(s)`)
}

/**
 * audio-sync: measure 2–6 recordings' clock offsets against the reference
 * (default: the first source). A SYNC local analysis like silence-detect — the
 * result is JSON on `output_data.json`, read + stringified by the DAG
 * extractors exactly like silence-detect's ranges.
 */
const handleAudioSync: HandlerFn = async function handleAudioSync(job, ctx) {
  const { sources, reference } = job.data as {
    jobId: string
    sources: Array<{ id: string; url: string }>
    reference?: string
  }
  console.log(`[worker] audio-sync ${ctx.jobId}: ${sources.length} sources, reference=${reference ?? sources[0]?.id}`)

  const result = await audioSync(sources, reference)
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { json: result },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${result.offsets.length} offsets against "${result.reference}"${result.notes.length > 0 ? `, ${result.notes.length} note(s)` : ""}`)
}
// Each source is proxied, fetched, probed and decoded before any correlation,
// so a run over long uncached sources can outlive the heartbeat's default cap.
// Declared THROUGH the job-budget registry, never computed here: the
// orchestrator sizes an audio-sync node's ceilings from the same call on the
// same payload (the budget leaf is `providers/audio/audio-sync-budget.ts`).
handleAudioSync.livenessBudgetMs = (job) => declaredJobBudgetMs("audio-sync", job.data)
// Its media proxy may fetch a multi-gigabyte original (Track 0.19): past the
// 90-minute default, so it declares its steps' ceilings like audio-sync.
handleSilenceDetect.livenessBudgetMs = (job) => declaredJobBudgetMs("silence-detect", job.data)

const handleExtractAudio: HandlerFn = async function handleExtractAudio(job, ctx) {
  const { videoUrl } = job.data as { jobId: string; videoUrl: string }
  console.log(`[worker] extract-audio ${ctx.jobId}`)
  const result = await extractAudio({ videoUrl })
  await setJobProgress(job, ctx.jobId, 80)
  const audioR2Url = await uploadFileToR2(result.audioPath, ctx.jobId, "audio", ctx.jobUserId)
  await cleanupWorkDir(dirname(result.audioPath))
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { audioUrl: audioR2Url },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${audioR2Url}`)
}

const handleRemoveAudio: HandlerFn = async function handleRemoveAudio(job, ctx) {
  const { videoUrl } = job.data as { jobId: string; videoUrl: string }
  console.log(`[worker] remove-audio ${ctx.jobId}`)
  const result = await removeAudio({ videoUrl })
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

const handleImageCollage: HandlerFn = async function handleImageCollage(job, ctx) {
  const { imageUrls, imageSizes, numbered, imageLabels, badgePosition, layout, resolution, aspectRatio, gap, backgroundColor, attachToCharacterId, attachToColumn, attachName, attachBoardType } = job.data as {
    jobId: string
    imageUrls: string[]
    /** Per-image size hints aligned with imageUrls (0 auto / 1 big / 2 medium / 3 small). */
    imageSizes?: number[]
    /** Storyboard mode: stamp a 1-based sequence number at each image's top-right. */
    numbered?: boolean
    /** Per-image captions aligned with imageUrls, shown after the number (or alone). */
    imageLabels?: (string | null)[]
    /** Corner the badges sit in; default "top-left". */
    badgePosition?: "top-left" | "top-right"
    layout?: "smart" | "grid"
    resolution?: "2K" | "4K"
    aspectRatio?: string
    gap?: number
    backgroundColor?: string
    attachToCharacterId?: string
    attachToColumn?: string
    attachName?: string
    attachBoardType?: "looks" | "identity"
  }
  console.log(`[worker] image-collage ${ctx.jobId}: ${imageUrls.length} images, layout=${layout ?? "smart"}, ${resolution ?? "2K"} ${aspectRatio ?? "1:1"}${imageSizes?.some((s) => s !== 0) ? `, sizes=[${imageSizes.join(",")}]` : ""}${numbered ? ", numbered" : ""}${imageLabels?.some((l) => l != null && l !== "") ? `, labels=${imageLabels.filter((l) => l != null && l !== "").length}` : ""}`)

  const outputPath = await createImageCollage({ imageUrls, imageSizes, numbered, imageLabels, badgePosition, layout, resolution, aspectRatio, gap, backgroundColor })
  await setJobProgress(job, ctx.jobId, 80)

  const r2Url = await uploadFileToR2(outputPath, ctx.jobId, "image", ctx.jobUserId)
  await cleanupWorkDir(dirname(outputPath))
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { imageUrl: r2Url },
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId)

  // Character Studio auto-attach (identity boards) — same pattern as
  // image-ai.ts. Best-effort: attachAssetToCharacter logs + swallows failures
  // (the collage still lives on jobs.output_data; the studio's poll resolves).
  if (attachToCharacterId && attachToColumn && attachName && ctx.jobUserId) {
    const column = resolveAssetColumn(attachToColumn)
    if (column) {
      await attachAssetToCharacter({
        characterId: attachToCharacterId,
        userId: ctx.jobUserId,
        column,
        item: {
          name: attachName,
          url: r2Url,
          ...(attachBoardType ? { type: attachBoardType } : {}),
          sourceImages: imageUrls,
        },
      })
    }
  }

  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleImageOverlay: HandlerFn = async function handleImageOverlay(job, ctx) {
  const { imageUrl, layers, canvas, baseFit, outputFormat, variants, maskMode, maskSpread, qrText } = job.data as { jobId: string } & ImageOverlayParams
  console.log(`[worker] image-overlay ${ctx.jobId}: ${layers?.length ?? 0} layer(s)${canvas ? `, canvas=${canvas.width}x${canvas.height}` : ""}, ${outputFormat ?? "png"}`)

  // createImageOverlay removes its work dir itself on failure; this finally
  // covers the upload leg so a failed R2 put cannot leak the rendered file.
  const render = await createImageOverlay({ imageUrl, layers, canvas, baseFit, outputFormat, variants, maskMode, maskSpread, qrText })
  await setJobProgress(job, ctx.jobId, 80)

  let r2Url: string
  let maskUrl: string | undefined
  const uploadedVariants: Array<{ id: string; label: string; width: number; height: number; url: string }> = []
  try {
    r2Url = await uploadFileToR2(render.outputPath, ctx.jobId, "image", ctx.jobUserId)
    if (render.maskPath) maskUrl = await uploadFileToR2(render.maskPath, `${ctx.jobId}-mask`, "image", ctx.jobUserId)
    // Every extra platform render gets a SUFFIXED upload id — a bare job id
    // would alias all of them onto one R2 object (the gvp "doubled parts" bug).
    for (const v of render.variants) {
      const url = await uploadFileToR2(v.path, `${ctx.jobId}-${v.id}`, "image", ctx.jobUserId)
      uploadedVariants.push({ id: v.id, label: v.label, width: v.width, height: v.height, url })
    }
  } finally {
    await cleanupWorkDir(dirname(render.outputPath))
  }
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    // width/height let the editor tell a result rendered under other
    // settings (another platform / canvas) from a fresh one — see
    // overlayResultMatches on the client.
    output_data: { imageUrl: r2Url, ...(render.width > 0 && render.height > 0 ? { width: render.width, height: render.height } : {}), ...(maskUrl ? { maskUrl } : {}), ...(uploadedVariants.length ? { variants: uploadedVariants } : {}) },
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleStillToVideo: HandlerFn = async function handleStillToVideo(job, ctx) {
  const { imageUrl, audioUrl, motion, intensity, resolution, aspectRatio, fps, fit, padColor } = job.data as {
    jobId: string
    imageUrl: string
    audioUrl: string
    motion: "none" | "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "ken-burns"
    intensity: number
    resolution: "720p" | "1080p" | "4K"
    aspectRatio: "16:9" | "9:16" | "1:1" | "4:3"
    fps: number
    fit: "cover" | "contain"
    padColor: string
  }
  console.log(`[worker] still-to-video ${ctx.jobId}: motion=${motion} ${resolution} ${aspectRatio} ${fps}fps fit=${fit}`)

  // Stamp pickup immediately — the node UI shows "Queued" until progress
  // crosses 3, so queue time and processing time read as distinct states.
  await setJobProgress(job, ctx.jobId, 3)

  // Real frame-based progress: the total frame count is already known
  // (frames = ceil(audioDuration * fps) — the same math zoompan's d needs),
  // so encode progress walks 5 → 90 from ffmpeg's actual frame counter.
  // Throttled to ≥5% steps; fire-and-forget so a slow DB write never
  // serializes the encode (setJobProgress best-effort-catches its own
  // failures; the .catch guards the BullMQ updateProgress rejection).
  let lastPct = 5
  const result = await stillToVideo({
    imageUrl,
    audioUrl,
    motion,
    intensity,
    resolution,
    aspectRatio,
    fps,
    fit,
    padColor,
    onProgress: (frame, totalFrames) => {
      const pct = Math.min(90, 5 + Math.round((frame / totalFrames) * 85))
      if (pct >= lastPct + 5) {
        lastPct = pct
        void setJobProgress(job, ctx.jobId, pct).catch(() => {})
      }
    },
  })
  await setJobProgress(job, ctx.jobId, 95)

  // durationSeconds rides output_data so the node footer can show the
  // resolved length (the "hero fact" — there is no duration field to read).
  await completeFfmpegVideoJob(result.outputPath, ctx, { durationSeconds: result.durationSeconds })
}

const handleSlideshow: HandlerFn = async function handleSlideshow(job, ctx) {
  const { imageUrls, audioUrl, imageDurations, perImageDuration, transition, transitionDuration, motion, intensity, resolution, aspectRatio, fps, fit, padColor } = job.data as {
    jobId: string
    imageUrls: string[]
    audioUrl?: string
    imageDurations?: Array<number | null>
    perImageDuration: number
    transition: string
    transitionDuration: number
    motion: "none" | "zoom-in" | "zoom-out" | "ken-burns" | "alternate"
    intensity: number
    resolution: "720p" | "1080p" | "4K"
    aspectRatio: "16:9" | "9:16" | "1:1" | "4:3"
    fps: number
    fit: "cover" | "contain"
    padColor: string
  }
  console.log(`[worker] slideshow ${ctx.jobId}: ${imageUrls.length} images, transition=${transition}, motion=${motion}`)
  await setJobProgress(job, ctx.jobId, 3)

  // Progress mirrors the real pipeline: segments 5→70, concat 70→88, mux 88→95.
  let lastPct = 3
  const report = (pct: number) => {
    const clamped = Math.min(95, Math.round(pct))
    if (clamped >= lastPct + 2) {
      lastPct = clamped
      void setJobProgress(job, ctx.jobId, clamped).catch(() => {})
    }
  }
  const result = await slideshow({
    imageUrls,
    audioUrl,
    imageDurations,
    perImageDuration,
    transition,
    transitionDuration,
    motion,
    intensity,
    resolution,
    aspectRatio,
    fps,
    fit,
    padColor,
    onProgress: (phase, done, total) => {
      if (phase === "segments") report(5 + (done / total) * 65)
      else if (phase === "concat") report(70 + (done / Math.max(1, total)) * 18)
      else report(88 + done * 7)
    },
  })
  await setJobProgress(job, ctx.jobId, 95)

  // Disclosure fields ride output_data: the Case-C scale factor must be
  // surfaced on the node, and appliedTransition tells the truth after the
  // picker-vocabulary mapping / clamping.
  await completeFfmpegVideoJob(result.outputPath, ctx, {
    durationSeconds: result.durationSeconds,
    slideCount: result.slideCount,
    appliedTransition: result.appliedTransition,
    ...(result.scaleFactor !== null ? { scaleFactor: result.scaleFactor } : {}),
    ...(result.transitionClamped ? { transitionClamped: true } : {}),
    ...(result.silent ? { silent: true } : {}),
  })
}

export const ffmpegHandlers: Record<string, HandlerFn> = {
  "combine-videos": handleCombineVideos,
  "apply-edl": handleApplyEdl,
  "assemble-narrated-video": handleAssembleNarratedVideo,
  "image-collage": handleImageCollage,
  "image-overlay": handleImageOverlay,
  "merge-video-audio": handleMergeVideoAudio,
  "trim-audio": handleTrimAudio,
  "trim-video": handleTrimVideo,
  "extract-frame": handleExtractFrame,
  "speed-ramp": handleSpeedRamp,
  "loop-video": handleLoopVideo,
  "fade-video": handleFadeVideo,
  "video-overlay": handleVideoOverlay,
  "still-to-video": handleStillToVideo,
  "gif-to-video": handleGifToVideo,
  "slideshow": handleSlideshow,
  "resize-video": handleResizeVideo,
  "adjust-volume": handleAdjustVolume,
  "audio-fx": handleAudioFx,
  "add-captions": handleAddCaptions,
  "mix-audio": handleMixAudio,
  "combine-audio": handleCombineAudio,
  "transcode-video": handleTranscodeVideo,
  "social-media-format": handleSocialMediaFormat,
  "split-media": handleSplitMedia,
  "extract-audio": handleExtractAudio,
  "remove-audio": handleRemoveAudio,
  "silence-detect": handleSilenceDetect,
  "audio-sync": handleAudioSync,
}
