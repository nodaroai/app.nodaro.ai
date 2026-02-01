import { Worker } from "bullmq"
import IORedis from "ioredis"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { generateImage } from "../providers/image/replicate.js"
import { imageToVideo } from "../providers/video/replicate.js"
import { videoToVideo } from "../providers/video/video-to-video.js"
import { textToVideo } from "../providers/video/text-to-video.js"
import { textToSpeech } from "../providers/voice/text-to-speech.js"
import { generateScript } from "../providers/script/script-generator.js"
import { uploadToR2, uploadFileToR2 } from "../lib/storage.js"
import { combineVideos } from "../providers/video/combine-videos.js"
import { addAudio } from "../providers/video/add-audio.js"
import { extractAudio } from "../providers/video/extract-audio.js"
import { trimVideo } from "../providers/video/trim-video.js"
import { resizeVideo } from "../providers/video/resize-video.js"
import { adjustVolume } from "../providers/video/adjust-volume.js"
import { addCaptions } from "../providers/video/add-captions.js"
import { mixAudio } from "../providers/video/mix-audio.js"
import { cleanupWorkDir } from "../providers/video/ffmpeg-utils.js"
import { generateMusic, type MusicProvider } from "../providers/audio/generate-music.js"
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
          const { prompt, referenceImageUrl } = job.data as { jobId: string; prompt: string; referenceImageUrl?: string }
          console.log(`[worker] generate-image ${jobId}: "${prompt}"`)

          const replicateUrl = await generateImage(prompt, referenceImageUrl)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(replicateUrl, jobId, "image")
          await job.updateProgress(100)

          await supabase
            .from("jobs")
            .update({
              status: "completed",
              progress: 100,
              output_data: { imageUrl: r2Url },
              completed_at: new Date().toISOString(),
            })
            .eq("id", jobId)

          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)
        } else if (job.name === "image-to-video") {
          const { imageUrl, prompt } = job.data as {
            jobId: string
            imageUrl: string
            prompt?: string
          }
          console.log(`[worker] image-to-video ${jobId}`)

          const replicateUrl = await imageToVideo(imageUrl, prompt)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(replicateUrl, jobId, "video")
          await job.updateProgress(100)

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
        } else if (job.name === "video-to-video") {
          const { videoUrl, prompt } = job.data as {
            jobId: string
            videoUrl: string
            prompt?: string
          }
          console.log(`[worker] video-to-video ${jobId}`)

          const replicateUrl = await videoToVideo(videoUrl, prompt)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(replicateUrl, jobId, "video")
          await job.updateProgress(100)

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
        } else if (job.name === "text-to-video") {
          const { prompt } = job.data as {
            jobId: string
            prompt: string
          }
          console.log(`[worker] text-to-video ${jobId}`)

          const replicateUrl = await textToVideo(prompt)
          await job.updateProgress(50)

          const r2Url = await uploadToR2(replicateUrl, jobId, "video")
          await job.updateProgress(100)

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
        } else if (job.name === "text-to-speech") {
          const { text, voice } = job.data as {
            jobId: string
            text: string
            voice?: string
          }
          console.log(`[worker] text-to-speech ${jobId}`)

          const replicateUrl = await textToSpeech(text, voice)
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
          const { prompt, sceneCount, tone, targetDuration } = job.data as {
            jobId: string
            prompt: string
            sceneCount?: number
            tone?: string
            targetDuration?: number
          }
          console.log(`[worker] generate-script ${jobId}`)

          const script = await generateScript(prompt, sceneCount, tone, targetDuration)
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
        } else if (job.name === "add-audio") {
          const { videoUrl, audioUrl, voiceoverVolume, backgroundVolume, keepOriginalAudio } = job.data as {
            jobId: string; videoUrl: string; audioUrl: string
            voiceoverVolume?: number; backgroundVolume?: number; keepOriginalAudio?: boolean
          }
          console.log(`[worker] add-audio ${jobId}`)
          const outputPath = await addAudio({ videoUrl, audioUrl, voiceoverVolume, backgroundVolume, keepOriginalAudio })
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

        } else if (job.name === "generate-music") {
          const { prompt, provider, duration, modelVersion, lyrics, referenceAudioUrl } = job.data as { jobId: string; prompt: string; provider?: MusicProvider; duration?: number; modelVersion?: string; lyrics?: string; referenceAudioUrl?: string }
          console.log(`[worker] generate-music ${jobId} (provider: ${provider ?? "musicgen"})`)
          const replicateUrl = await generateMusic(prompt, provider, duration, modelVersion, lyrics, referenceAudioUrl)
          await job.updateProgress(50)
          const r2Url = await uploadToR2(replicateUrl, jobId, "audio")
          await job.updateProgress(100)
          await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", jobId)
          console.log(`[worker] Job ${jobId} completed: ${r2Url}`)

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
