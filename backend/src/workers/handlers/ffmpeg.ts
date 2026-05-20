import { dirname, join } from "node:path"
import { promises as fs } from "node:fs"
import type { Job } from "bullmq"
import type { Caption } from "@remotion/captions"
import { uploadFileToR2 } from "../../lib/storage.js"
import { renderQueue } from "../../lib/render-queue.js"
import { cleanupWorkDir, createWorkDir, downloadFile, runFfmpeg, BROWSER_SAFE_VIDEO_ARGS, probeVideoSource } from "../../providers/video/ffmpeg-utils.js"
import { combineVideos } from "../../providers/video/combine-videos.js"
import { socialMediaFormat } from "../../providers/video/social-media-format.js"
import { mergeVideoAudio } from "../../providers/video/merge-video-audio.js"
import { trimAudio } from "../../providers/video/trim-audio.js"
import { trimVideo } from "../../providers/video/trim-video.js"
import { smartLoopCut } from "../../providers/video/smart-loop-cut.js"
import { extractFrame } from "../../providers/video/extract-frame.js"
import { splitMedia } from "../../providers/video/split-media.js"
import { resizeVideo } from "../../providers/video/resize-video.js"
import { adjustVolume } from "../../providers/video/adjust-volume.js"
import { addCaptions } from "../../providers/video/add-captions.js"
import { mixAudio } from "../../providers/video/mix-audio.js"
import { combineAudio } from "../../providers/video/combine-audio.js"
import { speedRamp } from "../../providers/video/speed-ramp.js"
import { loopVideo } from "../../providers/video/loop-video.js"
import { fadeVideo } from "../../providers/video/fade-video.js"
import { transcribe, type TranscribeProvider } from "../../providers/audio/transcribe.js"
import { syntheticCaptionsFromText } from "../../providers/audio/captions-mappers.js"
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
import { isKineticCaptionStyle } from "@nodaro/shared"

const handleCombineVideos: HandlerFn = async function handleCombineVideos(job, ctx) {
  const { videoUrls, transition, transitionDuration, audioMode, trimStartFrames, trimEndFrames } = job.data as {
    jobId: string
    videoUrls: string[]
    /** Validated upstream against `COMBINE_TRANSITION_IDS` at the route's
     *  Zod boundary; the worker just forwards the string. */
    transition: string
    transitionDuration: number
    audioMode?: "keep" | "crossfade" | "remove"
    trimStartFrames?: number
    trimEndFrames?: number
  }
  console.log(`[worker] combine-videos ${ctx.jobId}: ${videoUrls.length} videos, transition=${transition}, audio=${audioMode ?? "crossfade"}, trimStart=${trimStartFrames ?? 0}, trimEnd=${trimEndFrames ?? 0}`)

  const outputPath = await combineVideos({ videoUrls, transition, transitionDuration, audioMode: audioMode ?? "crossfade", trimStartFrames: trimStartFrames ?? 0, trimEndFrames: trimEndFrames ?? 0 })
  await setJobProgress(job, ctx.jobId, 80)

  const r2Url = await uploadFileToR2(outputPath, ctx.jobId, "video", ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)

  // combineVideos uses its own temp dir structure (not cleanupWorkDir-compatible)
  await fs.rm(dirname(outputPath), { recursive: true, force: true }).catch(() => {})

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
  })
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
    trimStartFrames, trimEndFrames, smartLoopCut: smartLoopCutFlag, smartLoopCutLookback,
  } = job.data as {
    jobId: string
    videoUrl: string
    startTime?: number
    endTime?: number
    outputSilentVideo?: boolean
    trimStartFrames?: number
    trimEndFrames?: number
    smartLoopCut?: boolean
    smartLoopCutLookback?: number
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
  const { videoUrl, mode, timestamp } = job.data as {
    jobId: string; videoUrl: string; mode: "first" | "last" | "timestamp"; timestamp?: number
  }
  console.log(`[worker] extract-frame ${ctx.jobId}`)
  const result = await extractFrame({ videoUrl, mode, timestamp })
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
  const { videoUrl, speed, adjustAudio } = job.data as {
    jobId: string; videoUrl: string; speed: number; adjustAudio: boolean
  }
  console.log(`[worker] speed-ramp ${ctx.jobId}`)
  const outputPath = await speedRamp({ videoUrl, speed, adjustAudio })
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

const handleResizeVideo: HandlerFn = async function handleResizeVideo(job, ctx) {
  const { videoUrl, targetAspect, method, padColor } = job.data as {
    jobId: string; videoUrl: string; targetAspect: string; method: "crop" | "pad" | "stretch"; padColor?: string
  }
  console.log(`[worker] resize-video ${ctx.jobId}`)
  const outputPath = await resizeVideo({ videoUrl, targetAspect, method, padColor })
  await setJobProgress(job, ctx.jobId, 80)
  await completeFfmpegVideoJob(outputPath, ctx)
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

const handleAddCaptions: HandlerFn = async function handleAddCaptions(job, ctx) {
  const data = job.data as {
    jobId: string
    videoUrl: string
    text?: string
    captions?: Caption[]
    auto_transcribe?: boolean
    transcribe_provider?: TranscribeProvider
    style?: string
    position?: string
    fontSize?: number
    color?: string
    backgroundColor?: string
  }
  const style = data.style ?? "subtitle"
  console.log(`[worker] add-captions ${ctx.jobId} style=${style}`)

  if (isKineticCaptionStyle(style)) {
    return dispatchKineticCaptions(job, ctx, data)
  }
  if (style !== "subtitle") {
    throw new Error(`Unknown add-captions style: ${style}`)
  }

  // Static path (existing FFmpeg drawtext)
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

async function dispatchKineticCaptions(
  job: Job,
  ctx: JobContext,
  data: {
    videoUrl: string
    text?: string
    captions?: Caption[]
    auto_transcribe?: boolean
    transcribe_provider?: TranscribeProvider
    style?: string
    position?: string
    fontSize?: number
    color?: string
    backgroundColor?: string
  },
): Promise<void> {
  const fps = 30
  let width = 1920
  let height = 1080
  let videoDurationSeconds = 0

  // Probe + transcribe in parallel — both depend only on data.videoUrl
  const needTranscribe = !data.captions?.length && data.auto_transcribe !== false
  const [probeResult, transcribeResult] = await Promise.allSettled([
    probeVideoSource(data.videoUrl),
    needTranscribe
      ? transcribe(
          data.videoUrl,
          data.transcribe_provider ?? "incredibly-fast-whisper",
          undefined,
          { wordTimestamps: true },
        )
      : Promise.resolve(null),
  ])

  if (probeResult.status === "fulfilled") {
    width = probeResult.value.width
    height = probeResult.value.height
    videoDurationSeconds = probeResult.value.durationSeconds
  } else {
    console.warn(
      `[add-captions kinetic] ffprobe failed for ${data.videoUrl}; falling back to 1920x1080. Error: ${probeResult.reason instanceof Error ? probeResult.reason.message : String(probeResult.reason)}`,
    )
  }

  let captions: Caption[]
  if (data.captions && data.captions.length > 0) {
    captions = data.captions
  } else if (needTranscribe) {
    if (transcribeResult.status === "rejected") {
      throw new Error(
        `transcribe failed: ${transcribeResult.reason instanceof Error ? transcribeResult.reason.message : String(transcribeResult.reason)}`,
      )
    }
    const result = transcribeResult.value
    if (!result || !result.words || result.words.length === 0) {
      if (!data.text) {
        throw new Error("transcribe returned no words and no text fallback was provided")
      }
      const fallbackEndMs = videoDurationSeconds > 0 ? videoDurationSeconds * 1000 : 5000
      captions = syntheticCaptionsFromText(data.text, { startMs: 0, endMs: fallbackEndMs })
    } else {
      captions = result.words
    }
  } else if (data.text) {
    const fallbackEndMs = videoDurationSeconds > 0 ? videoDurationSeconds * 1000 : 5000
    captions = syntheticCaptionsFromText(data.text, { startMs: 0, endMs: fallbackEndMs })
  } else {
    throw new Error("Kinetic style requires captions, text, or auto_transcribe")
  }

  await setJobProgress(job, ctx.jobId, 30)

  const lastCaptionEndMs = captions[captions.length - 1]?.endMs ?? 0
  const captionsDurationSeconds = lastCaptionEndMs / 1000
  const targetDurationSeconds = Math.max(captionsDurationSeconds, videoDurationSeconds)
  const durationInFrames = Math.max(30, Math.ceil(targetDurationSeconds * fps))

  await renderQueue.add("render", {
    jobId: ctx.jobId,
    planType: "burn-captions",
    plan: {
      planType: "burn-captions",
      sourceVideo: data.videoUrl,
      captions,
      style: data.style,
      position: data.position ?? "bottom",
      fontSize: data.fontSize ?? 32,
      color: data.color ?? "#ffffff",
      backgroundColor: data.backgroundColor,
      fps,
      width,
      height,
      durationInFrames,
    },
    usageLogId: ctx.usageLogId,
  })
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

export const ffmpegHandlers: Record<string, HandlerFn> = {
  "combine-videos": handleCombineVideos,
  "merge-video-audio": handleMergeVideoAudio,
  "trim-audio": handleTrimAudio,
  "trim-video": handleTrimVideo,
  "extract-frame": handleExtractFrame,
  "speed-ramp": handleSpeedRamp,
  "loop-video": handleLoopVideo,
  "fade-video": handleFadeVideo,
  "resize-video": handleResizeVideo,
  "adjust-volume": handleAdjustVolume,
  "add-captions": handleAddCaptions,
  "mix-audio": handleMixAudio,
  "combine-audio": handleCombineAudio,
  "transcode-video": handleTranscodeVideo,
  "social-media-format": handleSocialMediaFormat,
  "split-media": handleSplitMedia,
}
