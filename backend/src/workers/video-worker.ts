import { Worker } from "bullmq"
import IORedis from "ioredis"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { generateImage } from "../providers/image/replicate.js"
import { imageToVideo } from "../providers/video/replicate.js"
import { videoToVideo } from "../providers/video/video-to-video.js"
import { uploadToR2 } from "../lib/storage.js"

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
