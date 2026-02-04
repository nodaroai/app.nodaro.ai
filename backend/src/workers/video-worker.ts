import { Worker } from "bullmq"
import IORedis from "ioredis"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { getAppSettings, calculateDisplayCost } from "../lib/app-settings.js"
import { generateImage, type ImageProvider, type GenerateImageResult } from "../providers/image/replicate.js"
import { imageToVideo, type VideoProvider, type VideoResult } from "../providers/video/replicate.js"
import { videoToVideo } from "../providers/video/video-to-video.js"
import { textToVideo } from "../providers/video/text-to-video.js"
import { textToSpeech, type VoiceProvider } from "../providers/voice/text-to-speech.js"
import { generateScript, type ScriptProvider } from "../providers/script/script-generator.js"
import { uploadToR2, uploadFileToR2 } from "../lib/storage.js"
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
import { extractYouTubeAudio } from "../providers/audio/youtube-extractor.js"
import { editImageKie, generateImageKie } from "../services/kie-ai.js"
import { getAppSettings as getKieAppSettings } from "../lib/app-settings.js"
import { isKieSupported } from "../services/model-mapping.js"
import { promises as fs } from "node:fs"
import { dirname } from "node:path"

export function createVideoWorker() {
  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  })

  return new Worker(
    "video-generation",
    async (job) => {
      const { jobId } = job.data as { jobId: string }

      try {
        await supabase
          .from("jobs")
          .update({ status: "processing", started_at: new Date().toISOString() })
          .eq("id", jobId)

        if (job.name === "generate-image") {
          const { prompt, referenceImageUrls, provider } = job.data as { jobId: string; prompt: string; referenceImageUrls?: string[]; provider?: ImageProvider }
          console.log(`[worker] generate-image ${jobId} (provider: ${provider ?? "nano-banana"}): "${prompt}"`)
          if (referenceImageUrls?.length) {
            console.log(`[worker] Reference images (${referenceImageUrls.length}): ${referenceImageUrls.join(", ")}`)
          }

          const result = await generateImage(prompt, referenceImageUrls, provider)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Get settings and calculate costs
          const settings = await getAppSettings()
          const providerCost = result.cost
          const displayCost = providerCost != null ? calculateDisplayCost(providerCost, settings.cost_markup_percent) : null

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { imageUrl: r2Url },
              completed_at: new Date().toISOString(),
              provider: settings.ai_provider,
              provider_cost: providerCost,
              display_cost: displayCost,
            })
            .eq("id", jobId)

          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${settings.ai_provider}, cost: $${providerCost?.toFixed(6) ?? "N/A"})`)
        } else if (job.name === "edit-image") {
          const { imageUrl, prompt, provider } = job.data as {
            jobId: string
            imageUrl: string
            prompt?: string
            provider?: "recraft-upscale" | "recraft-remove-bg" | "nano-banana-edit"
          }
          const resolvedProvider = provider ?? "recraft-upscale"
          console.log(`[worker] edit-image ${jobId} (provider: ${resolvedProvider}): "${prompt ?? "(no prompt)"}"`)

          // Edit image operations are KIE.ai only - check if KIE.ai is supported
          const settings = await getAppSettings()
          if (settings.ai_provider !== "kie" || !isKieSupported("image", resolvedProvider)) {
            throw new Error(`Edit image operations require KIE.ai provider. Current provider: ${settings.ai_provider}`)
          }

          const result = await editImageKie(imageUrl, prompt, resolvedProvider)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          const providerCost = result.cost
          const displayCost = providerCost != null ? calculateDisplayCost(providerCost, settings.cost_markup_percent) : null

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { imageUrl: r2Url },
              completed_at: new Date().toISOString(),
              provider: settings.ai_provider,
              provider_cost: providerCost,
              display_cost: displayCost,
            })
            .eq("id", jobId)

          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${settings.ai_provider}, cost: $${providerCost?.toFixed(6) ?? "N/A"})`)
        } else if (job.name === "image-to-image") {
          const { imageUrl, prompt, provider } = job.data as {
            jobId: string
            imageUrl: string
            prompt: string
            provider?: "nano-banana" | "nano-banana-pro" | "flux-i2i" | "grok-i2i" | "gpt-image-i2i"
          }
          const resolvedProvider = provider ?? "nano-banana"
          console.log(`[worker] image-to-image ${jobId} (provider: ${resolvedProvider}): "${prompt}"`)

          const settings = await getAppSettings()

          // For image-to-image, we pass the source image as reference and use the prompt to transform
          // nano-banana works on both Replicate and KIE.ai, others are KIE.ai only
          let result: { url: string; cost: number }
          if (settings.ai_provider === "kie" && isKieSupported("image", resolvedProvider)) {
            result = await generateImageKie(prompt, [imageUrl], resolvedProvider)
          } else if (resolvedProvider === "nano-banana" || resolvedProvider === "nano-banana-pro") {
            // Fallback to Replicate for nano-banana
            result = await generateImage(prompt, [imageUrl], "nano-banana")
          } else {
            throw new Error(`Provider ${resolvedProvider} is only available with KIE.ai. Current provider: ${settings.ai_provider}`)
          }
          await job.updateProgress(50)

          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          const providerCost = result.cost
          const displayCost = providerCost != null ? calculateDisplayCost(providerCost, settings.cost_markup_percent) : null

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { imageUrl: r2Url },
              completed_at: new Date().toISOString(),
              provider: settings.ai_provider,
              provider_cost: providerCost,
              display_cost: displayCost,
            })
            .eq("id", jobId)

          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${settings.ai_provider}, cost: $${providerCost?.toFixed(6) ?? "N/A"})`)
        } else if (job.name === "image-to-video") {
          const { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration } = job.data as {
            jobId: string
            imageUrl: string
            endFrameUrl?: string      // Optional end frame for supported providers
            audioUrl?: string         // Optional audio to merge after video generation
            prompt?: string
            provider?: VideoProvider
            generateAudio?: boolean
            duration?: number
          }
          console.log(`[worker] image-to-video ${jobId} (provider: ${provider ?? "minimax"})${endFrameUrl ? " [with end frame]" : ""}${audioUrl ? " [with audio]" : ""}`)

          // Generate the video with optional end frame support
          const videoResult = await imageToVideo(imageUrl, prompt, provider, generateAudio, duration, endFrameUrl)
          await job.updateProgress(40)

          // Upload the generated video to R2
          let finalVideoUrl = await uploadToR2(videoResult.url, jobId, "video")
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

          // Get settings and calculate costs
          const settings = await getAppSettings()
          const providerCost = videoResult.cost
          const displayCost = providerCost != null ? calculateDisplayCost(providerCost, settings.cost_markup_percent) : null

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { videoUrl: finalVideoUrl },
              completed_at: new Date().toISOString(),
              provider: settings.ai_provider,
              provider_cost: providerCost,
              display_cost: displayCost,
            })
            .eq("id", jobId)

          console.log(`[worker] Job ${jobId} completed: ${finalVideoUrl} (provider: ${settings.ai_provider}, cost: $${providerCost?.toFixed(6) ?? "N/A"})`)
        } else if (job.name === "video-to-video") {
          const { videoUrl, prompt, provider } = job.data as {
            jobId: string
            videoUrl: string
            prompt?: string
            provider?: VideoProvider
          }
          console.log(`[worker] video-to-video ${jobId} (provider: ${provider ?? "minimax"})`)

          const videoResult = await videoToVideo(videoUrl, prompt, provider)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(videoResult.url, jobId, "video")
          await job.updateProgress(100)

          // Get settings and calculate costs
          const settings = await getAppSettings()
          const providerCost = videoResult.cost
          const displayCost = providerCost != null ? calculateDisplayCost(providerCost, settings.cost_markup_percent) : null

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { videoUrl: r2Url },
              completed_at: new Date().toISOString(),
              provider: settings.ai_provider,
              provider_cost: providerCost,
              display_cost: displayCost,
            })
            .eq("id", jobId)

          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${settings.ai_provider}, cost: $${providerCost?.toFixed(6) ?? "N/A"})`)
        } else if (job.name === "text-to-video") {
          const { prompt, provider, duration } = job.data as {
            jobId: string
            prompt: string
            provider?: VideoProvider
            duration?: number
          }
          console.log(`[worker] text-to-video ${jobId} (provider: ${provider ?? "minimax"})`)

          const videoResult = await textToVideo(prompt, provider, duration)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(videoResult.url, jobId, "video")
          await job.updateProgress(100)

          // Get settings and calculate costs
          const settings = await getAppSettings()
          const providerCost = videoResult.cost
          const displayCost = providerCost != null ? calculateDisplayCost(providerCost, settings.cost_markup_percent) : null

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { videoUrl: r2Url },
              completed_at: new Date().toISOString(),
              provider: settings.ai_provider,
              provider_cost: providerCost,
              display_cost: displayCost,
            })
            .eq("id", jobId)

          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${settings.ai_provider}, cost: $${providerCost?.toFixed(6) ?? "N/A"})`)
        } else if (job.name === "text-to-speech") {
          const { text, voice, provider } = job.data as {
            jobId: string
            text: string
            voice?: string
            provider?: VoiceProvider
          }
          console.log(`[worker] text-to-speech ${jobId} (provider: ${provider ?? "elevenlabs"})`)

          const replicateUrl = await textToSpeech(text, voice, provider)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(replicateUrl, jobId, "audio")
          await job.updateProgress(100)

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { audioUrl: r2Url },
              completed_at: new Date().toISOString(),
            })
            .eq("id", jobId)

          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)
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

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { script },
              completed_at: new Date().toISOString(),
            })
            .eq("id", jobId)

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

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { videoUrl: r2Url },
              completed_at: new Date().toISOString(),
            })
            .eq("id", jobId)

          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)
        } else if (job.name === "merge-video-audio") {
          const { videoUrl, audioUrl, voiceoverVolume, backgroundVolume, keepOriginalAudio } = job.data as {
            jobId: string; videoUrl: string; audioUrl: string
            voiceoverVolume?: number; backgroundVolume?: number; keepOriginalAudio?: boolean
          }
          console.log(`[worker] merge-video-audio ${jobId}`)
          const outputPath = await mergeVideoAudio({ videoUrl, audioUrl, voiceoverVolume, backgroundVolume, keepOriginalAudio })
          await job.updateProgress(80)
          const r2Url = await uploadFileToR2(outputPath, jobId, "video")
          await cleanupWorkDir(dirname(outputPath))
          await job.updateProgress(100)
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { videoUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
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
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl: audioR2Url, ...(silentVideoR2Url ? { videoUrl: silentVideoR2Url } : {}) }, completed_at: new Date().toISOString() }).eq("id", jobId)
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
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { videoUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
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
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { videoUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)

        } else if (job.name === "adjust-volume") {
          const { audioUrl, volume, normalize, fadeIn, fadeOut } = job.data as {
            jobId: string; audioUrl: string; volume?: number; normalize?: boolean; fadeIn?: number; fadeOut?: number
          }
          console.log(`[worker] adjust-volume ${jobId}`)
          const outputPath = await adjustVolume({ audioUrl, volume, normalize, fadeIn, fadeOut })
          await job.updateProgress(80)
          const r2Url = await uploadFileToR2(outputPath, jobId, "audio")
          await cleanupWorkDir(dirname(outputPath))
          await job.updateProgress(100)
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
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
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { videoUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)

        } else if (job.name === "mix-audio") {
          const { audioUrls } = job.data as { jobId: string; audioUrls: string[] }
          console.log(`[worker] mix-audio ${jobId}: ${audioUrls.length} tracks`)
          const outputPath = await mixAudio({ audioUrls })
          await job.updateProgress(80)
          const r2Url = await uploadFileToR2(outputPath, jobId, "audio")
          await cleanupWorkDir(dirname(outputPath))
          await job.updateProgress(100)
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)

        } else if (job.name === "extract-youtube-audio") {
          const { youtubeUrl } = job.data as { jobId: string; youtubeUrl: string }
          console.log(`[worker] extract-youtube-audio ${jobId}`)
          const audioUrl = await extractYouTubeAudio(youtubeUrl)
          await job.updateProgress(100)
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl }, completed_at: new Date().toISOString() }).eq("id", jobId)
          console.log(`[worker] Job ${jobId} completed: ${audioUrl}`)

        } else if (job.name === "generate-music") {
          const { prompt, provider, duration, modelVersion, lyrics, referenceAudioUrl } = job.data as { jobId: string; prompt: string; provider?: MusicProvider; duration?: number; modelVersion?: string; lyrics?: string; referenceAudioUrl?: string }
          console.log(`[worker] generate-music ${jobId} (provider: ${provider ?? "musicgen"})`)
          const replicateUrl = await generateMusic(prompt, provider, duration, modelVersion, lyrics, referenceAudioUrl)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(replicateUrl, jobId, "audio")
          await job.updateProgress(100)
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)

        } else if (job.name === "text-to-audio") {
          const { prompt, provider, duration } = job.data as { jobId: string; prompt: string; provider?: AudioProvider; duration?: number }
          console.log(`[worker] text-to-audio ${jobId} (provider: ${provider ?? "tangoflux"})`)
          const replicateUrl = await textToAudio(prompt, provider, duration)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(replicateUrl, jobId, "audio")
          await job.updateProgress(100)
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)

        } else if (job.name === "generate-character") {
          const { prompt, sourceImageUrl, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; provider?: ImageProvider }
          console.log(`[worker] generate-character ${jobId} (provider: ${provider ?? "nano-banana"}): "${prompt}"`)
          const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
          const result = await generateImage(prompt, referenceImageUrls, provider)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Get settings and calculate costs
          const settings = await getAppSettings()
          const providerCost = result.cost
          const displayCost = providerCost != null ? calculateDisplayCost(providerCost, settings.cost_markup_percent) : null

          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { imageUrl: r2Url },
            completed_at: new Date().toISOString(),
            provider: settings.ai_provider,
            provider_cost: providerCost,
            display_cost: displayCost,
          }).eq("id", jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${settings.ai_provider}, cost: $${providerCost?.toFixed(6) ?? "N/A"})`)

        } else if (job.name === "generate-character-asset") {
          const { prompt, sourceImageUrl, assetType, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; assetType: string; provider?: ImageProvider }
          console.log(`[worker] generate-character-asset ${jobId} (type: ${assetType}, provider: ${provider ?? "nano-banana"})`)
          const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
          const result = await generateImage(prompt, referenceImageUrls, provider)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Get settings and calculate costs
          const settings = await getAppSettings()
          const providerCost = result.cost
          const displayCost = providerCost != null ? calculateDisplayCost(providerCost, settings.cost_markup_percent) : null

          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { imageUrl: r2Url, assetType },
            completed_at: new Date().toISOString(),
            provider: settings.ai_provider,
            provider_cost: providerCost,
            display_cost: displayCost,
          }).eq("id", jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${settings.ai_provider}, cost: $${providerCost?.toFixed(6) ?? "N/A"})`)

        } else if (job.name === "generate-object") {
          const { prompt, sourceImageUrl, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; provider?: ImageProvider }
          console.log(`[worker] generate-object ${jobId} (provider: ${provider ?? "nano-banana"}): "${prompt}"`)
          const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
          const result = await generateImage(prompt, referenceImageUrls, provider)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Get settings and calculate costs
          const settings = await getAppSettings()
          const providerCost = result.cost
          const displayCost = providerCost != null ? calculateDisplayCost(providerCost, settings.cost_markup_percent) : null

          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { imageUrl: r2Url },
            completed_at: new Date().toISOString(),
            provider: settings.ai_provider,
            provider_cost: providerCost,
            display_cost: displayCost,
          }).eq("id", jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${settings.ai_provider}, cost: $${providerCost?.toFixed(6) ?? "N/A"})`)

        } else if (job.name === "generate-object-asset") {
          const { prompt, sourceImageUrl, assetType, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; assetType: string; provider?: ImageProvider }
          console.log(`[worker] generate-object-asset ${jobId} (type: ${assetType}, provider: ${provider ?? "nano-banana"})`)
          const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
          const result = await generateImage(prompt, referenceImageUrls, provider)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Get settings and calculate costs
          const settings = await getAppSettings()
          const providerCost = result.cost
          const displayCost = providerCost != null ? calculateDisplayCost(providerCost, settings.cost_markup_percent) : null

          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { imageUrl: r2Url, assetType },
            completed_at: new Date().toISOString(),
            provider: settings.ai_provider,
            provider_cost: providerCost,
            display_cost: displayCost,
          }).eq("id", jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${settings.ai_provider}, cost: $${providerCost?.toFixed(6) ?? "N/A"})`)

        } else if (job.name === "generate-location") {
          const { prompt, sourceImageUrl, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; provider?: ImageProvider }
          console.log(`[worker] generate-location ${jobId} (provider: ${provider ?? "nano-banana"}): "${prompt}"`)
          const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
          const result = await generateImage(prompt, referenceImageUrls, provider)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Get settings and calculate costs
          const settings = await getAppSettings()
          const providerCost = result.cost
          const displayCost = providerCost != null ? calculateDisplayCost(providerCost, settings.cost_markup_percent) : null

          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { imageUrl: r2Url },
            completed_at: new Date().toISOString(),
            provider: settings.ai_provider,
            provider_cost: providerCost,
            display_cost: displayCost,
          }).eq("id", jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${settings.ai_provider}, cost: $${providerCost?.toFixed(6) ?? "N/A"})`)

        } else if (job.name === "generate-location-asset") {
          const { prompt, sourceImageUrl, assetType, provider } = job.data as { jobId: string; prompt: string; sourceImageUrl?: string; assetType: string; provider?: ImageProvider }
          console.log(`[worker] generate-location-asset ${jobId} (type: ${assetType}, provider: ${provider ?? "nano-banana"})`)
          const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
          const result = await generateImage(prompt, referenceImageUrls, provider)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(result.url, jobId, "image")
          await job.updateProgress(100)

          // Get settings and calculate costs
          const settings = await getAppSettings()
          const providerCost = result.cost
          const displayCost = providerCost != null ? calculateDisplayCost(providerCost, settings.cost_markup_percent) : null

          await supabase.from("jobs").update({
            status: "completed",
            progress: 100,
            output_data: { imageUrl: r2Url, assetType },
            completed_at: new Date().toISOString(),
            provider: settings.ai_provider,
            provider_cost: providerCost,
            display_cost: displayCost,
          }).eq("id", jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url} (provider: ${settings.ai_provider}, cost: $${providerCost?.toFixed(6) ?? "N/A"})`)

        } else {
          throw new Error(`Unknown job type: ${job.name}`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error"
        console.error(`[worker] Job ${jobId} failed:`, message)

        await supabase
          .from("jobs")
          .update({
            status: "failed",
            error_message: message,
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId)

        throw err
      }
    },
    { connection, concurrency: 2 },
  )
}
