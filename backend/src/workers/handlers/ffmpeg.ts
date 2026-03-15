import { dirname, join } from "node:path"
import { promises as fs } from "node:fs"
import { supabase } from "../../lib/supabase.js"
import { uploadFileToR2 } from "../../lib/storage.js"
import { cleanupWorkDir, createWorkDir, downloadFile, runFfmpeg, BROWSER_SAFE_VIDEO_ARGS } from "../../providers/video/ffmpeg-utils.js"
import { combineVideos } from "../../providers/video/combine-videos.js"
import { socialMediaFormat } from "../../providers/video/social-media-format.js"
import { mergeVideoAudio } from "../../providers/video/merge-video-audio.js"
import { trimAudio } from "../../providers/video/trim-audio.js"
import { trimVideo } from "../../providers/video/trim-video.js"
import { resizeVideo } from "../../providers/video/resize-video.js"
import { adjustVolume } from "../../providers/video/adjust-volume.js"
import { addCaptions } from "../../providers/video/add-captions.js"
import { mixAudio } from "../../providers/video/mix-audio.js"
import { speedRamp } from "../../providers/video/speed-ramp.js"
import { loopVideo } from "../../providers/video/loop-video.js"
import { fadeVideo } from "../../providers/video/fade-video.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  generateAndUploadThumbnail,
  completeFfmpegVideoJob,
  completeFfmpegAudioJob,
  type HandlerFn,
} from "../shared.js"

const handleCombineVideos: HandlerFn = async function handleCombineVideos(job, ctx) {
  const { videoUrls, transition, transitionDuration, audioMode } = job.data as {
    jobId: string
    videoUrls: string[]
    transition: "cut" | "fade" | "dissolve" | "dip-to-black" | "dip-to-white"
    transitionDuration: number
    audioMode?: "keep" | "crossfade" | "remove"
  }
  console.log(`[worker] combine-videos ${ctx.jobId}: ${videoUrls.length} videos, transition=${transition}, audio=${audioMode ?? "crossfade"}`)

  const outputPath = await combineVideos({ videoUrls, transition, transitionDuration, audioMode: audioMode ?? "crossfade" })
  await job.updateProgress(80)

  const r2Url = await uploadFileToR2(outputPath, ctx.jobId, "video", ctx.jobUserId)
  await job.updateProgress(100)

  // combineVideos uses its own temp dir structure (not cleanupWorkDir-compatible)
  await fs.rm(dirname(outputPath), { recursive: true, force: true }).catch(() => {})

  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      progress: 100,
      output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl },
      completed_at: new Date().toISOString(),
    })
    .eq("id", ctx.jobId)

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
  await job.updateProgress(80)
  await completeFfmpegVideoJob(outputPath, ctx)
}

const handleTrimAudio: HandlerFn = async function handleTrimAudio(job, ctx) {
  const { videoUrl, audioFormat, outputSilentVideo, startTime, endTime } = job.data as {
    jobId: string; videoUrl: string; audioFormat?: "mp3" | "wav" | "aac"; outputSilentVideo?: boolean; startTime?: number; endTime?: number
  }
  console.log(`[worker] trim-audio ${ctx.jobId}`)
  const result = await trimAudio({ videoUrl, audioFormat, outputSilentVideo, startTime, endTime })
  await job.updateProgress(80)
  const audioR2Url = await uploadFileToR2(result.audioPath, ctx.jobId, "audio", ctx.jobUserId)
  let silentVideoR2Url: string | undefined
  if (result.silentVideoPath) {
    silentVideoR2Url = await uploadFileToR2(result.silentVideoPath, `${ctx.jobId}-silent`, "video", ctx.jobUserId)
  }
  await cleanupWorkDir(dirname(result.audioPath))
  await job.updateProgress(100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { audioUrl: audioR2Url, ...(silentVideoR2Url ? { videoUrl: silentVideoR2Url } : {}) },
    completed_at: new Date().toISOString(),
  }).eq("id", ctx.jobId)
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${audioR2Url}`)
}

const handleTrimVideo: HandlerFn = async function handleTrimVideo(job, ctx) {
  const { videoUrl, startTime, endTime } = job.data as {
    jobId: string; videoUrl: string; startTime: number; endTime?: number
  }
  console.log(`[worker] trim-video ${ctx.jobId}`)
  const outputPath = await trimVideo({ videoUrl, startTime, endTime })
  await job.updateProgress(80)
  await completeFfmpegVideoJob(outputPath, ctx)
}

const handleSpeedRamp: HandlerFn = async function handleSpeedRamp(job, ctx) {
  const { videoUrl, speed, adjustAudio } = job.data as {
    jobId: string; videoUrl: string; speed: number; adjustAudio: boolean
  }
  console.log(`[worker] speed-ramp ${ctx.jobId}`)
  const outputPath = await speedRamp({ videoUrl, speed, adjustAudio })
  await job.updateProgress(80)
  await completeFfmpegVideoJob(outputPath, ctx)
}

const handleLoopVideo: HandlerFn = async function handleLoopVideo(job, ctx) {
  const { videoUrl, mode, repeatCount, targetDuration } = job.data as {
    jobId: string; videoUrl: string; mode: "repeat" | "duration"; repeatCount?: number; targetDuration?: number
  }
  console.log(`[worker] loop-video ${ctx.jobId}`)
  const outputPath = await loopVideo({ videoUrl, mode, repeatCount, targetDuration })
  await job.updateProgress(80)
  await completeFfmpegVideoJob(outputPath, ctx)
}

const handleFadeVideo: HandlerFn = async function handleFadeVideo(job, ctx) {
  const { videoUrl, fadeIn, fadeInDuration, fadeOut, fadeOutDuration, color } = job.data as {
    jobId: string; videoUrl: string; fadeIn: boolean; fadeInDuration: number; fadeOut: boolean; fadeOutDuration: number; color: "black" | "white"
  }
  console.log(`[worker] fade-video ${ctx.jobId}`)
  const outputPath = await fadeVideo({ videoUrl, fadeIn, fadeInDuration, fadeOut, fadeOutDuration, color })
  await job.updateProgress(80)
  await completeFfmpegVideoJob(outputPath, ctx)
}

const handleResizeVideo: HandlerFn = async function handleResizeVideo(job, ctx) {
  const { videoUrl, targetAspect, method, padColor } = job.data as {
    jobId: string; videoUrl: string; targetAspect: string; method: "crop" | "pad" | "stretch"; padColor?: string
  }
  console.log(`[worker] resize-video ${ctx.jobId}`)
  const outputPath = await resizeVideo({ videoUrl, targetAspect, method, padColor })
  await job.updateProgress(80)
  await completeFfmpegVideoJob(outputPath, ctx)
}

const handleAdjustVolume: HandlerFn = async function handleAdjustVolume(job, ctx) {
  const { audioUrl, videoUrl, volume, normalize, fadeIn, fadeOut } = job.data as {
    jobId: string; audioUrl?: string; videoUrl?: string; volume?: number; normalize?: boolean; fadeIn?: number; fadeOut?: number
  }
  console.log(`[worker] adjust-volume ${ctx.jobId} (${videoUrl ? "video" : "audio"} input)`)
  const { outputPath, inputType } = await adjustVolume({ audioUrl, videoUrl, volume, normalize, fadeIn, fadeOut })
  await job.updateProgress(80)
  const r2Url = await uploadFileToR2(outputPath, ctx.jobId, inputType, ctx.jobUserId)
  await cleanupWorkDir(dirname(outputPath))
  await job.updateProgress(100)
  const thumbUrl = inputType === "video" ? await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId) : null
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const outputData = inputType === "video" ? { videoUrl: r2Url, thumbnailUrl: thumbUrl } : { audioUrl: r2Url }
  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { ...outputData, inputType },
    completed_at: new Date().toISOString(),
  }).eq("id", ctx.jobId)
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleAddCaptions: HandlerFn = async function handleAddCaptions(job, ctx) {
  const { videoUrl, text, style, position, fontSize, color, backgroundColor } = job.data as {
    jobId: string; videoUrl: string; text: string; style?: string; position?: string; fontSize?: number; color?: string; backgroundColor?: string
  }
  console.log(`[worker] add-captions ${ctx.jobId}`)
  const outputPath = await addCaptions({ videoUrl, text, style: style as "subtitle" | "word-highlight" | "karaoke" | undefined, position: position as "bottom" | "top" | "center" | undefined, fontSize, color, backgroundColor })
  await job.updateProgress(80)
  await completeFfmpegVideoJob(outputPath, ctx)
}

const handleMixAudio: HandlerFn = async function handleMixAudio(job, ctx) {
  const { audioUrls, trackVolumes } = job.data as { jobId: string; audioUrls: string[]; trackVolumes?: number[] }
  console.log(`[worker] mix-audio ${ctx.jobId}: ${audioUrls.length} tracks`)
  const outputPath = await mixAudio({ audioUrls, trackVolumes })
  await job.updateProgress(80)
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
  await job.updateProgress(30)

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
  await job.updateProgress(80)
  await completeFfmpegVideoJob(outputPath, ctx)
}

const handleSocialMediaFormat: HandlerFn = async function handleSocialMediaFormat(job, ctx) {
  const { mediaUrl, mediaType, width, height, method, padColor } = job.data as {
    jobId: string; mediaUrl: string; mediaType: "image" | "video"
    width: number; height: number; method: "crop" | "pad" | "stretch"; padColor?: string
  }
  console.log(`[worker] social-media-format ${ctx.jobId}: ${mediaType} → ${width}×${height}`)
  const outputPath = await socialMediaFormat({ mediaUrl, mediaType, width, height, method, padColor })
  await job.updateProgress(80)
  if (mediaType === "image") {
    const r2Url = await uploadFileToR2(outputPath, ctx.jobId, "image", ctx.jobUserId)
    await cleanupWorkDir(dirname(outputPath))
    await job.updateProgress(100)
    if (!await shouldSaveJobResult(ctx.jobId)) return
    await supabase.from("jobs").update({
      status: "completed",
      progress: 100,
      output_data: { videoUrl: r2Url, imageUrl: r2Url, mediaType: "image" },
      completed_at: new Date().toISOString(),
    }).eq("id", ctx.jobId)
    await commitJobCredits(ctx.usageLogId, ctx.jobId)
    console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
  } else {
    await completeFfmpegVideoJob(outputPath, ctx)
  }
}

export const ffmpegHandlers: Record<string, HandlerFn> = {
  "combine-videos": handleCombineVideos,
  "merge-video-audio": handleMergeVideoAudio,
  "trim-audio": handleTrimAudio,
  "trim-video": handleTrimVideo,
  "speed-ramp": handleSpeedRamp,
  "loop-video": handleLoopVideo,
  "fade-video": handleFadeVideo,
  "resize-video": handleResizeVideo,
  "adjust-volume": handleAdjustVolume,
  "add-captions": handleAddCaptions,
  "mix-audio": handleMixAudio,
  "transcode-video": handleTranscodeVideo,
  "social-media-format": handleSocialMediaFormat,
}
