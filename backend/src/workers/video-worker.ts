import { Worker } from "bullmq"
import IORedis from "ioredis"
import { config, hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { CreditsService } from "../services/credits.js"
import {
  initProviders,
  generateImage,
  editImage,
  imageToVideo,
  textToVideo,
  videoToVideo,
  motionTransfer,
  videoUpscale,
  lipSync,
  textToSpeech as routedTextToSpeech,
  type RouteResult,
} from "../providers/index.js"
import { KieError } from "../providers/kie/client.js"
import type { ProgressCallback } from "../providers/provider.interface.js"
import { generateScript, type ScriptProvider } from "../providers/script/script-generator.js"
import { uploadToR2, uploadFileToR2, uploadBufferToR2 } from "../lib/storage.js"
import { combineVideos } from "../providers/video/combine-videos.js"
import { mergeVideoAudio } from "../providers/video/merge-video-audio.js"
import { extractAudio } from "../providers/video/extract-audio.js"
import { trimVideo } from "../providers/video/trim-video.js"
import { resizeVideo } from "../providers/video/resize-video.js"
import { adjustVolume } from "../providers/video/adjust-volume.js"
import { addCaptions } from "../providers/video/add-captions.js"
import { mixAudio } from "../providers/video/mix-audio.js"
import { cleanupWorkDir } from "../providers/video/ffmpeg-utils.js"
import { generateMusic, type MusicProvider } from "../providers/audio/generate-music.js"
import { textToAudio, type AudioProvider } from "../providers/audio/text-to-audio.js"
import { KieAudioProvider } from "../providers/kie/audio.js"
import { transcribe, type TranscribeProvider } from "../providers/audio/transcribe.js"
import { extractYouTubeAudio } from "../providers/audio/youtube-extractor.js"
import { sunoGenerate, sunoCover, sunoExtend, sunoLyrics, sunoSeparate, sunoMusicVideo, type SunoModel, type SunoSeparateType } from "../providers/kie/suno-client.js"
import { promises as fs } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import youtubedl from "youtube-dl-exec"

const SOCIAL_HOSTNAMES = [
  "youtube.com", "youtu.be",
  "tiktok.com",
  "instagram.com",
  "twitter.com", "x.com",
  "facebook.com", "fb.watch", "fb.com",
]

function isSocialUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return SOCIAL_HOSTNAMES.some((h) => parsed.hostname.includes(h))
  } catch {
    return false
  }
}

async function downloadAudioToR2(url: string): Promise<string> {
  const outputId = randomUUID()
  const baseName = `yt-audio-${outputId}`
  const outputTemplate = join(tmpdir(), `${baseName}.%(ext)s`)
  const expectedPath = join(tmpdir(), `${baseName}.mp3`)

  console.log(`[worker] Downloading audio from social URL: ${url}`)

  await youtubedl(url, {
    extractAudio: true,
    audioFormat: "mp3",
    audioQuality: 0,
    output: outputTemplate,
    noPlaylist: true,
    noCheckCertificates: true,
    preferFreeFormats: true,
    extractorArgs: "youtube:player_client=android",
    addHeader: [
      "referer:youtube.com",
      "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    ],
  } as Record<string, unknown>)

  // Find the actual audio file
  let actualPath = expectedPath
  try {
    await fs.access(expectedPath)
  } catch {
    const alternatives = [".m4a", ".webm", ".opus", ".ogg", ".wav"]
    let found = false
    for (const ext of alternatives) {
      const altPath = join(tmpdir(), `${baseName}${ext}`)
      try {
        await fs.access(altPath)
        actualPath = altPath
        found = true
        break
      } catch { continue }
    }
    if (!found) throw new Error("yt-dlp did not produce an output file")
  }

  const stat = await fs.stat(actualPath)
  if (stat.size === 0) throw new Error("Downloaded audio file is empty")

  const buffer = await fs.readFile(actualPath)
  const r2Key = `audios/cover-src-${outputId}.mp3`
  const r2Url = await uploadBufferToR2(buffer, r2Key, "audio/mpeg")
  await fs.unlink(actualPath).catch(() => {})

  console.log(`[worker] Audio downloaded and uploaded to R2: ${r2Url}`)
  return r2Url
}

/**
 * Check if job was cancelled before saving completion result.
 * This prevents race condition where user cancels but job already completed.
 * Returns true if job should proceed with saving, false if cancelled.
 */
async function shouldSaveJobResult(jobId: string): Promise<boolean> {
  const { data: currentJob } = await supabase
    .from("jobs")
    .select("status")
    .eq("id", jobId)
    .single()

  if (currentJob?.status === "cancelled") {
    console.log(`[worker] Job ${jobId} was cancelled during processing, discarding result`)
    return false
  }
  return true
}

/**
 * Commit credits after successful job completion (cloud edition only).
 * Wrapped in try-catch to avoid failing the job if credit commit fails.
 */
async function commitJobCredits(usageLogId: string | null | undefined, jobId: string): Promise<void> {
  if (!hasCredits() || !usageLogId) return

  try {
    await CreditsService.commitCredits(usageLogId)
    console.log(`[worker] Credits committed for job ${jobId}`)
  } catch (error) {
    console.error(`[worker] Failed to commit credits for job ${jobId}:`, error)
    // Don't fail the job if credit commit fails
  }
}

/**
 * Refund credits after job failure (cloud edition only).
 * Only refunds for system errors, NOT for provider errors (where we got charged).
 */
async function refundJobCredits(usageLogId: string | null | undefined, jobId: string, errorMessage: string): Promise<void> {
  if (!hasCredits() || !usageLogId) return

  try {
    // Don't refund if provider charged us (provider errors)
    const isProviderError = errorMessage?.toLowerCase().includes("provider") ||
                           errorMessage?.toLowerCase().includes("api error") ||
                           errorMessage?.toLowerCase().includes("kie.ai")

    if (!isProviderError) {
      await CreditsService.refundCredits(usageLogId)
      console.log(`[worker] Credits refunded for job ${jobId}`)
    } else {
      console.log(`[worker] Provider error - not refunding credits for job ${jobId}: ${errorMessage}`)
    }
  } catch (error) {
    console.error(`[worker] Failed to refund credits for job ${jobId}:`, error)
    // Don't fail the job if credit refund fails
  }
}

export function createVideoWorker() {
  initProviders()

  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  })

  return new Worker(
    "video-generation",
    async (job) => {
      const { jobId } = job.data as { jobId: string }

      // Fetch usage_log_id for credit tracking (cloud edition)
      const { data: jobRecord } = await supabase
        .from("jobs")
        .select("usage_log_id")
        .eq("id", jobId)
        .single()
      const usageLogId = jobRecord?.usage_log_id

      try {
        await supabase
          .from("jobs")
          .update({ status: "processing", started_at: new Date().toISOString() })
          .eq("id", jobId)

        if (job.name === "generate-image") {
          const { prompt, referenceImageUrls, provider } = job.data as { jobId: string; prompt: string; referenceImageUrls?: string[]; provider?: string }
          console.log(`[worker] generate-image ${jobId} (provider: ${provider ?? "nano-banana"}): "${prompt}"`)
          if (referenceImageUrls?.length) {
            console.log(`[worker] Reference images (${referenceImageUrls.length}): ${referenceImageUrls.join(", ")}`)
          }

          const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { imageUrl: r2Url },
              completed_at: new Date().toISOString(),
              provider: result.providerUsed,
              provider_cost: result.cost,
              display_cost: result.displayCost,
            })
            .eq("id", jobId)

          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
        } else if (job.name === "edit-image") {
          const { imageUrl, prompt, provider } = job.data as {
            jobId: string
            imageUrl: string
            prompt?: string
            provider?: "recraft-upscale" | "recraft-remove-bg" | "nano-banana-edit"
          }
          const resolvedProvider = provider ?? "recraft-upscale"
          console.log(`[worker] edit-image ${jobId} (provider: ${resolvedProvider}): "${prompt ?? "(no prompt)"}"`)

          const result = await editImage(imageUrl, resolvedProvider, prompt)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { imageUrl: r2Url },
              completed_at: new Date().toISOString(),
              provider: result.providerUsed,
              provider_cost: result.cost,
              display_cost: result.displayCost,
            })
            .eq("id", jobId)

          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
        } else if (job.name === "image-to-image") {
          const { imageUrl, referenceImageUrls, prompt, provider } = job.data as {
            jobId: string
            imageUrl: string
            referenceImageUrls?: string[]
            prompt: string
            provider?: "nano-banana" | "nano-banana-pro" | "flux-i2i" | "grok-i2i" | "gpt-image-i2i"
          }
          const resolvedProvider = provider ?? "nano-banana"
          // Combine main image with additional reference images (e.g., from Location/Character nodes)
          const allImages = [imageUrl, ...(referenceImageUrls ?? [])]
          console.log(`[worker] image-to-image ${jobId} (provider: ${resolvedProvider}, images: ${allImages.length}): "${prompt}"`)

          const result = await generateImage(prompt, resolvedProvider, allImages)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { imageUrl: r2Url },
              completed_at: new Date().toISOString(),
              provider: result.providerUsed,
              provider_cost: result.cost,
              display_cost: result.displayCost,
            })
            .eq("id", jobId)

          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
        } else if (job.name === "image-to-video") {
          const { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration, mode, sound } = job.data as {
            jobId: string
            imageUrl: string
            endFrameUrl?: string      // Optional end frame for supported providers
            audioUrl?: string         // Optional audio to merge after video generation
            prompt?: string
            provider?: string
            generateAudio?: boolean
            duration?: number
            mode?: string             // Kling 3.0 quality mode (pro/std)
            sound?: boolean           // Kling 3.0 sound effects
          }
          console.log(`[worker] image-to-video ${jobId} (provider: ${provider ?? "minimax"})${endFrameUrl ? " [with end frame]" : ""}${audioUrl ? " [with audio]" : ""}`)

          // Create progress callback that updates the job record in the database
          const onProgress: ProgressCallback = async (progress: number) => {
            console.log(`[worker] Job ${jobId} progress: ${progress}%`)
            await supabase.from("jobs").update({ progress }).eq("id", jobId)
          }

          const result = await imageToVideo(imageUrl, provider ?? "minimax", prompt, duration, endFrameUrl, { onProgress, mode, sound })
          await job.updateProgress(40)

          // Upload the generated video to R2
          let finalVideoUrl = await uploadToR2(result.url, jobId, "video")
          await job.updateProgress(70)

          // If audio URL is provided, merge it with the video
          if (audioUrl) {
            console.log(`[worker] Merging audio into video for job ${jobId}`)
            const mergedPath = await mergeVideoAudio({
              videoUrl: finalVideoUrl,
              audioUrl,
              voiceoverVolume: 100,
              backgroundVolume: 30, // Lower the generated audio if present
              keepOriginalAudio: generateAudio ?? false,
            })
            await job.updateProgress(90)

            // Upload merged video
            finalVideoUrl = await uploadFileToR2(mergedPath, `${jobId}-merged`, "video")
            await cleanupWorkDir(dirname(mergedPath))
          }

          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { videoUrl: finalVideoUrl },
              completed_at: new Date().toISOString(),
              provider: result.providerUsed,
              provider_cost: result.cost,
              display_cost: result.displayCost,
            })
            .eq("id", jobId)

          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${finalVideoUrl} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
        } else if (job.name === "video-to-video") {
          const { videoUrl, prompt, provider } = job.data as {
            jobId: string
            videoUrl: string
            prompt?: string
            provider?: string
          }
          console.log(`[worker] video-to-video ${jobId} (provider: ${provider ?? "wan"})`)

          const result = await videoToVideo(videoUrl, provider ?? "wan", prompt)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(result.url, jobId, "video")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { videoUrl: r2Url },
              completed_at: new Date().toISOString(),
              provider: result.providerUsed,
              provider_cost: result.cost,
              display_cost: result.displayCost,
            })
            .eq("id", jobId)

          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
        } else if (job.name === "text-to-video") {
          const { prompt, provider, duration } = job.data as {
            jobId: string
            prompt: string
            provider?: string
            duration?: number
          }
          console.log(`[worker] text-to-video ${jobId} (provider: ${provider ?? "minimax"})`)

          const result = await textToVideo(prompt, provider ?? "minimax", duration)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(result.url, jobId, "video")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { videoUrl: r2Url },
              completed_at: new Date().toISOString(),
              provider: result.providerUsed,
              provider_cost: result.cost,
              display_cost: result.displayCost,
            })
            .eq("id", jobId)

          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
        } else if (job.name === "lip-sync") {
          const { imageUrl, audioUrl, prompt, provider, resolution } = job.data as {
            jobId: string
            imageUrl: string
            audioUrl: string
            prompt?: string
            provider?: string
            resolution?: string
          }
          console.log(`[worker] lip-sync ${jobId} (provider: ${provider ?? "kling-avatar"})`)

          const result = await lipSync(imageUrl, audioUrl, provider ?? "kling-avatar", prompt, resolution)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(result.url, jobId, "video")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { videoUrl: r2Url },
              completed_at: new Date().toISOString(),
              provider: result.providerUsed,
              provider_cost: result.cost,
              display_cost: result.displayCost,
            })
            .eq("id", jobId)

          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
        } else if (job.name === "text-to-speech") {
          const { text, voice, provider, stability, similarityBoost, style, speed, languageCode } = job.data as {
            jobId: string
            text: string
            voice?: string
            provider?: string
            stability?: number
            similarityBoost?: number
            style?: number
            speed?: number
            languageCode?: string
          }
          console.log(`[worker] text-to-speech ${jobId} (provider: ${provider ?? "elevenlabs-turbo"})`)

          const ttsOptions = {
            ...(stability != null && { stability }),
            ...(similarityBoost != null && { similarityBoost }),
            ...(style != null && { style }),
            ...(speed != null && { speed }),
            ...(languageCode && { languageCode }),
          }
          const result = await routedTextToSpeech(text, provider ?? "elevenlabs-turbo", voice, Object.keys(ttsOptions).length > 0 ? ttsOptions : undefined)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(result.url, jobId, "audio")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { audioUrl: r2Url },
              completed_at: new Date().toISOString(),
              provider: result.providerUsed,
              provider_cost: result.cost,
              display_cost: result.displayCost,
            })
            .eq("id", jobId)

          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
        } else if (job.name === "generate-script") {
          const { prompt, sceneCount, tone, targetDuration, provider } = job.data as {
            jobId: string
            prompt: string
            sceneCount?: number
            tone?: string
            targetDuration?: number
            provider?: ScriptProvider
          }
          console.log(`[worker] generate-script ${jobId} (provider: ${provider ?? "gemini"})`)

          const script = await generateScript(prompt, sceneCount, tone, targetDuration, provider)
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { script },
              completed_at: new Date().toISOString(),
            })
            .eq("id", jobId)

          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: "${script.title}" (${script.scenes.length} scenes)`)
        } else if (job.name === "combine-videos") {
          const { videoUrls, transition, transitionDuration } = job.data as {
            jobId: string
            videoUrls: string[]
            transition: "cut" | "fade" | "dissolve"
            transitionDuration: number
          }
          console.log(`[worker] combine-videos ${jobId}: ${videoUrls.length} videos, transition=${transition}`)

          const outputPath = await combineVideos({ videoUrls, transition, transitionDuration })
          await job.updateProgress(80)

          const r2Url = await uploadFileToR2(outputPath, jobId, "video")
          await job.updateProgress(100)

          // Cleanup temp files
          await fs.rm(dirname(outputPath), { recursive: true, force: true }).catch(() => {})

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { videoUrl: r2Url },
              completed_at: new Date().toISOString(),
            })
            .eq("id", jobId)

          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)
        } else if (job.name === "merge-video-audio") {
          const { videoUrl, audioUrl, audioTracks, voiceoverVolume, backgroundVolume, keepOriginalAudio } = job.data as {
            jobId: string; videoUrl: string; audioUrl?: string
            audioTracks?: { url: string; startTime: number; volume?: number; sourceType?: "audio" | "video" }[]
            voiceoverVolume?: number; backgroundVolume?: number; keepOriginalAudio?: boolean
          }
          console.log(`[worker] merge-video-audio ${jobId}`)
          const outputPath = await mergeVideoAudio({ videoUrl, audioUrl, audioTracks, voiceoverVolume, backgroundVolume, keepOriginalAudio })
          await job.updateProgress(80)
          const r2Url = await uploadFileToR2(outputPath, jobId, "video")
          await cleanupWorkDir(dirname(outputPath))
          await job.updateProgress(100)
          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { videoUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)

        } else if (job.name === "extract-audio") {
          const { videoUrl, audioFormat, outputSilentVideo } = job.data as {
            jobId: string; videoUrl: string; audioFormat?: "mp3" | "wav" | "aac"; outputSilentVideo?: boolean
          }
          console.log(`[worker] extract-audio ${jobId}`)
          const result = await extractAudio({ videoUrl, audioFormat, outputSilentVideo })
          await job.updateProgress(80)
          const audioR2Url = await uploadFileToR2(result.audioPath, jobId, "audio")
          let silentVideoR2Url: string | undefined
          if (result.silentVideoPath) {
            silentVideoR2Url = await uploadFileToR2(result.silentVideoPath, `${jobId}-silent`, "video")
          }
          await cleanupWorkDir(dirname(result.audioPath))
          await job.updateProgress(100)
          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl: audioR2Url, ...(silentVideoR2Url ? { videoUrl: silentVideoR2Url } : {}) }, completed_at: new Date().toISOString() }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${audioR2Url}`)

        } else if (job.name === "trim-video") {
          const { videoUrl, startTime, endTime } = job.data as {
            jobId: string; videoUrl: string; startTime: number; endTime?: number
          }
          console.log(`[worker] trim-video ${jobId}`)
          const outputPath = await trimVideo({ videoUrl, startTime, endTime })
          await job.updateProgress(80)
          const r2Url = await uploadFileToR2(outputPath, jobId, "video")
          await cleanupWorkDir(dirname(outputPath))
          await job.updateProgress(100)
          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { videoUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)

        } else if (job.name === "resize-video") {
          const { videoUrl, targetAspect, method, padColor } = job.data as {
            jobId: string; videoUrl: string; targetAspect: string; method: "crop" | "pad" | "stretch"; padColor?: string
          }
          console.log(`[worker] resize-video ${jobId}`)
          const outputPath = await resizeVideo({ videoUrl, targetAspect, method, padColor })
          await job.updateProgress(80)
          const r2Url = await uploadFileToR2(outputPath, jobId, "video")
          await cleanupWorkDir(dirname(outputPath))
          await job.updateProgress(100)
          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { videoUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)

        } else if (job.name === "adjust-volume") {
          const { audioUrl, videoUrl, volume, normalize, fadeIn, fadeOut } = job.data as {
            jobId: string; audioUrl?: string; videoUrl?: string; volume?: number; normalize?: boolean; fadeIn?: number; fadeOut?: number
          }
          console.log(`[worker] adjust-volume ${jobId} (${videoUrl ? "video" : "audio"} input)`)
          const { outputPath, inputType } = await adjustVolume({ audioUrl, videoUrl, volume, normalize, fadeIn, fadeOut })
          await job.updateProgress(80)
          const r2Url = await uploadFileToR2(outputPath, jobId, inputType)
          await cleanupWorkDir(dirname(outputPath))
          await job.updateProgress(100)
          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return
          const outputData = inputType === "video" ? { videoUrl: r2Url } : { audioUrl: r2Url }
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { ...outputData, inputType }, completed_at: new Date().toISOString() }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)

        } else if (job.name === "add-captions") {
          const { videoUrl, text, style, position, fontSize, color, backgroundColor } = job.data as {
            jobId: string; videoUrl: string; text: string; style?: string; position?: string; fontSize?: number; color?: string; backgroundColor?: string
          }
          console.log(`[worker] add-captions ${jobId}`)
          const outputPath = await addCaptions({ videoUrl, text, style: style as "subtitle" | "word-highlight" | "karaoke" | undefined, position: position as "bottom" | "top" | "center" | undefined, fontSize, color, backgroundColor })
          await job.updateProgress(80)
          const r2Url = await uploadFileToR2(outputPath, jobId, "video")
          await cleanupWorkDir(dirname(outputPath))
          await job.updateProgress(100)
          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { videoUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)

        } else if (job.name === "mix-audio") {
          const { audioUrls } = job.data as { jobId: string; audioUrls: string[] }
          console.log(`[worker] mix-audio ${jobId}: ${audioUrls.length} tracks`)
          const outputPath = await mixAudio({ audioUrls })
          await job.updateProgress(80)
          const r2Url = await uploadFileToR2(outputPath, jobId, "audio")
          await cleanupWorkDir(dirname(outputPath))
          await job.updateProgress(100)
          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)

        } else if (job.name === "extract-youtube-audio") {
          const { youtubeUrl } = job.data as { jobId: string; youtubeUrl: string }
          console.log(`[worker] extract-youtube-audio ${jobId}`)
          const audioUrl = await extractYouTubeAudio(youtubeUrl)
          await job.updateProgress(100)
          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl }, completed_at: new Date().toISOString() }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${audioUrl}`)

        } else if (job.name === "generate-music") {
          const { prompt, provider, duration, modelVersion, lyrics, referenceAudioUrl } = job.data as { jobId: string; prompt: string; provider?: MusicProvider; duration?: number; modelVersion?: string; lyrics?: string; referenceAudioUrl?: string }
          console.log(`[worker] generate-music ${jobId} (provider: ${provider ?? "musicgen"})`)
          const replicateUrl = await generateMusic(prompt, provider, duration, modelVersion, lyrics, referenceAudioUrl)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(replicateUrl, jobId, "audio")
          await job.updateProgress(100)
          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)

        } else if (job.name === "text-to-audio") {
          const { prompt, provider, duration, loop, promptInfluence } = job.data as {
            jobId: string; prompt: string; provider?: AudioProvider | "elevenlabs-sfx"
            duration?: number; loop?: boolean; promptInfluence?: number
          }
          console.log(`[worker] text-to-audio ${jobId} (provider: ${provider ?? "tangoflux"})`)

          let audioUrl: string
          if (provider === "elevenlabs-sfx") {
            const kieAudio = new KieAudioProvider()
            const result = await kieAudio.generateSoundEffect(prompt, {
              duration,
              loop,
              promptInfluence,
            })
            audioUrl = result.url
          } else {
            audioUrl = await textToAudio(prompt, provider as AudioProvider | undefined, duration)
          }

          await job.updateProgress(50)
          const r2Url = await uploadToR2(audioUrl, jobId, "audio")
          await job.updateProgress(100)
          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)

        } else if (job.name === "suno-generate") {
          const { prompt, model, lyrics, style, title, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight, customMode, instrumental } = job.data as {
            jobId: string; prompt: string; model?: SunoModel; lyrics?: string; style?: string; title?: string
            negativeStyle?: string; vocalGender?: string; styleWeight?: number; weirdnessConstraint?: number; audioWeight?: number
            customMode?: boolean; instrumental?: boolean
          }
          console.log(`[worker] suno-generate ${jobId} (model: ${model ?? "V5"}, customMode: ${customMode}, instrumental: ${instrumental})`)
          const result = await sunoGenerate({ prompt, model, lyrics, style, title, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight, customMode, instrumental })
          await job.updateProgress(50)
          // Upload first track to R2 for permanent storage (Suno URLs expire in 14 days)
          const firstTrack = result.tracks[0]
          if (!firstTrack) throw new Error("Suno returned no tracks")
          const r2Url = await uploadToR2(firstTrack.audioUrl, jobId, "audio")
          await job.updateProgress(100)
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({
            status: "completed", progress: 100,
            output_data: { audioUrl: r2Url, sunoTrackId: firstTrack.id, sunoTitle: firstTrack.title, sunoDuration: firstTrack.duration, sunoImageUrl: firstTrack.imageUrl, sunoTaskId: result.taskId, trackCount: result.tracks.length },
            completed_at: new Date().toISOString(),
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (${result.tracks.length} tracks)`)

        } else if (job.name === "suno-cover") {
          const { prompt, uploadUrl, model, lyrics, style, title, negativeStyle, vocalGender, customMode, instrumental } = job.data as {
            jobId: string; prompt: string; uploadUrl: string; model?: SunoModel; lyrics?: string; style?: string; title?: string
            negativeStyle?: string; vocalGender?: string; customMode?: boolean; instrumental?: boolean
          }
          console.log(`[worker] suno-cover ${jobId} (model: ${model ?? "V5"}, customMode: ${customMode}, instrumental: ${instrumental})`)
          // If upload_url is a social media URL, download audio to R2 first
          let resolvedUploadUrl = uploadUrl
          if (isSocialUrl(uploadUrl)) {
            console.log(`[worker] Social URL detected for cover, downloading audio first...`)
            resolvedUploadUrl = await downloadAudioToR2(uploadUrl)
          }
          const result = await sunoCover({ prompt, uploadUrl: resolvedUploadUrl, model, lyrics, style, title, negativeStyle, vocalGender, customMode, instrumental })
          await job.updateProgress(50)
          const firstTrack = result.tracks[0]
          if (!firstTrack) throw new Error("Suno cover returned no tracks")
          const r2Url = await uploadToR2(firstTrack.audioUrl, jobId, "audio")
          await job.updateProgress(100)
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({
            status: "completed", progress: 100,
            output_data: { audioUrl: r2Url, sunoTrackId: firstTrack.id, sunoTitle: firstTrack.title, sunoDuration: firstTrack.duration, sunoImageUrl: firstTrack.imageUrl, sunoTaskId: result.taskId, trackCount: result.tracks.length },
            completed_at: new Date().toISOString(),
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (${result.tracks.length} tracks)`)

        } else if (job.name === "suno-extend") {
          const { audioId, defaultParamFlag, prompt, model, style, title, continueAt, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight } = job.data as {
            jobId: string; audioId: string; defaultParamFlag?: boolean; prompt?: string; model?: SunoModel; style?: string; title?: string
            continueAt?: number; negativeStyle?: string; vocalGender?: string; styleWeight?: number; weirdnessConstraint?: number; audioWeight?: number
          }
          console.log(`[worker] suno-extend ${jobId} (model: ${model ?? "V5"}, audioId: ${audioId})`)
          const result = await sunoExtend({ audioId, defaultParamFlag, prompt, model, style, title, continueAt, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight })
          await job.updateProgress(50)
          const firstTrack = result.tracks[0]
          if (!firstTrack) throw new Error("Suno extend returned no tracks")
          const r2Url = await uploadToR2(firstTrack.audioUrl, jobId, "audio")
          await job.updateProgress(100)
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({
            status: "completed", progress: 100,
            output_data: { audioUrl: r2Url, sunoTrackId: firstTrack.id, sunoTitle: firstTrack.title, sunoDuration: firstTrack.duration, sunoImageUrl: firstTrack.imageUrl, sunoTaskId: result.taskId, trackCount: result.tracks.length },
            completed_at: new Date().toISOString(),
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (${result.tracks.length} tracks)`)

        } else if (job.name === "suno-lyrics") {
          const { prompt } = job.data as { jobId: string; prompt: string; usageLogId?: string }
          console.log(`[worker] suno-lyrics ${jobId}`)
          const result = await sunoLyrics({ prompt })
          await job.updateProgress(100)
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { lyrics: result.lyrics, sunoTaskId: result.taskId },
            completed_at: new Date().toISOString(),
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${result.lyrics.length} lyrics generated`)

        } else if (job.name === "suno-separate") {
          const { taskId: sunoTaskId, audioId, separateType } = job.data as {
            jobId: string; taskId: string; audioId: string; separateType?: SunoSeparateType; usageLogId?: string
          }
          const sepType = separateType ?? "separate_vocal"
          console.log(`[worker] suno-separate ${jobId} (type: ${sepType}, audioId: ${audioId})`)
          const result = await sunoSeparate({ taskId: sunoTaskId, audioId, type: sepType })
          await job.updateProgress(50)

          // Upload available stems to R2
          const outputData: Record<string, unknown> = {
            separateType: sepType,
            sunoTaskId: result.taskId,
          }

          const stemFields = [
            "vocalUrl", "instrumentalUrl", "backingVocalsUrl", "drumsUrl",
            "bassUrl", "guitarUrl", "pianoUrl", "keyboardUrl",
            "percussionUrl", "stringsUrl", "synthUrl", "fxUrl",
            "brassUrl", "woodwindsUrl",
          ] as const

          let uploadedCount = 0
          for (const field of stemFields) {
            const url = result[field]
            if (url) {
              const stemName = field.replace("Url", "")
              const r2Url = await uploadToR2(url, `${jobId}-${stemName}`, "audio")
              outputData[field] = r2Url
              uploadedCount++
            }
          }

          // Set primary audioUrl for downstream routing
          outputData.audioUrl = outputData.vocalUrl ?? outputData.instrumentalUrl

          await job.updateProgress(100)
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: outputData,
            completed_at: new Date().toISOString(),
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${uploadedCount} stem(s) uploaded`)

        } else if (job.name === "suno-music-video") {
          const { taskId: sunoTaskId, audioId } = job.data as { jobId: string; taskId: string; audioId: string; usageLogId?: string }
          console.log(`[worker] suno-music-video ${jobId}`)
          const result = await sunoMusicVideo({ taskId: sunoTaskId, audioId })
          await job.updateProgress(50)
          const r2Url = await uploadToR2(result.videoUrl, jobId, "video")
          await job.updateProgress(100)
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { videoUrl: r2Url, sunoTaskId: result.taskId },
            completed_at: new Date().toISOString(),
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: music video generated`)

        } else if (job.name === "transcribe") {
          const { audioUrl, provider, language } = job.data as { jobId: string; audioUrl: string; provider?: TranscribeProvider; language?: string }
          console.log(`[worker] transcribe ${jobId} (provider: ${provider ?? "whisper"}, language: ${language ?? "auto"})`)
          const result = await transcribe(audioUrl, provider, language)
          await job.updateProgress(100)
          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return
          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { text: result.text, language: result.language, segments: result.segments },
            completed_at: new Date().toISOString(),
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: transcribed ${result.text.length} chars (language: ${result.language})`)

        } else if (job.name === "generate-character") {
          const { prompt, sourceImageUrl, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; provider?: string }
          console.log(`[worker] generate-character ${jobId} (provider: ${provider ?? "nano-banana"}): "${prompt}"`)
          const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
          const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { imageUrl: r2Url },
            completed_at: new Date().toISOString(),
            provider: result.providerUsed,
            provider_cost: result.cost,
            display_cost: result.displayCost,
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)

        } else if (job.name === "generate-character-asset") {
          const { prompt, sourceImageUrl, assetType, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; assetType: string; provider?: string }
          console.log(`[worker] generate-character-asset ${jobId} (type: ${assetType}, provider: ${provider ?? "nano-banana"})`)
          const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
          const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { imageUrl: r2Url, assetType },
            completed_at: new Date().toISOString(),
            provider: result.providerUsed,
            provider_cost: result.cost,
            display_cost: result.displayCost,
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)

        } else if (job.name === "generate-object") {
          const { prompt, sourceImageUrl, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; provider?: string }
          console.log(`[worker] generate-object ${jobId} (provider: ${provider ?? "nano-banana"}): "${prompt}"`)
          const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
          const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { imageUrl: r2Url },
            completed_at: new Date().toISOString(),
            provider: result.providerUsed,
            provider_cost: result.cost,
            display_cost: result.displayCost,
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)

        } else if (job.name === "generate-object-asset") {
          const { prompt, sourceImageUrl, assetType, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; assetType: string; provider?: string }
          console.log(`[worker] generate-object-asset ${jobId} (type: ${assetType}, provider: ${provider ?? "nano-banana"})`)
          const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
          const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { imageUrl: r2Url, assetType },
            completed_at: new Date().toISOString(),
            provider: result.providerUsed,
            provider_cost: result.cost,
            display_cost: result.displayCost,
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)

        } else if (job.name === "generate-location") {
          const { prompt, sourceImageUrl, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; provider?: string }
          console.log(`[worker] generate-location ${jobId} (provider: ${provider ?? "nano-banana"}): "${prompt}"`)
          const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
          const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { imageUrl: r2Url },
            completed_at: new Date().toISOString(),
            provider: result.providerUsed,
            provider_cost: result.cost,
            display_cost: result.displayCost,
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)

        } else if (job.name === "generate-location-asset") {
          const { prompt, sourceImageUrl, assetType, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; assetType: string; provider?: string }
          console.log(`[worker] generate-location-asset ${jobId} (type: ${assetType}, provider: ${provider ?? "nano-banana"})`)
          const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
          const result = await generateImage(prompt, provider ?? "nano-banana", referenceImageUrls)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { imageUrl: r2Url, assetType },
            completed_at: new Date().toISOString(),
            provider: result.providerUsed,
            provider_cost: result.cost,
            display_cost: result.displayCost,
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)

        } else if (job.name === "motion-transfer") {
          // Motion Transfer: Image + Video → Motion-Applied Video
          const { imageUrl, videoUrl, prompt, characterOrientation, resolution } = job.data as {
            jobId: string
            imageUrl: string
            videoUrl: string
            prompt?: string
            characterOrientation?: "image" | "video"
            resolution?: "720p" | "1080p"
          }
          console.log(`[worker] motion-transfer ${jobId} (orientation: ${characterOrientation ?? "image"}, resolution: ${resolution ?? "720p"})`)

          // Create progress callback for real-time updates
          const onProgress: ProgressCallback = async (progress: number) => {
            console.log(`[worker] Job ${jobId} motion-transfer progress: ${progress}%`)
            await supabase.from("jobs").update({ progress }).eq("id", jobId)
          }

          const result = await motionTransfer(
            imageUrl,
            videoUrl,
            "kling",
            prompt,
            {
              onProgress,
              characterOrientation: characterOrientation ?? "image",
              resolution: resolution ?? "720p",
            }
          )
          await job.updateProgress(50)

          const r2Url = await uploadToR2(result.url, jobId, "video")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { videoUrl: r2Url },
            completed_at: new Date().toISOString(),
            provider: result.providerUsed,
            provider_cost: result.cost,
            display_cost: result.displayCost,
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)

        } else if (job.name === "video-upscale") {
          // Video Upscale: Video → Upscaled Video
          const { videoUrl, upscaleFactor } = job.data as {
            jobId: string
            videoUrl: string
            upscaleFactor?: "1" | "2" | "4"
          }
          console.log(`[worker] video-upscale ${jobId} (factor: ${upscaleFactor ?? "2"}x)`)

          // Create progress callback for real-time updates
          const onProgress: ProgressCallback = async (progress: number) => {
            console.log(`[worker] Job ${jobId} video-upscale progress: ${progress}%`)
            await supabase.from("jobs").update({ progress }).eq("id", jobId)
          }

          const result = await videoUpscale(
            videoUrl,
            "topaz",
            upscaleFactor ?? "2",
            { onProgress }
          )
          await job.updateProgress(50)

          const r2Url = await uploadToR2(result.url, jobId, "video")
          await job.updateProgress(100)

          // Check if job was cancelled before saving result
          if (!await shouldSaveJobResult(jobId)) return

          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { videoUrl: r2Url },
            completed_at: new Date().toISOString(),
            provider: result.providerUsed,
            provider_cost: result.cost,
            display_cost: result.displayCost,
          }).eq("id", jobId)
          await commitJobCredits(usageLogId, jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)

        } else {
          throw new Error(`Unknown job type: ${job.name}`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error"

        // For KieError, log the internal details for debugging
        let internalDetails: string | undefined
        if (err instanceof KieError) {
          internalDetails = err.internalDetails
          console.error(`[worker] Job ${jobId} failed (KIE.ai):`)
          console.error(`  User message: ${message}`)
          console.error(`  Internal details: ${internalDetails}`)
          console.error(`  Context: ${err.context}`)
        } else {
          console.error(`[worker] Job ${jobId} failed:`, message)
        }

        // Save error to database - include internal details for debugging
        // Format: "User message | Internal: KIE.ai error details"
        const errorMessageForDb = internalDetails
          ? `${message} | Internal: ${internalDetails}`
          : message

        await supabase
          .from("jobs")
          .update({
            status: "failed",
            error_message: errorMessageForDb,
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId)

        await refundJobCredits(usageLogId, jobId, message)
        throw err
      }
    },
    { connection, concurrency: 2 },
  )
}
